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

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

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


# ═══════════════════════════════════════════════════════════════════════════
# Finalise — commit a pipeline result to a real exam, seal it, lock it
# ═══════════════════════════════════════════════════════════════════════════
#
# All three paper modes produced questions and then had nowhere to put them:
# the pipeline result lived in memory and the "Finalize & Lock" button in the
# setter UI had no handler at all. A setter could upload a paper, watch it
# parse, and press the button that is the entire point of the screen — and
# nothing happened, with no error. This is the missing half.
#
# One call does the whole commit, because a half-committed paper (questions
# saved but not sealed) is worse than none: it looks ready and is not.

class FinalizeRequest(BaseModel):
    task_id: str
    exam_id: str
    """Optional — when the paper is already reviewed, go straight past DRAFT."""
    accept_all: bool = True


@router.post("/finalize", summary="Commit a pipeline result to an exam, seal and lock it")
async def finalize_paper(
    body: FinalizeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_role(UserRole.SETTER, UserRole.ADMIN)),
):
    from sqlalchemy import delete as sa_delete, select as sa_select

    from app.models import Exam, ExamStatus, Question, QuestionSource
    from app.services.exam_lifecycle import ZKProofUnavailable

    task = _TASKS.get(body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail={"reason": "UNKNOWN_TASK", "message": "That generation task is not on this server. Re-run the paper mode."})
    # The registry's terminal success state is "SUCCESS" (see _TASKS above);
    # accept "COMPLETE" too so a future rename does not silently break locking.
    if task.get("status") not in ("SUCCESS", "COMPLETE"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "PIPELINE_NOT_COMPLETE", "message": f"The pipeline is {task.get('status')}. Wait for it to finish before locking."},
        )

    questions = (task.get("result") or {}).get("questions") or []
    if not questions:
        raise HTTPException(status_code=422, detail={"reason": "NO_QUESTIONS", "message": "The pipeline produced no questions, so there is nothing to lock."})

    exam = (await db.execute(sa_select(Exam).where(Exam.id == body.exam_id))).scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail={"reason": "UNKNOWN_EXAM", "message": "No such exam. Create it first from the setter console."})
    if exam.status not in (ExamStatus.DRAFT, ExamStatus.GENERATING):
        raise HTTPException(
            status_code=409,
            detail={"reason": "EXAM_NOT_EDITABLE", "message": f"This exam is {exam.status.value}; a locked paper cannot be replaced. That immutability is the point."},
        )

    # Replace any earlier draft questions for this exam — re-running a mode
    # should not silently append a second paper to the same exam.
    await db.execute(sa_delete(Question).where(Question.exam_id == exam.id))

    stored = 0
    for i, q in enumerate(questions, start=1):
        opts = q.get("options") or {
            k: q.get(f"option_{k}") for k in ("A", "B", "C", "D") if q.get(f"option_{k}") is not None
        }
        correct = str(q.get("correct_option") or q.get("answer") or "A")[:1].upper()
        db.add(Question(
            exam_id=exam.id,
            sequence_number=q.get("question_number") or i,
            set_label=q.get("set_label"),
            text=q.get("question_text") or q.get("text") or "",
            text_hi=q.get("question_text_hi") or q.get("text_hi"),
            options=opts,
            options_hi=q.get("options_hi"),
            correct_option=correct,
            subject=q.get("subject"),
            topic=q.get("topic"),
            blooms_level=q.get("blooms_level"),
            irt_b=q.get("irt_b"), irt_a=q.get("irt_a"), irt_c=q.get("irt_c"),
            source=QuestionSource(task.get("mode_source", "AI_GENERATED"))
            if task.get("mode_source") else QuestionSource.AI_GENERATED,
            generation_model=task.get("model"),
            is_accepted=bool(body.accept_all),
        ))
        stored += 1

    exam.status = ExamStatus.PROOF_PENDING
    exam.total_questions = stored
    await db.commit()

    # Seal + lock. Each step reports honestly rather than being swallowed: a
    # setter needs to know whether the paper is merely saved or actually
    # committed, and those are very different states.
    steps: list[dict] = [{"step": "QUESTIONS_STORED", "ok": True, "detail": f"{stored} question(s) written to the exam"}]

    from uuid import UUID as _UUID

    try:
        from app.api.v1.delivery import seal_questions
        seal = await seal_questions(_UUID(str(exam.id)), db, current_user)
        root = getattr(seal, "questions_root", None) or getattr(seal, "questionsRoot", None)
        steps.append({"step": "SEALED", "ok": True, "detail": f"questionsRoot {str(root)[:20]}…"})
    except HTTPException as e:
        steps.append({"step": "SEALED", "ok": False, "detail": str(e.detail)})
    except Exception as e:
        steps.append({"step": "SEALED", "ok": False, "detail": str(e)})

    try:
        from app.services.exam_lifecycle import ExamLifecycleService
        zk = await ExamLifecycleService(db).generate_and_store_zk_proof(_UUID(str(exam.id)))
        steps.append({"step": "ZK_PROOF", "ok": True, "detail": f"Groth16 proof stored ({zk.get('protocol', 'groth16')})"})
    except ZKProofUnavailable as e:
        steps.append({"step": "ZK_PROOF", "ok": False, "detail": getattr(e, "message", str(e))})
    except Exception as e:
        steps.append({"step": "ZK_PROOF", "ok": False, "detail": str(e)})

    await db.commit()
    logger.info("Paper finalised: exam=%s questions=%s by=%s", exam.id, stored, current_user["user_id"])

    return {
        "ok": all(s["ok"] for s in steps),
        "examId": str(exam.id),
        "questionsStored": stored,
        "status": exam.status.value,
        "steps": steps,
    }
