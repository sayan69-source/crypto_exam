'use client';

import { useEffect, useState } from 'react';
import { setterApi, type SetterExam } from '@/lib/api/setter';
import SetterSectionLanding from '@/components/setter/SectionLanding';

export default function GenerateIndexPage() {
  const [exams, setExams] = useState<SetterExam[]>([]);

  useEffect(() => {
    setterApi.exams().then((r) => setExams(r.items)).catch(() => setExams([]));
  }, []);

  return (
    <SetterSectionLanding
      icon=""
      title="AI Question Generation"
      subtitle="Multi-agent question generation across your exam catalogue"
      intro="The GeneratorAgent drafts questions to your subject and Bloom's blueprint, the IRTScorerAgent screens each item for difficulty and discrimination, and the ValidatorAgent rejects anything out of range. Pick an exam to open its live generation run."
      exams={exams}
      basePath="/setter/generate"
      ctaLabel="Open Generator"
      meta={(e) => `${e.sets_count ?? 0} sets`}
    />
  );
}
