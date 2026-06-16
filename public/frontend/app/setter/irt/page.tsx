'use client';

import { useEffect, useState } from 'react';
import { setterApi, type SetterExam } from '@/lib/api/setter';
import SetterSectionLanding from '@/components/setter/SectionLanding';

export default function IRTIndexPage() {
  const [exams, setExams] = useState<SetterExam[]>([]);

  useEffect(() => {
    setterApi.exams().then((r) => setExams(r.items)).catch(() => setExams([]));
  }, []);

  return (
    <SetterSectionLanding
      icon=""
      title="IRT Analytics"
      subtitle="Item Response Theory parameters across your exam catalogue"
      intro="Inspect each item's difficulty (b), discrimination (a) and guessing (c) parameters, validate the paper against your target distribution, and visualise difficulty vs. discrimination on the scatter plot. Pick an exam to open its parameter editor."
      exams={exams}
      basePath="/setter/irt"
      ctaLabel="View IRT"
      meta={(e) => `${e.sets_count ?? 0} sets`}
    />
  );
}
