"""
CryptoExam Core — § 28 Question Setting Portal: three creation modes.

  POST /api/v1/question-modes/mode1/upload-and-generate   (Completely AI Made)
  POST /api/v1/question-modes/mode2/upload-and-upgrade    (Human + AI Upgraded)
  POST /api/v1/question-modes/mode3/upload-human-paper    (Completely Human Made)
  GET  /api/v1/question-modes/pipeline-status/{task_id}

Heavy work runs in a FastAPI BackgroundTask with an in-memory task registry and
a polling status endpoint (mirrors the existing AI-generation route — no Celery
required to run locally). Swap the registry for Redis/Celery in production.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from pydantic import BaseModel

from app.models import UserRole
from app.services.auth import require_role
from app.services.question_modes import mode1_service, mode2_service, mode3_service, red_team_agent

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory pipeline registry: task_id -> {status, progress, message, result, error}
_TASKS: dict[str, dict] = {}


def _new_task() -> str:
    tid = str(uuid.uuid4())
    _TASKS[tid] = {
        "task_id": tid, "status": "PENDING", "progress": 0,
        "message": "Queued", "result": None, "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return tid


def _progress_cb(tid: str):
    def cb(pct: int, msg: str):
        t = _TASKS.get(tid)
        if t:
            t["status"] = "PROGRESS"
            t["progress"] = pct
            t["message"] = msg
    return cb


async def _run(tid: str, coro_factory):
    try:
        result = await coro_factory(_progress_cb(tid))
        t = _TASKS[tid]
        t["status"] = "SUCCESS"
        t["progress"] = 100
        t["message"] = "Complete"
        t["result"] = result
    except Exception as e:  # noqa: BLE001
        logger.exception("Pipeline %s failed", tid)
        t = _TASKS.get(tid, {})
        t["status"] = "FAILURE"
        t["error"] = str(e)


# ── Mode 1 — Completely AI Made ──────────────────────────────────────────

@router.post("/mode1/upload-and-generate", summary="Mode 1 — AI generate from seed + syllabus")
async def mode1_generate(
    background: BackgroundTasks,
    questions_pdf: UploadFile = File(...),
    syllabus_pdf: UploadFile = File(...),
    exam_id: str = Form("draft"),
    total_questions: int = Form(30),
    difficulty: str = Form("MEDIUM"),
    current=Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    q_bytes = await questions_pdf.read()
    s_bytes = await syllabus_pdf.read()
    tid = _new_task()
    background.add_task(_run, tid, lambda cb: mode1_service.run(
        q_bytes, s_bytes, exam_id, total_questions=total_questions, difficulty=difficulty, progress=cb))
    return {"task_id": tid, "status": "PROCESSING", "mode": "COMPLETELY_AI_MADE"}


# ── Mode 2 — Human Made + AI Upgraded ────────────────────────────────────

@router.post("/mode2/upload-and-upgrade", summary="Mode 2 — AI upgrade a human paper")
async def mode2_upgrade(
    background: BackgroundTasks,
    question_paper_pdf: UploadFile = File(...),
    syllabus_pdf: UploadFile | None = File(None),
    exam_id: str = Form("draft"),
    difficulty: str = Form("MEDIUM"),
    current=Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    p_bytes = await question_paper_pdf.read()
    s_bytes = await syllabus_pdf.read() if syllabus_pdf else None
    tid = _new_task()
    background.add_task(_run, tid, lambda cb: mode2_service.run(
        p_bytes, s_bytes, exam_id, difficulty=difficulty, progress=cb))
    return {"task_id": tid, "status": "PROCESSING", "mode": "HUMAN_MADE_AI_UPGRADED"}


# ── Mode 3 — Completely Human Made ───────────────────────────────────────

@router.post("/mode3/upload-human-paper", summary="Mode 3 — parse + validate + encrypt key")
async def mode3_human(
    background: BackgroundTasks,
    question_paper_pdf: UploadFile = File(...),
    answer_key_pdf: UploadFile = File(...),
    exam_id: str = Form("draft"),
    expected_total: int | None = Form(None),
    current=Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    p_bytes = await question_paper_pdf.read()
    a_bytes = await answer_key_pdf.read()
    tid = _new_task()
    background.add_task(_run, tid, lambda cb: mode3_service.run(
        p_bytes, a_bytes, exam_id, expected_total=expected_total, progress=cb))
    return {"task_id": tid, "status": "PROCESSING", "mode": "COMPLETELY_HUMAN_MADE"}


# ── Status polling ───────────────────────────────────────────────────────

@router.get("/pipeline-status/{task_id}", summary="Poll pipeline status")
async def pipeline_status(task_id: str):
    return _TASKS.get(task_id, {"task_id": task_id, "status": "NOT_FOUND"})


# ── V3 §4.3 — AI Adversarial Red-Team Agent ─────────────────────────────

class RedTeamRequest(BaseModel):
    """Run the Red-Team Agent on a list of questions (typically a Mode 1/2/3 result)."""
    questions: list[dict]
    answer_key: dict[int, str] | None = None
    exam_id: str | None = None


@router.post("/red-team", summary="AI Red-Team Agent — three-persona attack")
async def red_team(
    body: RedTeamRequest,
    current=Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    """
    Attacks every question with three personas in parallel (Clever Student, RTI
    Officer, Opposition Lawyer). Returns a report with BLOCKER and WARN flags.

    The setter UI MUST disable the "Lock Paper" button while any BLOCKER exists.
    WARN flags may be acknowledged with a written reason. BLOCKERs cannot.
    """
    report = await red_team_agent.red_team_paper(body.questions, body.answer_key)
    logger.info(
        f"Red-Team: exam={body.exam_id} questions={report.total_questions} "
        f"blockers={len(report.blockers)} warnings={len(report.warnings)} backend={report.backend}"
    )
    return report.to_dict()
