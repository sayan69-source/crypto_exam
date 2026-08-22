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

        return {
            "exam_id": exam_id,
            "status": "complete",
            "total_accepted": final_status.total_accepted,
            "total_rejected": final_status.total_rejected,
            "total_slots": final_status.total_slots,
            "completed_slots": final_status.completed_slots,
        }
    except Exception as e:
        logger.error(f"Pipeline failed for {exam_id}: {e}")
        _pipeline_statuses[exam_id].phase = "failed"
        _pipeline_statuses[exam_id].error = str(e)
        _publish_event(exam_id, "error", {"message": str(e)})
        raise


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
