/**
 * CryptoExam Core — § 27 Local store (IndexedDB wrapper).
 *
 * Holds the pre-positioned ENCRYPTED question paper (downloaded before T₀) and
 * a local-first answer log. At T₀ only the 256-bit unlock key is broadcast; the
 * paper is already on the candidate's machine — zero server round-trip to decrypt.
 */

const DB_NAME = 'cryptoexam';
const DB_VERSION = 1;
const STORE_PAPERS = 'encrypted_papers';
const STORE_ANSWERS = 'answers';

export interface AnswerRecord {
  examId: string;
  questionId: string;
  answer: number | string;
  timestamp: number;
  localHash?: string;
  synced?: boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PAPERS)) db.createObjectStore(STORE_PAPERS, { keyPath: 'examId' });
      if (!db.objectStoreNames.contains(STORE_ANSWERS)) {
        const s = db.createObjectStore(STORE_ANSWERS, { keyPath: ['examId', 'questionId'] });
        s.createIndex('byExam', 'examId', { unique: false });
        s.createIndex('bySynced', 'synced', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

export const examStore = {
  /** Persist the encrypted paper blob (pre-positioned 0–4h before T₀). */
  async saveEncryptedPaper(examId: string, blob: ArrayBuffer): Promise<void> {
    await tx(STORE_PAPERS, 'readwrite', (s) => s.put({ examId, blob, storedAt: Date.now() }));
  },

  async getEncryptedPaper(examId: string): Promise<ArrayBuffer | null> {
    const rec = await tx<{ blob: ArrayBuffer } | undefined>(STORE_PAPERS, 'readonly', (s) => s.get(examId));
    return rec?.blob ?? null;
  },

  async hasEncryptedPaper(examId: string): Promise<boolean> {
    const rec = await tx<unknown>(STORE_PAPERS, 'readonly', (s) => s.get(examId));
    return !!rec;
  },

  async saveAnswer(record: AnswerRecord): Promise<void> {
    await tx(STORE_ANSWERS, 'readwrite', (s) => s.put({ ...record, synced: record.synced ?? false }));
  },

  async getPendingAnswers(examId: string): Promise<AnswerRecord[]> {
    const all = await tx<AnswerRecord[]>(STORE_ANSWERS, 'readonly', (s) => s.index('byExam').getAll(examId));
    return (all || []).filter((a) => !a.synced);
  },

  async markSynced(examId: string, questionIds: string[]): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_ANSWERS, 'readwrite');
      const s = t.objectStore(STORE_ANSWERS);
      questionIds.forEach((qid) => {
        const g = s.get([examId, qid]);
        g.onsuccess = () => { const r = g.result; if (r) { r.synced = true; s.put(r); } };
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};

export default examStore;
