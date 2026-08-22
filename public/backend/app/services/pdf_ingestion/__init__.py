"""
§ 28.2 — Shared PDF ingestion pipeline (used by all three question modes).
"""

from app.services.pdf_ingestion.parser import (
    QuestionPDFParser,
    ParsedQuestion,
    pdf_parser,
)

__all__ = ["QuestionPDFParser", "ParsedQuestion", "pdf_parser"]
