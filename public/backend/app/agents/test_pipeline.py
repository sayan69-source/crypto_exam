"""
Quick smoke test for the AI Agent Pipeline.
Run: python -m app.agents.test_pipeline
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
os.environ["USE_MOCK_LLM"] = "true"
os.environ["PYTHONIOENCODING"] = "utf-8"

from app.agents.models import PipelineConfig
from app.agents.orchestrator import OrchestratorAgent


def test_pipeline():
    """Run a small test pipeline."""
    config = PipelineConfig(
        exam_id="test-exam-001",
        exam_name="NEET UG 2026 - Phase I (Test)",
        exam_body="NTA",
        subjects=[
            {
                "name": "Physics",
                "topics": [
                    {"name": "Mechanics", "count": 2},
                    {"name": "Optics", "count": 1},
                ],
                "total": 3,
            },
            {
                "name": "Chemistry",
                "topics": [
                    {"name": "Organic Chemistry", "count": 2},
                ],
                "total": 2,
            },
        ],
        sets_count=1,
        target_mean_b=0.0,
        target_std_b=1.5,  # Wider tolerance for mock
        bilingual=True,
    )

    # Collect events
    events = []
    accepted_count = 0
    rejected_count = 0

    def on_event(event_type, data):
        nonlocal accepted_count, rejected_count
        events.append((event_type, data))
        # Use only ASCII-safe prints
        if event_type == "question_accepted":
            accepted_count += 1
            subj = data.get('subject', '')
            topic = data.get('topic', '')
            print(f"  [ACCEPT] {subj}/{topic} (b={data.get('irt_b', 0):.2f}, L{data.get('blooms_level', 0)})")
        elif event_type == "question_rejected":
            rejected_count += 1
        elif event_type == "generation_complete":
            print(f"\n  PIPELINE COMPLETE: {data['total_accepted']} accepted, {data['total_rejected']} rejected in {data['total_time_seconds']:.1f}s")

    orchestrator = OrchestratorAgent(config)
    orchestrator.set_event_callback(on_event)

    print("=" * 60)
    print("CryptoExam Core - AI Agent Pipeline Test")
    print(f"Exam: {config.exam_name}")
    print(f"Slots: {orchestrator.status.total_slots}, Target: {orchestrator.status.total_questions_target} questions")
    print("=" * 60)

    status = orchestrator.run()

    print("")
    print("-" * 60)
    print(f"Final Status:")
    print(f"  Phase:    {status.phase}")
    print(f"  Accepted: {status.total_accepted}/{status.total_questions_target}")
    print(f"  Rejected: {status.total_rejected}")
    print(f"  Logs:     {len(status.logs)} entries")

    if status.equivalence_report:
        print(f"\n  Set Equivalence:")
        print(f"    Equivalent: {status.equivalence_report.is_equivalent}")
        for set_id, mb in status.equivalence_report.mean_b_per_set.items():
            print(f"    Set {set_id}: mean_b={mb:.3f}, std_b={status.equivalence_report.std_b_per_set[set_id]:.3f}")

    print(f"\n  Generated Questions:")
    for slot in status.slots:
        for sq in slot.questions:
            if sq.validation.accepted:
                text_preview = sq.question.text[:70].encode('ascii', 'replace').decode()
                print(f"    [{sq.question.subject}/{sq.question.topic}] b={sq.irt.b:+.2f} L{sq.blooms.level.value} | {text_preview}...")

    print("")
    print("=" * 60)
    print(f"Total events: {len(events)}")

    # Assertions
    assert status.phase == "complete", f"Expected complete, got {status.phase}"
    assert status.total_accepted > 0, "No questions were accepted!"
    print("[PASS] All assertions passed!")


if __name__ == "__main__":
    test_pipeline()
