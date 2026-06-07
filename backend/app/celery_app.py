"""
CryptoExam Core — Celery Task Queue Configuration
Queues: questions (AI generation), crypto (ZK proofs, encryption), blockchain (on-chain TX)
"""

from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "cryptoexam",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_routes={
        "app.tasks.generation.*": {"queue": "questions"},
        "app.tasks.zk_proof.*": {"queue": "crypto"},
        "app.tasks.blockchain.*": {"queue": "blockchain"},
        "app.tasks.merkle.*": {"queue": "crypto"},
    },
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)
