'use client';

/**
 * The sealed-question pipeline demo — extracted from /pipeline so Home can
 * show the same thing without a second implementation.
 *
 * This is not a mockup. It runs the REAL per-question cryptography in the
 * browser (lib/exam/question-pipeline.ts, the WebCrypto twin of the backend's
 * question_sealing.py): six questions are sealed under individual keys, a
 * Merkle root is computed, and nothing can be read until the beacon is
 * released at T₀ — at which point each question decrypts only as you open it.
 *
 * The `tamper` control flips one byte of a question's ciphertext. The AES-GCM
 * tag and the Merkle proof then both fail, and the terminal refuses to render
 * it. That refusal is the whole argument of the product, demonstrated rather
 * than asserted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './LucideIcon';
import {
  deriveMasterSeed, sealExamQuestions, openQuestion,
  QuestionIntegrityError, QuestionDecryptError,
  type SealedBundle, type SealedItem,
} from '@/lib/exam/question-pipeline';
import s from './PipelineDemo.module.css';

const EXAM_ID = 'e1a2b3c4-5678-90ab-cdef-1234567890ab';

const MOCK_QUESTIONS = [
  { id: 'q1-aaaa', sequence_number: 1, subject: 'Physics', text: 'A body moves with constant acceleration. Which quantity stays constant?', options: { A: 'Velocity', B: 'Acceleration', C: 'Displacement', D: 'Kinetic energy' }, correct_option: 'B' },
  { id: 'q2-bbbb', sequence_number: 2, subject: 'Mathematics', text: 'The derivative of sin(x) with respect to x is:', options: { A: 'cos(x)', B: '−cos(x)', C: 'tan(x)', D: '−sin(x)' }, correct_option: 'A' },
  { id: 'q3-cccc', sequence_number: 3, subject: 'Chemistry', text: 'Which gas is liberated when a metal reacts with a dilute acid?', options: { A: 'Oxygen', B: 'Nitrogen', C: 'Hydrogen', D: 'Chlorine' }, correct_option: 'C' },
  { id: 'q4-dddd', sequence_number: 4, subject: 'Biology', text: 'The powerhouse of the cell is the:', options: { A: 'Nucleus', B: 'Ribosome', C: 'Mitochondrion', D: 'Golgi body' }, correct_option: 'C' },
  { id: 'q5-eeee', sequence_number: 5, subject: 'Logic', text: 'If all Bloops are Razzies and all Razzies are Lazzies, then all Bloops are:', options: { A: 'Lazzies', B: 'Not Lazzies', C: 'Some Razzies', D: 'Undetermined' }, correct_option: 'A' },
  { id: 'q6-ffff', sequence_number: 6, subject: 'GK', text: 'The drand beacon used for T₀ key release is an example of:', options: { A: 'A private key', B: 'Public verifiable randomness', C: 'A password', D: 'A biometric' }, correct_option: 'B' },
];

type Phase = 'init' | 'sealed' | 'committed' | 'delivered' | 'live';
type Opened = { plain?: Record<string, unknown>; error?: string; verified?: boolean };

function trunc(hex: string, n = 22) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return clean.slice(0, n) + '…';
}

export default function PipelineDemo() {
  const [phase, setPhase] = useState<Phase>('init');
  const [bundle, setBundle] = useState<SealedBundle | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [seed, setSeed] = useState<Uint8Array | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const [tampered, setTampered] = useState<Record<string, boolean>>({});
  const beaconRef = useRef<{ beacon: string; salt: string }>({ beacon: '', salt: '' });

  // ── Stage 1: SEAL (on mount) ───────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const beacon = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      beaconRef.current = { beacon, salt };
      const masterSeed = await deriveMasterSeed(beacon, salt, EXAM_ID);
      const sealedBundle = await sealExamQuestions(MOCK_QUESTIONS, masterSeed, EXAM_ID);
      if (!alive) return;
      setBundle(sealedBundle);
      // a believable Polygon tx hash derived from the root (demo only)
      setTxHash('0x' + sealedBundle.questionsRoot.slice(2, 10) + 'b9f3a1c7d2e4…' + sealedBundle.questionsRoot.slice(-6));
      setPhase('sealed');
    })();
    return () => { alive = false; };
  }, []);

  // ── Stage advance ──────────────────────────────────────────────────────
  const advance = useCallback(async () => {
    if (phase === 'sealed') setPhase('committed');
    else if (phase === 'committed') setPhase('delivered');
    else if (phase === 'delivered') {
      // T₀: the drand beacon becomes public → terminal can now derive the seed
      const { beacon, salt } = beaconRef.current;
      setSeed(await deriveMasterSeed(beacon, salt, EXAM_ID));
      setPhase('live');
    }
  }, [phase]);

  // ── Lazy open one question (the candidate selected it) ─────────────────
  const select = useCallback(async (item: SealedItem) => {
    setCurrent(item.question_id);
    if (phase !== 'live' || !seed || !bundle) return;
    if (opened[item.question_id]?.plain && !tampered[item.question_id]) return; // already open

    // optionally corrupt the ciphertext to demonstrate tamper-evidence
    let toOpen = item;
    if (tampered[item.question_id]) {
      const ctBytes = item.ct.match(/.{2}/g)!.map((h) => parseInt(h, 16));
      ctBytes[0] ^= 0x01;
      toOpen = { ...item, ct: ctBytes.map((b) => b.toString(16).padStart(2, '0')).join('') };
    }

    try {
      const plain = await openQuestion(toOpen, seed, EXAM_ID, bundle.questionsRoot);
      setOpened((o) => ({ ...o, [item.question_id]: { plain, verified: true } }));
    } catch (e) {
      const msg = e instanceof QuestionIntegrityError ? e.message
        : e instanceof QuestionDecryptError ? e.message
        : 'Unknown error opening question.';
      setOpened((o) => ({ ...o, [item.question_id]: { error: msg } }));
    }
  }, [phase, seed, bundle, opened, tampered]);

  const toggleTamper = useCallback((id: string) => {
    setTampered((t) => ({ ...t, [id]: !t[id] }));
    setOpened((o) => { const n = { ...o }; delete n[id]; return n; }); // force re-open
  }, []);

  const stages: { key: Phase; label: string; icon: string }[] = [
    { key: 'sealed', label: 'Sealed by setter', icon: 'file-lock-2' },
    { key: 'committed', label: 'Committed on-chain', icon: 'git-branch' },
    { key: 'delivered', label: 'Delivered to terminal', icon: 'boxes' },
    { key: 'live', label: 'T₀ — beacon released', icon: 'satellite-dish' },
  ];
  const stageIdx = (['init', 'sealed', 'committed', 'delivered', 'live'] as Phase[]).indexOf(phase);
  const ctaLabel = phase === 'sealed' ? 'Commit questions root on-chain'
    : phase === 'committed' ? 'Pre-position sealed bundle on terminal'
    : phase === 'delivered' ? 'Reach T₀ — release the drand beacon'
    : '';

  const currentItem = bundle?.items.find((i) => i.question_id === current) || null;
  const currentOpened = current ? opened[current] : undefined;

  return (
    <>
      {/* pipeline rail */}
      <div className={s.railSection}>
        <div className={s.rail}>
          {stages.map((st, i) => {
            const reached = stageIdx >= i + 1;
            return (
              <div key={st.key} className={`${s.stage} ${reached ? s.stageOn : ''}`}>
                <span className={s.stageDot}><Icon name={reached ? 'check' : st.icon} size={16} strokeWidth={2} /></span>
                <span className={s.stageLabel}>{st.label}</span>
                {i < stages.length - 1 && <span className={s.stageBar} aria-hidden />}
              </div>
            );
          })}
        </div>

        <div className={s.commit}>
          <div className={s.commitItem}>
            <span className={s.commitK}>Questions Merkle root</span>
            <code className={s.commitV}>{bundle ? bundle.questionsRoot : 'computing…'}</code>
          </div>
          <div className={s.commitItem}>
            <span className={s.commitK}>Polygon tx</span>
            <code className={s.commitV}>{stageIdx >= 2 ? txHash : '— not committed yet —'}</code>
          </div>
          {ctaLabel && (
            <button className={`btn btn-primary ${s.cta}`} onClick={advance}>
              {ctaLabel} <Icon name="arrow-right" size={15} />
            </button>
          )}
          {phase === 'live' && (
            <span className={s.liveBadge}><Icon name="check-circle-2" size={15} /> Exam live — open any question</span>
          )}
        </div>
      </div>

      {/* interactive terminal */}
      <div className={s.termGrid}>
        {/* left: the sealed bundle on the terminal */}
        <div className={s.bundlePane}>
          <header className={s.paneHead}>
            <Icon name="boxes" size={16} /> Sealed bundle on the terminal
            <span className={s.paneNote}>{bundle?.count ?? 0} questions · keyless</span>
          </header>
          <ul className={s.qlist}>
            {bundle?.items.map((item) => {
              const o = opened[item.question_id];
              const isOpen = !!o?.plain;
              const isErr = !!o?.error;
              const active = current === item.question_id;
              return (
                <li key={item.question_id}>
                  <button
                    className={`${s.qrow} ${active ? s.qrowActive : ''} ${isOpen ? s.qrowOpen : ''} ${isErr ? s.qrowErr : ''}`}
                    onClick={() => select(item)}
                  >
                    <span className={s.qnum}>{item.sequence_number}</span>
                    <span className={s.qstate}>
                      <Icon name={isErr ? 'x' : isOpen ? 'eye' : 'lock'} size={15} strokeWidth={1.8} />
                    </span>
                    <span className={s.qcipher}>
                      {isOpen ? <em>decrypted in RAM</em> : <code>{trunc(item.ct)}</code>}
                    </span>
                  </button>
                  <button
                    className={`${s.tamper} ${tampered[item.question_id] ? s.tamperOn : ''}`}
                    onClick={() => toggleTamper(item.question_id)}
                    title="Flip one ciphertext byte to simulate tampering in transit"
                  >
                    <Icon name="swords" size={13} /> {tampered[item.question_id] ? 'tampered' : 'tamper'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* right: the question viewer (one at a time) */}
        <div className={s.viewerPane}>
          <header className={s.paneHead}>
            <Icon name="eye" size={16} /> Candidate view
            <span className={s.paneNote}>one question decrypted at a time</span>
          </header>

          {!currentItem && (
            <div className={s.viewerEmpty}>
              <Icon name="key-round" size={28} strokeWidth={1.4} />
              <p>Select a question on the left. It will decrypt <strong>only when you open it</strong>.</p>
            </div>
          )}

          {currentItem && phase !== 'live' && (
            <div className={s.viewerLocked}>
              <Icon name="lock" size={28} strokeWidth={1.4} />
              <p>This question is sealed. It cannot be read until <strong>T₀</strong>, when the drand beacon
                releases the master seed. Advance the pipeline above.</p>
              <code className={s.lockedHex}>{trunc(currentItem.ct, 48)}</code>
            </div>
          )}

          {currentItem && phase === 'live' && currentOpened?.error && (
            <div className={s.viewerError}>
              <Icon name="x" size={26} strokeWidth={1.8} />
              <h3>Question rejected</h3>
              <p>{currentOpened.error}</p>
              <span className={s.errHint}>The terminal refuses to render a question that fails its on-chain proof or AES-GCM tag.</span>
            </div>
          )}

          {currentItem && phase === 'live' && currentOpened?.plain && (
            <div className={s.viewerQ}>
              <div className={s.qmeta}>
                <span className={s.qsubject}>{String(currentOpened.plain.subject ?? '')}</span>
                <span className={s.verified}><Icon name="check-circle-2" size={14} /> Merkle-verified against on-chain root</span>
              </div>
              <p className={s.qtext}>{String(currentOpened.plain.text ?? '')}</p>
              <ul className={s.opts}>
                {Object.entries((currentOpened.plain.options ?? {}) as Record<string, string>).map(([k, v]) => (
                  <li key={k}><span className={s.optK}>{k}</span> {v}</li>
                ))}
              </ul>
              <p className={s.qfoot}><Icon name="lock" size={12} /> The correct answer was never delivered — grading stays server-side.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
