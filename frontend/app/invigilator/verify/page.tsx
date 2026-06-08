/**
 * CryptoExam Core — /invigilator/verify redirect to the default centre.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VerifyIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/invigilator/verify/ctr-001'); }, [router]);
  return null;
}
