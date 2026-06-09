"""
§ 28.2 — PyMuPDF-based PDF extractor for question papers, syllabi and answer keys.

Handles NEET/JEE-style formatting (numbered Q1–Q200, multi-column, (A)-(D) options).
`fitz` (PyMuPDF) is used when available; a plain-text path (`*_from_text`) is exposed
for unit testing and for callers that already have extracted text.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except Exception:  # noqa: BLE001
    _HAS_FITZ = False
    logger.warning("PyMuPDF (fitz) not installed — PDF byte parsing disabled, text parsing still works")


@dataclass
class ParsedQuestion:
    question_number: int
    question_text: str
    option_A: str
    option_B: str
    option_C: str
    option_D: str
    correct_answer: Optional[str] = None     # only present after merging an answer key
    subject_guess: Optional[str] = None
    has_image: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


class QuestionPDFParser:
    # Question header anchored to line start: "Q.1 " / "Q 1 " / "1. " / "1) " / "Question 1 "
    _HEADER = re.compile(
        r'(?m)^[ \t]*(?:Q(?:uestion)?[.\s]*(\d{1,3})|(\d{1,3})[.)])[.)\s]',
        re.IGNORECASE,
    )
    # Option marker: "(A) ", "A) ", "A. "
    _OPT = re.compile(r'(?:\(([A-D])\)|\b([A-D])[.)])\s', re.IGNORECASE)
    # Answer key entries: "1. B", "1) B", "1 - B", "Q1 B"
    _ANS = re.compile(r'(?:Q\.?\s*)?(\d{1,3})\s*[).:\-]?\s*\(?([A-D])\)?', re.IGNORECASE)

    _SUBJECT_KW = {
        "Physics": ['velocity', 'force', 'electric', 'magnetic', 'momentum', 'photon', 'projectile', 'energy'],
        "Chemistry": ['electron', 'mole', 'ph', 'oxidation', 'compound', 'bond', 'reaction', 'orbital', 'benzene'],
        "Biology": ['mitosis', 'dna', 'enzyme', 'chromosome', 'gene', 'organ', 'cell', 'mitochondria'],
        "Mathematics": ['integral', 'derivative', 'matrix', 'probability', 'vector', 'equation', 'function'],
    }

    # ── text extraction ──────────────────────────────────────────────────

    @staticmethod
    def _text_from_pdf(pdf_bytes: bytes) -> str:
        if not _HAS_FITZ:
            raise RuntimeError("PyMuPDF not installed; cannot parse PDF bytes")
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            return "\n".join(page.get_text("text") for page in doc)
        finally:
            doc.close()

    @staticmethod
    def _pdf_has_images(pdf_bytes: bytes) -> int:
        if not _HAS_FITZ:
            return 0
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            return sum(len(page.get_images(full=True)) for page in doc)
        finally:
            doc.close()

    # ── public: question paper ───────────────────────────────────────────

    def parse_question_paper(self, pdf_bytes: bytes) -> list[ParsedQuestion]:
        text = self._text_from_pdf(pdf_bytes)
        return self.parse_question_paper_from_text(text)

    def parse_question_paper_from_text(self, text: str) -> list[ParsedQuestion]:
        """Block-based extraction: split on line-anchored headers, then parse options."""
        headers = list(self._HEADER.finditer(text))
        questions: list[ParsedQuestion] = []
        for i, h in enumerate(headers):
            num = int(h.group(1) or h.group(2))
            start = h.end()
            end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
            block = text[start:end]
            stem, options = self._split_block(block)
            if not options:
                continue
            q = ParsedQuestion(
                question_number=num,
                question_text=re.sub(r'\s+', ' ', stem).strip(),
                option_A=options.get("A", ""),
                option_B=options.get("B", ""),
                option_C=options.get("C", ""),
                option_D=options.get("D", ""),
                subject_guess=self._guess_subject(stem),
            )
            questions.append(q)
        return questions

    def _split_block(self, block: str) -> tuple[str, dict[str, str]]:
        markers = list(self._OPT.finditer(block))
        if not markers:
            return block, {}
        stem = block[: markers[0].start()]
        options: dict[str, str] = {}
        for j, m in enumerate(markers):
            letter = (m.group(1) or m.group(2)).upper()
            o_start = m.end()
            o_end = markers[j + 1].start() if j + 1 < len(markers) else len(block)
            if letter not in options:  # keep first occurrence (A,B,C,D)
                options[letter] = re.sub(r'\s+', ' ', block[o_start:o_end]).strip()
        return stem, options

    # ── public: syllabus ─────────────────────────────────────────────────

    def parse_syllabus(self, pdf_bytes: bytes) -> dict:
        return self.parse_syllabus_from_text(self._text_from_pdf(pdf_bytes))

    def parse_syllabus_from_text(self, text: str) -> dict:
        """Heuristic syllabus structure: {subject: [topics]}."""
        subjects: dict[str, list[str]] = {}
        current = "General"
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            # A short ALL-CAPS line (or "Subject:" header) denotes a subject section
            is_header = (
                ':' not in line and not line[0].isdigit() and len(line) < 40
                and (line.isupper() or line.rstrip(':').isupper())
            )
            if is_header:
                current = line.title()
                subjects.setdefault(current, [])
            else:
                topic = re.sub(r'^[\d.)\-•\s]+', '', line).strip()
                if topic:
                    subjects.setdefault(current, []).append(topic[:120])
        return {"subjects": subjects, "topic_count": sum(len(v) for v in subjects.values())}

    # ── public: answer key ───────────────────────────────────────────────

    def parse_answer_key(self, pdf_bytes: bytes) -> dict[int, str]:
        return self.parse_answer_key_from_text(self._text_from_pdf(pdf_bytes))

    def parse_answer_key_from_text(self, text: str) -> dict[int, str]:
        key: dict[int, str] = {}
        for m in self._ANS.finditer(text):
            num = int(m.group(1))
            ans = m.group(2).upper()
            if num not in key:
                key[num] = ans
        return key

    # ── helpers ──────────────────────────────────────────────────────────

    def _guess_subject(self, text: str) -> str:
        low = text.lower()
        scores = {s: sum(1 for w in kw if w in low) for s, kw in self._SUBJECT_KW.items()}
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "General"

    def has_images(self, pdf_bytes: bytes) -> int:
        return self._pdf_has_images(pdf_bytes)


pdf_parser = QuestionPDFParser()
