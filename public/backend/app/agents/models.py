"""
CryptoExam Core — Agent Data Models
All Pydantic models for the 6-agent AI pipeline.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ═══════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════

class BloomsLevel(int, Enum):
    """Bloom's Taxonomy cognitive levels."""
    REMEMBER = 1
    UNDERSTAND = 2
    APPLY = 3
    ANALYZE = 4
    EVALUATE = 5
    CREATE = 6


class AgentName(str, Enum):
    GENERATOR = "GeneratorAgent"
    IRT_SCORER = "IRTScorerAgent"
    BLOOMS = "BloomsAgent"
    NCERT_ALIGN = "NCERTAlignAgent"
    VALIDATOR = "ValidatorAgent"
    BALANCER = "BalancerAgent"
    ORCHESTRATOR = "OrchestratorAgent"


class SlotStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class QuestionStatus(str, Enum):
    GENERATED = "generated"
    SCORED = "scored"
    CLASSIFIED = "classified"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


# ═══════════════════════════════════════════════
# Core Question Model
# ═══════════════════════════════════════════════

class GeneratedQuestion(BaseModel):
    """
    Structured output from the GeneratorAgent.
    Uses Instructor + Pydantic for guaranteed schema compliance from LLM.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str = Field(..., min_length=20, description="Question text in English")
    text_hi: Optional[str] = Field(None, description="Hindi translation for bilingual exams")
    options: dict[str, str] = Field(..., description='{"A": "...", "B": "...", "C": "...", "D": "..."}')
    options_hi: Optional[dict[str, str]] = Field(None, description="Hindi options")
    correct_option: str = Field(..., description="Correct answer: A, B, C, or D")
    explanation: str = Field(..., description="Explanation — used for IRT calibration, never shown to candidates")
    subject: str = Field(..., description="Subject: Physics, Chemistry, Biology, Math, etc.")
    topic: str = Field(..., description="Topic within subject")
    ncert_chapter: Optional[str] = Field(None, description='e.g., "NCERT Physics Part 1, Chapter 3"')
    set_id: str = Field(default="A", description="Which set: A, B, C, D")

    @field_validator("correct_option")
    @classmethod
    def valid_option(cls, v: str) -> str:
        if v not in ("A", "B", "C", "D"):
            raise ValueError("correct_option must be A, B, C, or D")
        return v

    @field_validator("options")
    @classmethod
    def four_options(cls, v: dict[str, str]) -> dict[str, str]:
        required = {"A", "B", "C", "D"}
        if set(v.keys()) != required:
            raise ValueError(f"Options must have exactly keys {required}")
        return v


# ═══════════════════════════════════════════════
# IRT Parameters
# ═══════════════════════════════════════════════

class IRTScore(BaseModel):
    """
    3-Parameter Logistic (3PL) IRT model parameters.
    b = difficulty (-3 to +3), a = discrimination (0.5-3.0), c = guessing (0-0.25)
    """
    b: float = Field(..., ge=-3.0, le=3.0, description="Difficulty parameter")
    a: float = Field(..., ge=0.3, le=3.5, description="Discrimination parameter")
    c: float = Field(..., ge=0.0, le=0.35, description="Guessing parameter")
    confidence: float = Field(default=0.85, ge=0.0, le=1.0, description="Scoring confidence")

    @property
    def difficulty_label(self) -> str:
        if self.b < -1.5:
            return "very_easy"
        elif self.b < -0.5:
            return "easy"
        elif self.b < 0.5:
            return "medium"
        elif self.b < 1.5:
            return "hard"
        else:
            return "very_hard"


# ═══════════════════════════════════════════════
# Bloom's Classification
# ═══════════════════════════════════════════════

class BloomsClassification(BaseModel):
    """Bloom's Taxonomy classification result."""
    level: BloomsLevel
    confidence: float = Field(ge=0.0, le=1.0)
    detected_verbs: list[str] = Field(default_factory=list)

    @property
    def level_name(self) -> str:
        return self.level.name.capitalize()


