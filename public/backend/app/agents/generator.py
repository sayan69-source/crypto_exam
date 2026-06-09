"""
CryptoExam Core — GeneratorAgent
Produces structured MCQ questions via Instructor + LLM or mock bank.
"""

import logging
import os
import random
import time
import uuid
from typing import Optional

from app.agents.models import AgentLogEntry, AgentName, GeneratedQuestion
from app.agents.mock_questions import ALL_QUESTIONS, get_questions_by_subject, get_questions_by_topic
from app.agents.prompts import get_prompt

logger = logging.getLogger(__name__)

USE_MOCK_LLM = os.getenv("USE_MOCK_LLM", "true").lower() == "true"


class GeneratorAgent:
    """
    Generates exam questions using LLM (Instructor + OpenAI) or mock bank.
    
    Pipeline step 1: OrchestratorAgent → GeneratorAgent → IRTScorerAgent
    """

    def __init__(self, exam_body: str = "NTA", bilingual: bool = True):
        self.exam_body = exam_body
        self.bilingual = bilingual
        self._mock_used: set[str] = set()  # Track used mock question IDs to avoid duplicates
        self._client = None

        if not USE_MOCK_LLM:
            try:
                from openai import OpenAI
                self._client = OpenAI()
                logger.info("GeneratorAgent: Using live LLM via OpenAI")
            except Exception as e:
                logger.warning(f"GeneratorAgent: OpenAI init failed ({e}), falling back to mock")

    def generate(
        self,
        subject: str,
        topic: str,
        target_b: float = 0.0,
        blooms_level: int = 3,
        set_id: str = "A",
    ) -> tuple[GeneratedQuestion, AgentLogEntry]:
        """
        Generate a single question for the given subject/topic/difficulty.
        
        Returns:
            (question, log_entry)
        """
        start = time.time()

        if USE_MOCK_LLM or self._client is None:
            question = self._generate_mock(subject, topic, target_b, set_id)
        else:
            question = self._generate_llm(subject, topic, target_b, blooms_level, set_id)

        duration_ms = (time.time() - start) * 1000

        log = AgentLogEntry(
            agent=AgentName.GENERATOR,
            action="generate_question",
            detail=f"{subject}/{topic} [set={set_id}, target_b={target_b:.1f}] → Q:{question.id[:8]}",
            success=True,
            duration_ms=duration_ms,
        )

        return question, log

    def _generate_mock(
        self,
        subject: str,
        topic: str,
        target_b: float,
        set_id: str,
    ) -> GeneratedQuestion:
        """Generate from mock bank with slight randomization for variety."""
        # Try topic-specific first, fall back to subject
        pool = get_questions_by_topic(subject, topic)
        if not pool:
            pool = get_questions_by_subject(subject)
        if not pool:
            pool = list(ALL_QUESTIONS)

        # Filter out already-used questions
        available = [q for q in pool if q.id not in self._mock_used]
        if not available:
            # Reset if exhausted
            self._mock_used.clear()
            available = pool

        base = random.choice(available)
        self._mock_used.add(base.id)

        # Create a fresh copy with new ID and set assignment
        return GeneratedQuestion(
            id=str(uuid.uuid4()),
            text=base.text,
            text_hi=base.text_hi if self.bilingual else None,
            options=dict(base.options),
            options_hi=dict(base.options_hi) if base.options_hi and self.bilingual else None,
            correct_option=base.correct_option,
            explanation=base.explanation,
            subject=base.subject,
            topic=base.topic or topic,
            ncert_chapter=base.ncert_chapter,
            set_id=set_id,
        )

    def _generate_llm(
        self,
        subject: str,
        topic: str,
        target_b: float,
        blooms_level: int,
        set_id: str,
    ) -> GeneratedQuestion:
        """Generate using Instructor + OpenAI structured output."""
        prompt = get_prompt(
            exam_body=self.exam_body,
            subject=subject,
            topic=topic,
            target_b=target_b,
            blooms_level=blooms_level,
        )

        try:
            import instructor
            client = instructor.from_openai(self._client)
            question = client.chat.completions.create(
                model="gpt-4o-mini",
                response_model=GeneratedQuestion,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Generate one {subject} MCQ on '{topic}' at difficulty b≈{target_b} and Bloom's level {blooms_level}."},
                ],
                max_retries=2,
            )
            question.set_id = set_id
            return question
        except Exception as e:
            logger.error(f"LLM generation failed: {e}, falling back to mock")
            return self._generate_mock(subject, topic, target_b, set_id)
