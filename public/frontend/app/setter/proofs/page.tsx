'use client';

import { useEffect, useState } from 'react';
import { setterApi, type SetterExam } from '@/lib/api/setter';
import SetterSectionLanding from '@/components/setter/SectionLanding';

export default function ProofsIndexPage() {
  const [exams, setExams] = useState<SetterExam[]>([]);

  useEffect(() => {
    setterApi.exams().then((r) => setExams(r.items)).catch(() => setExams([]));
  }, []);

  return (
    <SetterSectionLanding
      icon=""
      title="ZK Proofs"
      subtitle="Zero-knowledge proof ceremonies across your exam catalogue"
      intro="Run the pre-proof checklist, generate the Groth16 zero-knowledge proof of your paper's properties, anchor it on Polygon, and perform the final irreversible paper lock. Pick an exam to open its proof ceremony."
      exams={exams}
      basePath="/setter/proofs"
      ctaLabel="Open Proof Ceremony"
      meta={(e) => (e.zk_proof_hash ? 'ZK proof on-chain ✓' : 'Awaiting proof')}
    />
  );
}
