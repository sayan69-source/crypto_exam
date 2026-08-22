"""
CryptoExam Core — Generation API Routes
REST + SSE endpoints for triggering and monitoring question generation.
"""

import asyncio
import json
import logging
import threading
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Exam
from app.tasks.generation import (
    clear_pipeline,
    get_pipeline_events,
    get_pipeline_status,
    run_generation_pipeline,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/generation", tags=["generation"])


# ═══════════════════════════════════════════════
# Request/Response Models
# ═══════════════════════════════════════════════

class GenerationRequest(BaseModel):
    """
    Request to trigger question generation for an exam.

    `exam_id` is optional in the body because it is already in the path; making
    it required there meant `POST /generation/{id}/generate {}` — the obvious
    call, and the one the setter UI makes — failed validation before it reached
    the pipeline.
    """
    exam_id: str | None = None
    exam_name: str = "NEET UG 2026 — Phase I"
    exam_body: str = "NTA"
    subjects: list[dict] = Field(
        default=[
            {
                "name": "Physics",
                "topics": [
                    {"name": "Mechanics", "count": 3},
                    {"name": "Electrostatics", "count": 2},
                    {"name": "Optics", "count": 2},
                    {"name": "Modern Physics", "count": 1},
                    {"name": "Thermodynamics", "count": 2},
                ],
                "total": 10,
            },
            {
                "name": "Chemistry",
                "topics": [
                    {"name": "Organic Chemistry", "count": 3},
                    {"name": "Inorganic Chemistry", "count": 3},
                    {"name": "Physical Chemistry", "count": 4},
                ],
                "total": 10,
            },
            {
                "name": "Biology",
                "topics": [
                    {"name": "Genetics", "count": 3},
                    {"name": "Ecology", "count": 2},
                    {"name": "Human Physiology", "count": 3},
                    {"name": "Plant Biology", "count": 2},
                ],
                "total": 10,
            },
        ],
        description="Subject configuration with topics and question counts"
    )
    sets_count: int = 4
    target_mean_b: float = 0.0
    target_std_b: float = 1.0
    bilingual: bool = True


class GenerationStatusResponse(BaseModel):
    """Pipeline status response."""
    exam_id: str
    phase: str
    progress: float
    total_questions_target: int
    total_generated: int
    total_accepted: int
    total_rejected: int
    total_slots: int
    completed_slots: int
    error: str | None = None


# ═══════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════

_DEFAULT_SUBJECTS = GenerationRequest.model_fields["subjects"].default


def _explicit_subjects(request: GenerationRequest) -> bool:
    """True when the caller supplied its own blueprint rather than the default."""
    return request.subjects != _DEFAULT_SUBJECTS


def _subjects_from_taxonomy(taxonomy: dict | None) -> list[dict]:
    """
    Turn an exam's `subject_taxonomy` into the pipeline's subject blueprint.

    Accepts both shapes the API takes:
      {"Physics": 10}                                   → one general topic
      {"Physics": {"Mechanics": 6, "Optics": 4}}        → per-topic counts
    """
    if not taxonomy:
        return []

    subjects: list[dict] = []
    for subject, spec in taxonomy.items():
        if isinstance(spec, dict):
            topics = [{"name": t, "count": int(c)} for t, c in spec.items() if int(c) > 0]
        else:
            count = int(spec)
            if count <= 0:
                continue
            topics = [{"name": "General", "count": count}]
        if topics:
            subjects.append(
                {"name": subject, "topics": topics, "total": sum(t["count"] for t in topics)}
            )
    return subjects


# ═══════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════

@router.post("/{exam_id}/generate")
async def trigger_generation(
    exam_id: str,
    background_tasks: BackgroundTasks,
    request: GenerationRequest = GenerationRequest(),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Trigger question generation for an exam.

    Runs the 6-agent pipeline in a background thread.
    Monitor progress via GET /generation/{exam_id}/status or SSE stream.
    """
    # Check if already running
    existing = get_pipeline_status(exam_id)
    if existing and existing.phase in ("generating", "balancing"):
        raise HTTPException(status_code=409, detail="Generation already in progress")

    # Clear any previous state
    clear_pipeline(exam_id)

    # The paper the setter asked for, not the NEET default. Without this the
    # pipeline ignored the exam entirely and always produced the same 30-question
    # NEET blueprint, so an SSC exam of 10 questions came back as something else.
    exam = None
    try:
        exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    except Exception:  # a non-UUID id is a bare pipeline run, not an exam
        exam = None

    subjects = request.subjects
    if exam is not None and not _explicit_subjects(request):
        derived = _subjects_from_taxonomy(exam.subject_taxonomy)
        if derived:
            subjects = derived

    # Build config
    config_dict = {
        "exam_id": exam_id,
        "exam_name": exam.name if exam is not None else request.exam_name,
        "exam_body": exam.exam_body.value if exam is not None else request.exam_body,
        "subjects": subjects,
        "sets_count": exam.sets_count if exam is not None else request.sets_count,
        "target_mean_b": request.target_mean_b,
        "target_std_b": request.target_std_b,
        "bilingual": request.bilingual,
    }

    # The exam's own IRT constraints must drive acceptance. They were being
    # ignored in favour of PipelineConfig's defaults, so the validator admitted
    # questions the setter's spec excluded — and the ZK proof later asserts the
    # paper meets *the exam's* bounds. Those have to be the same numbers or the
    # proof is about constraints nothing enforced.
    if exam is not None and exam.irt_config:
        irt = exam.irt_config
        for key in ("target_mean_b", "min_a", "max_c"):
            if key in irt:
                config_dict[key] = float(irt[key])
        # The validator works in ±3σ, the exam declares a tolerance directly.
        if "tolerance" in irt:
            config_dict["target_std_b"] = max(0.3, min(2.0, float(irt["tolerance"]) / 3))

    # Run in background thread (not blocking the event loop)
    thread = threading.Thread(
        target=run_generation_pipeline,
        args=(config_dict,),
        daemon=True,
    )
    thread.start()

    return {
        "status": "started",
        "exam_id": exam_id,
        "message": f"Generation pipeline started for {config_dict['exam_name']}",
        "questions_requested": sum(s["total"] for s in subjects),
        "stream_url": f"/api/v1/generation/{exam_id}/stream",
    }


@router.get("/{exam_id}/status")
async def get_status(exam_id: str) -> GenerationStatusResponse:
    """Get current pipeline status."""
    status = get_pipeline_status(exam_id)
    if not status:
        raise HTTPException(status_code=404, detail="No generation found for this exam")

    return GenerationStatusResponse(
        exam_id=status.exam_id,
        phase=status.phase,
        progress=status.progress,
        total_questions_target=status.total_questions_target,
        total_generated=status.total_generated,
        total_accepted=status.total_accepted,
        total_rejected=status.total_rejected,
        total_slots=status.total_slots,
        completed_slots=status.completed_slots,
        error=status.error,
    )


@router.get("/{exam_id}/stream")
async def stream_events(exam_id: str) -> StreamingResponse:
    """
    SSE endpoint for streaming generation events in real-time.
    
    Events:
    - slot_started: A new slot begins generation
    - question_accepted: A question passed validation
    - question_rejected: A question was rejected
    - slot_complete: A slot finished
    - agent_log: Agent activity log entry
    - generation_complete: Pipeline finished
    - error: Pipeline error
    """
    async def event_generator():
        last_index = 0
        max_wait = 300  # 5 minutes timeout

        # Send initial connection event
        yield f"data: {json.dumps({'type': 'connected', 'exam_id': exam_id})}\n\n"

        elapsed = 0
        while elapsed < max_wait:
            events = get_pipeline_events(exam_id, since_index=last_index)

            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
                last_index += 1

            # Check if pipeline is complete
            status = get_pipeline_status(exam_id)
            if status and status.phase in ("complete", "failed"):
                # Send final status
                yield f"data: {json.dumps({'type': 'final_status', 'phase': status.phase, 'progress': status.progress, 'total_accepted': status.total_accepted, 'total_rejected': status.total_rejected})}\n\n"
                break

            await asyncio.sleep(0.3)
            elapsed += 0.3

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{exam_id}/questions")
async def get_generated_questions(exam_id: str) -> dict:
    """Get all accepted questions from a completed generation."""
    status = get_pipeline_status(exam_id)
    if not status:
        raise HTTPException(status_code=404, detail="No generation found for this exam")

    questions = []
    for slot in status.slots:
        for sq in slot.questions:
            if sq.status.value == "accepted":
                questions.append({
                    "id": sq.question.id,
                    "text": sq.question.text,
                    "text_hi": sq.question.text_hi,
                    "options": sq.question.options,
                    "options_hi": sq.question.options_hi,
                    "correct_option": sq.question.correct_option,
                    "subject": sq.question.subject,
                    "topic": sq.question.topic,
                    "set_id": sq.question.set_id,
                    "irt": {"b": sq.irt.b, "a": sq.irt.a, "c": sq.irt.c},
                    "blooms_level": sq.blooms.level.value,
                    "blooms_name": sq.blooms.level_name,
                })

    return {
        "exam_id": exam_id,
        "phase": status.phase,
        "total": len(questions),
        "questions": questions,
        "equivalence": {
            "is_equivalent": status.equivalence_report.is_equivalent,
            "mean_b_per_set": status.equivalence_report.mean_b_per_set,
            "std_b_per_set": status.equivalence_report.std_b_per_set,
        } if status.equivalence_report else None,
    }


@router.get("/{exam_id}/logs")
async def get_agent_logs(exam_id: str, limit: int = 50) -> dict:
    """Get agent activity logs for a generation pipeline."""
    status = get_pipeline_status(exam_id)
    if not status:
        raise HTTPException(status_code=404, detail="No generation found for this exam")

    logs = [
        {
            "agent": log.agent.value,
            "action": log.action,
            "detail": log.detail,
            "success": log.success,
            "duration_ms": log.duration_ms,
            "timestamp": log.timestamp.isoformat(),
        }
        for log in status.logs[-limit:]
    ]

    return {"exam_id": exam_id, "total_logs": len(status.logs), "logs": logs}
