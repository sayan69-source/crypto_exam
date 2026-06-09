/**
 * CryptoExam Core — § 27.5 Client-side paper delivery (zero server load at T₀).
 *
 * The encrypted paper (~2 MB) is pre-positioned in IndexedDB before T₀. At T₀ the
 * backend broadcasts only a 512-byte unlock event (beaconHash + HKDF salt). The
 * client derives the AES-GCM-256 key locally via HKDF and decrypts the paper with
 * the Web Crypto API — no server round-trip for decryption.
 */

import { examStore } from './local-store';

export interface ExamUnlockEvent {
  examId: string;
  drandRound?: number;
  beaconHash: string;  // hex
  hkdfSalt: string;    // hex
  timestamp?: number;
}

export interface DecryptedPaper {
  examId: string;
  paperHash?: string;
  questions: unknown[];
  [k: string]: unknown;
}

function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveAesKey(beaconHash: string, hkdfSalt: string, examId: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', hexToBuffer(beaconHash), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: hexToBuffer(hkdfSalt),
      info: new TextEncoder().encode(`cryptoexam:${examId}`),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/**
 * § 27.5 — unlock the pre-positioned paper at T₀.
 * Layout of the stored blob: [12-byte IV][AES-GCM ciphertext].
 */
export async function unlockExamPaper(unlockEvent: ExamUnlockEvent): Promise<DecryptedPaper> {
  const { beaconHash, hkdfSalt, examId } = unlockEvent;

  const encrypted = await examStore.getEncryptedPaper(examId);
  if (!encrypted) throw new Error('Paper not pre-loaded. Contact invigilator.');

  const aesKey = await deriveAesKey(beaconHash, hkdfSalt, examId, ['decrypt']);
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);

  const paper = JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedPaper;
  paper.paperHash = bufferToHex(await crypto.subtle.digest('SHA-256', plaintext)).slice(0, 32);
  return paper;
}

/**
 * Helper used during pre-positioning / tests: encrypt a paper with the same
 * HKDF→AES-GCM scheme and store it in IndexedDB. Returns the unlock event the
 * backend would broadcast at T₀.
 */
export async function prePositionPaper(examId: string, paper: DecryptedPaper, beaconHash: string, hkdfSalt: string): Promise<ExamUnlockEvent> {
  const aesKey = await deriveAesKey(beaconHash, hkdfSalt, examId, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(paper));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
  const blob = new Uint8Array(12 + ct.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ct), 12);
  await examStore.saveEncryptedPaper(examId, blob.buffer);
  return { examId, beaconHash, hkdfSalt, timestamp: Date.now() };
}
