"""
§ 28 — Question Setting Portal: three creation modes.

  Mode 1 (mode1_ai_made)  — Completely AI Made   (seed PDF + syllabus → generate)
  Mode 2 (mode2_hybrid)   — Human Made + AI Upgraded (paper + syllabus → improve)
  Mode 3 (mode3_human)    — Completely Human Made  (paper + answer key → validate + encrypt)

All three converge on the same downstream pipeline (IRT → ZK → lock).
"""

from app.services.question_modes.mode1_ai_made import mode1_service
from app.services.question_modes.mode2_hybrid import mode2_service
from app.services.question_modes.mode3_human import mode3_service
from app.services.question_modes.answer_key_crypto import encrypt_answer_key, decrypt_answer_key
from app.services.question_modes.red_team_agent import red_team_agent, RedTeamReport, RedTeamFlag, AttackType

__all__ = [
    "mode1_service", "mode2_service", "mode3_service",
    "encrypt_answer_key", "decrypt_answer_key",
    "red_team_agent", "RedTeamReport", "RedTeamFlag", "AttackType",
]
