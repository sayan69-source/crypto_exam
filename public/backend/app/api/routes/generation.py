"""
CryptoExam Core — Generation API Routes
REST + SSE endpoints for triggering and monitoring question generation.
"""

import asyncio
import json
import logging
import threading
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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
    """Request to trigger question generation for an exam."""
    exam_id: str
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
# Endpoints
# ═══════════════════════════════════════════════

@router.post("/{exam_id}/generate")
async def trigger_generation(
    exam_id: str,
    request: GenerationRequest,
    background_tasks: BackgroundTasks,
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

    # Build config
    config_dict = {
        "exam_id": exam_id,
        "exam_name": request.exam_name,
        "exam_body": request.exam_body,
        "subjects": request.subjects,
        "sets_count": request.sets_count,
        "target_mean_b": request.target_mean_b,
        "target_std_b": request.target_std_b,
        "bilingual": request.bilingual,
    }

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
        "message": f"Generation pipeline started for {request.exam_name}",
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
