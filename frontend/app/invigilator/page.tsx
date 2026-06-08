/**
 * CryptoExam Core — Interface D entry point.
 * Routes to the dashboard (AuthContext redirects to login if unauthenticated).
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InvigilatorIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/invigilator/dashboard'); }, [router]);
  return null;
}
