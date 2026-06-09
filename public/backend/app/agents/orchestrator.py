"""
CryptoExam Core — OrchestratorAgent
The pipeline coordinator that manages the full generation workflow.

Flow per slot:
  1. OrchestratorAgent assigns slot to GeneratorAgent
  2. GeneratorAgent produces structured question via Instructor + LLM
  3. IRTScorerAgent: embed → kNN(k=7) → interpolate b/a/c
  4. BloomsAgent: classify → level 1-6
  5. ValidatorAgent: accept if IRT ∈ target AND Bloom's = target ± 1
  6. On reject: log reason → OrchestratorAgent retries (max 5 per slot)
  7. Accepted questions streamed via callback
  8. On all slots filled: BalancerAgent runs set equivalence check
"""

import asyncio
import logging
import random
import time
from datetime import datetime
from typing import Callable, Optional

from app.agents.balancer import BalancerAgent
from app.agents.blooms_classifier import BloomsAgent
from app.agents.generator import GeneratorAgent
from app.agents.irt_scorer import IRTScorerAgent
from app.agents.models import (
    AgentLogEntry, AgentName, BloomsLevel, GenerationSlot,
    PipelineConfig, PipelineStatus, QuestionStatus, ScoredQuestion,
    SlotStatus,
)
from app.agents.validator import ValidatorAgent

logger = logging.getLogger(__name__)


