/**
 * CryptoExam Core — § 27.6 Resilient answer sync.
 *
 * Local-first: every answer is written to IndexedDB before any network call, so
 * answers are never lost if the network drops. A timer flushes pending answers to
 * the server; on failure it stays queued and retries on the next tick / reconnect.
 */

import { examStore, type AnswerRecord } from './local-store';
import { getAuthToken } from '@/lib/api/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface SyncStatus {
  pending: number;
  lastSyncAt: number | null;
  online: boolean;
}

export class AnswerSyncManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSyncAt: number | null = null;
  private online = true;

  constructor(
    private readonly examId: string,
    private readonly candidateId: string,
    private readonly intervalMs = 30_000,
    private readonly onStatus?: (s: SyncStatus) => void,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    if (typeof window !== 'undefined') window.addEventListener('online', this.handleOnline);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.handleOnline);
  }

  private handleOnline = () => { this.online = true; void this.flush(); };

  private async hashAnswer(qId: string, answer: number | string): Promise<string> {
    const data = new TextEncoder().encode(`${this.examId}:${qId}:${answer}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Record an answer (local-first), then attempt an opportunistic sync. */
  async recordAnswer(questionId: string, answer: number | string): Promise<void> {
    const record: AnswerRecord = {
      examId: this.examId, questionId, answer,
      timestamp: Date.now(), localHash: await this.hashAnswer(questionId, answer), synced: false,
    };
    await examStore.saveAnswer(record);
    await this.flush();
  }

  /** Flush pending answers to the server; failures stay queued for retry. */
  async flush(): Promise<void> {
    const pending = await examStore.getPendingAnswers(this.examId);
    this.emit(pending.length);
    if (pending.length === 0) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/sessions/answers/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          examId: this.examId, candidateId: this.candidateId,
          answers: pending, clientTime: Date.now(),
        }),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      await examStore.markSynced(this.examId, pending.map((a) => a.questionId));
      this.lastSyncAt = Date.now();
      this.online = true;
      this.emit(0);
    } catch {
      // Offline / server unreachable — keep local copy, retry next tick.
      this.online = false;
      this.emit(pending.length);
    }
  }

  private async emit(pending: number) {
    this.onStatus?.({ pending, lastSyncAt: this.lastSyncAt, online: this.online });
  }
}

export default AnswerSyncManager;