# ═══════════════════════════════════════════════
# Validation Result
# ═══════════════════════════════════════════════

class ValidationResult(BaseModel):
    """Accept/reject decision from the ValidatorAgent."""
    accepted: bool
    reasons: list[str] = Field(default_factory=list)
    irt_in_range: bool = True
    blooms_matches: bool = True
    no_duplicate: bool = True
    option_quality_ok: bool = True


# ═══════════════════════════════════════════════
# Pipeline Models
# ═══════════════════════════════════════════════

class ScoredQuestion(BaseModel):
    """A question that has passed through the full pipeline."""
    question: GeneratedQuestion
    irt: IRTScore
    blooms: BloomsClassification
    validation: ValidationResult
    status: QuestionStatus = QuestionStatus.GENERATED
    attempts: int = 1
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class GenerationSlot(BaseModel):
    """A slot in the generation matrix: subject × topic × count."""
    subject: str
    topic: str
    target_count: int
    generated_count: int = 0
    accepted_count: int = 0
    rejected_count: int = 0
    status: SlotStatus = SlotStatus.PENDING
    questions: list[ScoredQuestion] = Field(default_factory=list)

    @property
    def is_filled(self) -> bool:
        return self.accepted_count >= self.target_count

    @property
    def progress(self) -> float:
        if self.target_count == 0:
            return 1.0
        return min(1.0, self.accepted_count / self.target_count)


class AgentLogEntry(BaseModel):
    """Structured log entry from any agent."""
    agent: AgentName
    action: str
    detail: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    success: bool = True
    duration_ms: float = 0.0


class SetEquivalenceReport(BaseModel):
    """Report from BalancerAgent on set equivalence."""
    sets_compared: list[str]
    mean_b_per_set: dict[str, float]
    std_b_per_set: dict[str, float]
    blooms_distribution_per_set: dict[str, dict[str, int]]
    max_mean_b_deviation: float
    max_std_b_deviation: float
    is_equivalent: bool
    swap_suggestions: list[str] = Field(default_factory=list)


class PipelineConfig(BaseModel):
    """Configuration for a full generation pipeline run."""
    exam_id: str
    exam_name: str
    exam_body: str = "NTA"
    subjects: list[dict] = Field(
        ...,
        description='[{"name": "Physics", "topics": [{"name": "Mechanics", "count": 5}], "total": 30}]'
    )
    sets_count: int = Field(default=4, ge=1, le=8)
    target_mean_b: float = Field(default=0.0, ge=-2.0, le=2.0)
    target_std_b: float = Field(default=1.0, ge=0.3, le=2.0)
    min_a: float = Field(default=0.5, ge=0.3, le=1.5)
    max_c: float = Field(default=0.25, ge=0.1, le=0.35)
    blooms_targets: dict[str, float] = Field(
        default_factory=lambda: {
            "REMEMBER": 0.10,
            "UNDERSTAND": 0.25,
            "APPLY": 0.30,
            "ANALYZE": 0.20,
            "EVALUATE": 0.10,
            "CREATE": 0.05,
        }
    )
    max_retries_per_slot: int = Field(default=5, ge=1, le=10)
    bilingual: bool = True


class PipelineStatus(BaseModel):
    """Current status of a generation pipeline run."""
    exam_id: str
    phase: str = "initializing"  # initializing, generating, balancing, complete, failed
    total_slots: int = 0
    completed_slots: int = 0
    total_questions_target: int = 0
    total_generated: int = 0
    total_accepted: int = 0
    total_rejected: int = 0
    progress: float = 0.0
    slots: list[GenerationSlot] = Field(default_factory=list)
    logs: list[AgentLogEntry] = Field(default_factory=list)
    equivalence_report: Optional[SetEquivalenceReport] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
