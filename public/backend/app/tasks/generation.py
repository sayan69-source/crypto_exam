"""
CryptoExam Core — Generation Celery Task
Async task wrapping OrchestratorAgent for background execution.
Publishes progress events to Redis for SSE streaming.
"""

import json
import logging
from typing import Any

from app.agents.models import PipelineConfig, PipelineStatus
from app.agents.orchestrator import OrchestratorAgent

logger = logging.getLogger(__name__)

# In-memory pipeline status store (production would use Redis)
_pipeline_statuses: dict[str, PipelineStatus] = {}
_pipeline_events: dict[str, list[dict]] = {}


def _publish_event(exam_id: str, event_type: str, data: dict) -> None:
    """Publish event to the in-memory event store (and optionally Redis)."""
    if exam_id not in _pipeline_events:
        _pipeline_events[exam_id] = []

    event = {"type": event_type, **data}
    _pipeline_events[exam_id].append(event)

    # In production, publish to Redis pub/sub:
    # redis_client.publish(f"exam:{exam_id}:generation", json.dumps(event))

    logger.debug(f"Event [{exam_id}]: {event_type}")


def run_generation_pipeline(config_dict: dict[str, Any]) -> dict:
    """
    Run the full generation pipeline.
    
    In production, this would be a Celery task:
    
        @celery_app.task(bind=True, name="generate_exam_questions")
        def generate_exam_questions(self, config_dict):
            ...
    
    For demo, we run it synchronously or in a background thread.
    """
    config = PipelineConfig(**config_dict)
    exam_id = config.exam_id

    logger.info(f"Starting generation pipeline for exam {exam_id}")

    # Initialize orchestrator
    orchestrator = OrchestratorAgent(config)
    orchestrator.set_event_callback(
        lambda event_type, data: _publish_event(exam_id, event_type, data)
    )

    # Store initial status
    _pipeline_statuses[exam_id] = orchestrator.status

    # Run pipeline
    try:
        final_status = orchestrator.run()
        _pipeline_statuses[exam_id] = final_status

        persisted = _persist_accepted_questions(exam_id, final_status)

        return {
            "exam_id": exam_id,
            "status": "complete",
            "total_accepted": final_status.total_accepted,
            "total_rejected": final_status.total_rejected,
            "total_slots": final_status.total_slots,
            "completed_slots": final_status.completed_slots,
            "persisted": persisted,
        }
    except Exception as e:
        logger.error(f"Pipeline failed for {exam_id}: {e}")
        _pipeline_statuses[exam_id].phase = "failed"
        _pipeline_statuses[exam_id].error = str(e)
        _publish_event(exam_id, "error", {"message": str(e)})
        raise


def _persist_accepted_questions(exam_id: str, status: PipelineStatus) -> int:
    """
    Write the pipeline's accepted questions into the exam.

    Without this the run was a light show: the agents produced, scored and
    balanced questions entirely in memory, the SSE stream narrated it, and then
    every one of them was dropped when the thread ended. The exam stayed empty,
    so `generate-zk`, `seal`, `lock` and delivery all refused it — the whole
    lifecycle was reachable only for exams the seeder had written rows for.

    Runs on its own event loop and session because the caller is a plain thread,
    not the request's async context. Returns the number of rows written; a
    failure here is logged and swallowed, since losing the questions must not
    also lose the status the UI is streaming.
    """
    import asyncio
    import os
    from datetime import datetime, timezone
    from uuid import UUID

    from app.agents.models import QuestionStatus

    accepted = [
        q
        for slot in status.slots
        for q in slot.questions
        if q.status == QuestionStatus.ACCEPTED
    ]
    if not accepted:
        logger.warning("Generation for %s accepted nothing — nothing to persist", exam_id)
        return 0

    try:
        exam_uuid = UUID(exam_id)
    except ValueError:
        logger.warning(
            "Generation ran for %r, which is not an exam id — questions not persisted", exam_id
        )
        return 0

    async def _write() -> int:
        from sqlalchemy import delete, select

        from app.database import async_session
        from app.models import Exam, ExamStatus, Question, QuestionSource

        async with async_session() as db:
            exam = (await db.execute(select(Exam).where(Exam.id == str(exam_uuid)))).scalar_one_or_none()
            if exam is None:
                logger.warning("No exam %s to attach %d questions to", exam_id, len(accepted))
                return 0

            # A re-run replaces the previous attempt rather than stacking a
            # second paper on top of the first.
            await db.execute(delete(Question).where(Question.exam_id == str(exam_uuid)))

            # Label provenance honestly. With USE_MOCK_LLM (the default) the
            # "generated" items come from a curated demo bank, which is a human
            # authoring them — recording that as AI_GENERATED would make the
            # 6-agent claim rest on questions no model ever wrote.
            from app.agents.generator import USE_MOCK_LLM

            source = QuestionSource.MANUAL_UPLOAD if USE_MOCK_LLM else QuestionSource.AI_GENERATED
            model_label = (
                "demo-question-bank (USE_MOCK_LLM=true — no model produced these)"
                if USE_MOCK_LLM
                else os.getenv("LLM_MODEL", "llm")
            )

            per_set: dict[str, int] = {}
            for scored in accepted:
                gq = scored.question
                set_label = (gq.set_id or "A")[:1]
                per_set[set_label] = per_set.get(set_label, 0) + 1
                db.add(
                    Question(
                        exam_id=str(exam_uuid),
                        set_label=set_label,
                        sequence_number=per_set[set_label],
                        text=gq.text,
                        text_hi=gq.text_hi,
                        options=gq.options,
                        options_hi=gq.options_hi,
                        correct_option=gq.correct_option,
                        subject=gq.subject,
                        topic=gq.topic,
                        ncert_reference=gq.ncert_chapter,
                        blooms_level=int(scored.blooms.level),
                        irt_b=scored.irt.b,
                        irt_a=scored.irt.a,
                        irt_c=scored.irt.c,
                        source=source,
                        generation_model=model_label,
                        is_accepted=True,
                    )
                )

            # The paper now exists, so the exam is no longer a DRAFT — this is
            # the transition the seal/lock steps gate on.
            if exam.status in (ExamStatus.DRAFT, ExamStatus.GENERATING):
                exam.status = ExamStatus.GENERATING
            exam.updated_at = datetime.now(timezone.utc)

            await db.commit()
            return len(accepted)

    try:
        written = asyncio.run(_write())
        logger.info("Persisted %d accepted questions for exam %s", written, exam_id)
        return written
    except Exception as exc:  # noqa: BLE001 — never lose the status over this
        logger.error("Could not persist generated questions for %s: %s", exam_id, exc)
        return 0


def get_pipeline_status(exam_id: str) -> PipelineStatus | None:
    """Get the current pipeline status for an exam."""
    return _pipeline_statuses.get(exam_id)


def get_pipeline_events(exam_id: str, since_index: int = 0) -> list[dict]:
    """Get events for an exam since a given index."""
    events = _pipeline_events.get(exam_id, [])
    return events[since_index:]


def clear_pipeline(exam_id: str) -> None:
    """Clear pipeline state (for re-runs)."""
    _pipeline_statuses.pop(exam_id, None)
    _pipeline_events.pop(exam_id, None)
