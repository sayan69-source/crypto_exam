'use client';

import { mockExams } from '@/lib/api/mock-data';
import SetterSectionLanding from '@/components/setter/SectionLanding';

export default function GenerateIndexPage() {
  return (
    <SetterSectionLanding
      icon="🤖"
      title="AI Question Generation"
      subtitle="Multi-agent question generation across your exam catalogue"
      intro="The GeneratorAgent drafts questions to your subject and Bloom's blueprint, the IRTScorerAgent screens each item for difficulty and discrimination, and the ValidatorAgent rejects anything out of range. Pick an exam to open its live generation run."
      exams={mockExams}
      basePath="/setter/generate"
      ctaLabel="Open Generator"
      meta={(e) => {
        const total = e.subject_taxonomy?.subjects?.reduce((n, s) => n + (s.question_count || 0), 0) ?? 0;
        return `${total} questions`;
      }}
    />
  );
}
