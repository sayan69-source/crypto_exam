/**
 * CryptoExam Core — Invigilator biometric enrollment store.
 *
 * Persists the real enrollment (128-float face descriptor, WebAuthn credential
 * id, captured IP) in localStorage, keyed by staff email. This is genuine
 * device-local enrollment: the same browser can register a person and later
 * verify them against that record.
 *
 * DPDP: only the derived face *descriptor* is stored, never a photo; only the
 * WebAuthn credential id is stored, never a raw fingerprint.
 *
 * (When a backend is reachable, callers may additionally POST the enrollment to
 * /api/v1/invigilator — but the gateway works fully offline with this store.)
 */

'use client';

import type { FingerprintCredential } from './webauthn';

const KEY = 'cryptoexam_invigilator_enrollments';

export interface InvigilatorEnrollment {
  staffId: string;                 // email — the lookup key
  fullName: string;
  faceDescriptor: number[];        // 128 floats
  faceDetectionScore: number;
  fingerprint: FingerprintCredential | null;
  ip: string;
  ipSource: string;
  userAgent: string;
  registeredAt: string;
}

type Store = Record<string, InvigilatorEnrollment>;

function read(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function saveEnrollment(e: InvigilatorEnrollment): void {
  const store = read();
  store[e.staffId.toLowerCase()] = e;
  write(store);
}

export function getEnrollment(staffId: string): InvigilatorEnrollment | null {
  return read()[staffId.toLowerCase()] ?? null;
}

export function hasEnrollment(staffId: string): boolean {
  return !!getEnrollment(staffId);
}

export function listEnrollments(): InvigilatorEnrollment[] {
  return Object.values(read()).sort((a, b) => (b.registeredAt > a.registeredAt ? 1 : -1));
}

export function deleteEnrollment(staffId: string): void {
  const store = read();
  delete store[staffId.toLowerCase()];
  write(store);
}