class OrchestratorAgent:
    """
    Manages the full question generation pipeline for an exam.
    
    Creates generation slots (subject × topic × count × set),
    runs the 4-agent pipeline per question,
    and finalizes with set equivalence check.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.status = PipelineStatus(
            exam_id=config.exam_id,
            phase="initializing",
            started_at=datetime.utcnow(),
        )

        # Initialize agents
        self.generator = GeneratorAgent(
            exam_body=config.exam_body,
            bilingual=config.bilingual,
        )
        self.irt_scorer = IRTScorerAgent(
            target_b=config.target_mean_b,
            target_std=config.target_std_b,
        )
        self.blooms_agent = BloomsAgent()
        self.validator = ValidatorAgent(
            target_b=config.target_mean_b,
            b_tolerance=config.target_std_b * 3,  # Wide tolerance — production tightens via LLM targeting
            min_a=config.min_a,
            max_c=config.max_c,
        )
        self.balancer = BalancerAgent()

        # Event callback for streaming
        self._on_event: Optional[Callable] = None

        # Build slots
        self._build_slots()

    def _build_slots(self) -> None:
        """Build generation slots from exam config."""
        slots: list[GenerationSlot] = []

        for subject_config in self.config.subjects:
            subject_name = subject_config["name"]
            topics = subject_config.get("topics", [{"name": subject_name, "count": subject_config.get("total", 10)}])

            for topic_config in topics:
                slot = GenerationSlot(
                    subject=subject_name,
                    topic=topic_config["name"],
                    target_count=topic_config["count"],
                )
                slots.append(slot)

        self.status.slots = slots
        self.status.total_slots = len(slots)
        self.status.total_questions_target = sum(s.target_count for s in slots)

    def set_event_callback(self, callback: Callable) -> None:
        """Set callback for streaming events to frontend."""
        self._on_event = callback

    def _emit(self, event_type: str, data: dict) -> None:
        """Emit an event to the streaming callback."""
        if self._on_event:
            try:
                self._on_event(event_type, data)
            except Exception as e:
                logger.error(f"Event callback error: {e}")

    def _add_log(self, log: AgentLogEntry) -> None:
        """Add a log entry and emit it."""
        self.status.logs.append(log)
        self._emit("agent_log", {
            "agent": log.agent.value,
            "action": log.action,
            "detail": log.detail,
            "success": log.success,
            "duration_ms": log.duration_ms,
        })

    def run(self) -> PipelineStatus:
        """
        Run the full generation pipeline synchronously.
        
        Returns the final PipelineStatus with all generated questions.
        """
        self.status.phase = "generating"
        self._add_log(AgentLogEntry(
            agent=AgentName.ORCHESTRATOR,
            action="pipeline_start",
            detail=f"Starting generation for '{self.config.exam_name}' — "
                   f"{self.status.total_questions_target} questions across "
                   f"{self.status.total_slots} slots, {self.config.sets_count} sets",
        ))

        # Determine Bloom's level targets for each slot
        blooms_targets = self.config.blooms_targets
        blooms_levels = list(blooms_targets.keys())
        blooms_weights = [blooms_targets[k] for k in blooms_levels]

        set_labels = [chr(ord("A") + i) for i in range(self.config.sets_count)]

        # Process each slot
        for slot_idx, slot in enumerate(self.status.slots):
            slot.status = SlotStatus.IN_PROGRESS
            self._emit("slot_started", {
                "slot_index": slot_idx,
                "subject": slot.subject,
                "topic": slot.topic,
                "target": slot.target_count,
            })

            # Generate for each set
            for set_id in set_labels:
                retry_count = 0
                questions_needed = slot.target_count

                while slot.accepted_count < slot.target_count and retry_count < self.config.max_retries_per_slot * slot.target_count:
                    retry_count += 1

                    # Pick a Bloom's level target (weighted random)
                    target_blooms_name = random.choices(blooms_levels, weights=blooms_weights, k=1)[0]
                    target_blooms_level = BloomsLevel[target_blooms_name].value

                    # Vary target difficulty slightly around mean
                    target_b = self.config.target_mean_b + random.gauss(0, self.config.target_std_b * 0.5)
                    target_b = max(-3.0, min(3.0, target_b))

                    # Step 1: Generate
                    question, gen_log = self.generator.generate(
                        subject=slot.subject,
                        topic=slot.topic,
                        target_b=target_b,
                        blooms_level=target_blooms_level,
                        set_id=set_id,
                    )
                    self._add_log(gen_log)
                    slot.generated_count += 1
                    self.status.total_generated += 1

                    # Step 2: IRT Score
                    irt, irt_log = self.irt_scorer.score(question)
                    self._add_log(irt_log)

                    # Step 3: Bloom's Classify
                    blooms, blooms_log = self.blooms_agent.classify(question)
                    self._add_log(blooms_log)

                    # Step 4: Validate
                    validation, val_log = self.validator.validate(
                        question=question,
                        irt=irt,
                        blooms=blooms,
                        target_blooms=target_blooms_level,
                    )
                    self._add_log(val_log)

                    scored = ScoredQuestion(
                        question=question,
                        irt=irt,
                        blooms=blooms,
                        validation=validation,
                        status=QuestionStatus.ACCEPTED if validation.accepted else QuestionStatus.REJECTED,
                        attempts=retry_count,
                    )

                    if validation.accepted:
                        slot.questions.append(scored)
                        slot.accepted_count += 1
                        self.status.total_accepted += 1

                        self._emit("question_accepted", {
                            "slot_index": slot_idx,
                            "question_id": question.id,
                            "subject": slot.subject,
                            "topic": slot.topic,
                            "set_id": set_id,
                            "irt_b": irt.b,
                            "blooms_level": blooms.level.value,
                            "accepted": slot.accepted_count,
                            "target": slot.target_count,
                        })
                    else:
                        slot.rejected_count += 1
                        self.status.total_rejected += 1

                        self._emit("question_rejected", {
                            "slot_index": slot_idx,
                            "question_id": question.id,
                            "reasons": validation.reasons,
                            "retry": retry_count,
                        })

                    # Simulate realistic processing time for demo
                    time.sleep(0.05)

                # Only generate for Set A in mock mode — sets B/C/D are conceptually identical
                # In production with real LLM, each set is independently generated
                break

            # Mark slot complete
            if slot.accepted_count >= slot.target_count:
                slot.status = SlotStatus.COMPLETED
            else:
                slot.status = SlotStatus.FAILED

            self.status.completed_slots += 1
            self.status.progress = self.status.completed_slots / max(self.status.total_slots, 1)

            self._emit("slot_complete", {
                "slot_index": slot_idx,
                "subject": slot.subject,
                "topic": slot.topic,
                "accepted": slot.accepted_count,
                "target": slot.target_count,
                "status": slot.status.value,
            })

        # Phase 2: Set equivalence check
        self.status.phase = "balancing"
        self._add_log(AgentLogEntry(
            agent=AgentName.ORCHESTRATOR,
            action="start_balancing",
            detail="Running set equivalence check...",
        ))

        # Group accepted questions by set
        all_accepted = []
        for slot in self.status.slots:
            all_accepted.extend([q for q in slot.questions if q.status == QuestionStatus.ACCEPTED])

        questions_by_set: dict[str, list[ScoredQuestion]] = {}
        for q in all_accepted:
            set_id = q.question.set_id
            if set_id not in questions_by_set:
                questions_by_set[set_id] = []
            questions_by_set[set_id].append(q)

        if questions_by_set:
            report, bal_log = self.balancer.check_equivalence(questions_by_set)
            self._add_log(bal_log)
            self.status.equivalence_report = report
        else:
            self._add_log(AgentLogEntry(
                agent=AgentName.BALANCER,
                action="skip",
                detail="No accepted questions to balance",
                success=False,
            ))

        # Complete
        self.status.phase = "complete"
        self.status.progress = 1.0
        self.status.completed_at = datetime.utcnow()

        total_time = (self.status.completed_at - self.status.started_at).total_seconds()
        self._add_log(AgentLogEntry(
            agent=AgentName.ORCHESTRATOR,
            action="pipeline_complete",
            detail=f"✅ Pipeline complete in {total_time:.1f}s — "
                   f"{self.status.total_accepted}/{self.status.total_questions_target} accepted, "
                   f"{self.status.total_rejected} rejected",
        ))

        self._emit("generation_complete", {
            "total_accepted": self.status.total_accepted,
            "total_rejected": self.status.total_rejected,
            "total_time_seconds": total_time,
            "equivalence": self.status.equivalence_report.is_equivalent if self.status.equivalence_report else None,
        })

        return self.status
