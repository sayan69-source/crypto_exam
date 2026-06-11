"use client";
/**
 * Candidate Examination Portal (§10.1) — runs on an ASSIGNED candidate seat,
 * kiosk, LAN-only. The terminal moves through:
 *
 *   poll seat → (ASSIGNED) → roll+DOB login (§9.7) → exam → seal+submit (§11)
 *             → receipt (inclusion witness + node-signed root)
 *
 * What the candidate's answers do on submit is the security spine: the record
 * R is sealed to the SYSTEM ADMIN key in this browser (lib/answer-seal.ts),
 * the data key is wrapped and forgotten, and only ciphertext + a hash leaf
 * leave the seat. Neither this terminal nor the centre can read it back (INV-6).
 *
 * The paper is delivered by the §10.7 sealed pipeline: the Edge serves the
 * keyless, on-chain-committed bundle (lib/question-crypto.ts verifies it against
 * the Merkle root), and each question is decrypted lazily only after the T₀
 * beacon is released — no question is readable before the synchronized start.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  candidateLogin,
  examBeacon,
  getTerminalId,
  questionBundle,
  sealingKey,
  seatState,
  submitAnswer,
  EdgeError,
  type Receipt,
} from "@/lib/edge";
import { sealRecord, receiptNonce, type AnswerRecord, type ResponseEntry } from "@/lib/answer-seal";
import { deriveMasterSeed, openQuestion, verifyBundleAgainstRoot, type SealedBundle, type SealedItem } from "@/lib/question-crypto";

type Phase = "BOOT" | "WAIT_ASSIGN" | "LOGIN" | "EXAM" | "SEALING" | "RECEIPT" | "ERROR";

// A decrypted question as the §10.7 pipeline delivers it (shape sealed by the
// website / staged on the Edge — see edge-server/src/lib/question-seal.ts).
interface LiveQuestion {
  id: string;
  seq: number;
  subject?: string;
  prompt: string;
  options: string[];
}

// Fallback exam id only until the seat binding names the real one. The exam a
// seat serves is whatever the invigilator bound to it — NOT a constant — so a
// centre running several exams at once delivers the correct paper per seat.
const FALLBACK_EXAM_ID = "44444444-4444-4444-4444-444444444444";

export default function CandidatePortal() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("BOOT");
  const [terminalId, setTid] = useState<string | null>(null);
  const [examId, setExamId] = useState<string>(FALLBACK_EXAM_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = getTerminalId();
    setTid(id);
    setPhase(id ? "WAIT_ASSIGN" : "ERROR");
    if (!id) setError("No terminal identity. Open the Gate first.");
  }, []);

  // ── poll seat assignment (§9.6) ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== "WAIT_ASSIGN" || !terminalId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await seatState(terminalId);
        if (stop) return;
        if (s.binding?.examId) setExamId(s.binding.examId); // the seat's real exam
        if (s.state === "ASSIGNED") setPhase("LOGIN");
        else if (s.state === "ATTENDED" || s.state === "IN_EXAM") setPhase("EXAM");
      } catch {
        /* Edge blip — keep polling; the Gate's health wall covers a real outage */
      }
      if (!stop) timer = setTimeout(tick, 2_000);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [phase, terminalId]);

  if (phase === "BOOT") return <Shell state="BOOT"><p>Initialising seat…</p></Shell>;

  if (phase === "ERROR")
    return (
      <Shell state="LOCKED">
        <h1>Seat unavailable.</h1>
        <p style={{ color: "#94a3b8" }}>{error}</p>
        <button onClick={() => router.push("/")} style={btnGhost}>← Back to Gate</button>
      </Shell>
    );

  if (phase === "WAIT_ASSIGN")
    return (
      <Shell state="AWAITING ASSIGNMENT">
        <h1>Waiting for seat assignment.</h1>
        <p style={{ color: "#94a3b8" }}>
          Your invigilator will verify you (face + fingerprint) and the system
          will assign you a seat. This screen advances on its own — there is
          nothing to press.
        </p>
        <span style={{ marginTop: 18, display: "inline-block", color: "#64748b", fontSize: 13 }}>
          seat <code>{terminalId?.slice(0, 8)}…</code> · polling the Centre Edge
        </span>
      </Shell>
    );

  if (phase === "LOGIN")
    return <LoginCard terminalId={terminalId!} onAttended={() => setPhase("EXAM")} />;

  if (phase === "RECEIPT") return null; // handled inside ExamCard

  return (
    <ExamCard
      terminalId={terminalId!}
      examId={examId}
      onError={(m) => {
        setError(m);
        setPhase("ERROR");
      }}
    />
  );
}

// ════════════════════════ roll + DOB login (§9.7) ══════════════════════════
function LoginCard({ terminalId, onAttended }: { terminalId: string; onAttended: () => void }) {
  const [roll, setRoll] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await candidateLogin({ terminalId, roll: roll.trim(), dob: dob.trim() });
      onAttended();
    } catch (e) {
      const reason = e instanceof EdgeError ? e.body.reason : (e as Error).message;
      setError(
        reason === "ROLL_NOT_BOUND_TO_SEAT"
          ? "This seat is bound to a different roll (INV-5). Use the seat you were assigned."
          : reason === "DOB_MISMATCH"
            ? "Roll or date of birth does not match."
            : reason === "LOCKED_TOO_MANY_ATTEMPTS"
              ? "Too many attempts — this seat is locked. Call your invigilator."
              : `Login denied · ${reason}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell state="CANDIDATE LOGIN">
      <h1>Confirm your identity</h1>
      <p style={{ color: "#94a3b8", fontSize: 14 }}>
        Enter your roll number and date of birth. This seat accepts only the
        roll the invigilator bound to it (§9.7).
      </p>
      <label style={label}>Roll number</label>
      <input value={roll} onChange={(e) => setRoll(e.target.value)} style={field} placeholder="R-1461" />
      <label style={label}>Date of birth (YYYY-MM-DD)</label>
      <input value={dob} onChange={(e) => setDob(e.target.value)} style={field} placeholder="2005-01-01" />
      {error && <p role="alert" style={{ color: "#fca5a5", fontSize: 14, marginTop: 12 }}>{error}</p>}
      <button disabled={busy || !roll || !dob} onClick={submit} style={btnPrimary}>
        {busy ? "Verifying…" : "Begin examination"}
      </button>
    </Shell>
  );
}

// ════════════════ exam + sealed delivery + seal + receipt (§10.7 / §11) ═════
// Question states for the TCS-iON-style palette.
type QState = "NOT_VISITED" | "NOT_ANSWERED" | "ANSWERED" | "MARKED" | "ANSWERED_MARKED";

function ExamCard({ terminalId, examId, onError }: { terminalId: string; examId: string; onError: (m: string) => void }) {
  // ── §10.7 sealed delivery state ──────────────────────────────────────────
  const [loadState, setLoadState] = useState<"LOADING" | "BEFORE_T0" | "READY">("LOADING");
  const [bundle, setBundle] = useState<SealedBundle | null>(null);
  const master = useRef<Uint8Array | null>(null);
  const itemById = useRef<Map<string, SealedItem>>(new Map());
  const [questions, setQuestions] = useState<LiveQuestion[]>([]);

  // ── candidate progress state ─────────────────────────────────────────────
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [visited, setVisited] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<number | null>(null); // current selection, not yet saved
  const [sealing, setSealing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const startedAt = useRef(new Date().toISOString());
  const revisions = useRef<Record<string, number>>({});

  // 1) fetch the keyless bundle, verify it against the on-chain root, then wait
  //    for the T₀ beacon to derive the master seed (no question is readable
  //    before T₀). Each question is decrypted lazily on first visit.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const b = await questionBundle(examId, terminalId);
        if (stop) return;
        const ok = await verifyBundleAgainstRoot(b.bundle, b.questionsRoot);
        if (!ok) return onError("Question bundle failed its on-chain integrity check (§10.7) — refusing to render.");
        b.bundle.items.forEach((it) => itemById.current.set(it.question_id, it));
        setBundle(b.bundle);

        const pollBeacon = async () => {
          try {
            const beacon = await examBeacon(examId, terminalId);
            if (stop) return;
            master.current = await deriveMasterSeed(beacon.beacon, beacon.hkdfSalt, examId);
            if (beacon.t0At) startedAt.current = new Date(beacon.t0At).toISOString();
            setLoadState("READY");
            await openInto(0, b.bundle); // decrypt the first question
          } catch (e) {
            if (e instanceof EdgeError && e.status === 425) {
              setLoadState("BEFORE_T0");
              timer = setTimeout(pollBeacon, 3_000); // T₀ not reached yet
            } else throw e;
          }
        };
        await pollBeacon();
      } catch (e) {
        if (!stop) onError(`Could not load the paper · ${e instanceof EdgeError ? e.body.reason : (e as Error).message}`);
      }
    })();
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // exam countdown (display only; the Edge window gate is the real authority)
  useEffect(() => {
    const dur = 180 * 60 * 1000;
    const t = setInterval(() => {
      const left = dur - (Date.now() - new Date(startedAt.current).getTime());
      setRemaining(Math.max(0, left));
    }, 1000);
    return () => clearInterval(t);
  }, [loadState]);

  // Lazily decrypt question `i` (verifies its Merkle proof again inside open).
  const openInto = useCallback(async (i: number, b: SealedBundle) => {
    const item = b.items[i];
    if (!item || !master.current) return;
    if (questions.some((q) => q.id === item.question_id)) return;
    try {
      const plain = await openQuestion(item, master.current, examId, b.questionsRoot);
      const q: LiveQuestion = {
        id: item.question_id,
        seq: item.sequence_number ?? i + 1,
        subject: typeof plain.subject === "string" ? plain.subject : undefined,
        prompt: String(plain.prompt ?? ""),
        options: Array.isArray(plain.options) ? (plain.options as string[]) : [],
      };
      setQuestions((qs) => [...qs, q].sort((a, z) => a.seq - z.seq));
    } catch (e) {
      onError(`Question ${item.question_id} refused to open · ${(e as Error).message}`);
    }
  }, [questions, onError]);

  const current = useMemo(() => bundle ? bundle.items[idx] : null, [bundle, idx]);
  const currentQ = useMemo(() => current ? questions.find((q) => q.id === current.question_id) ?? null : null, [current, questions]);

  // when navigating, decrypt the target + restore its saved selection
  useEffect(() => {
    if (loadState !== "READY" || !bundle || !current) return;
    setVisited((v) => ({ ...v, [current.question_id]: true }));
    setPick(answers[current.question_id] ?? null);
    void openInto(idx, bundle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, loadState, bundle]);

  const stateOf = useCallback((qid: string): QState => {
    const a = qid in answers, m = marked[qid];
    if (a && m) return "ANSWERED_MARKED";
    if (m) return "MARKED";
    if (a) return "ANSWERED";
    if (visited[qid]) return "NOT_ANSWERED";
    return "NOT_VISITED";
  }, [answers, marked, visited]);

  const saveCurrent = useCallback((nextMark: boolean) => {
    if (!current) return;
    const qid = current.question_id;
    if (pick != null) {
      setAnswers((a) => {
        if (qid in a && a[qid] !== pick) revisions.current[qid] = (revisions.current[qid] ?? 0) + 1;
        return { ...a, [qid]: pick };
      });
    }
    if (nextMark) setMarked((m) => ({ ...m, [qid]: true }));
    if (bundle && idx < bundle.items.length - 1) setIdx(idx + 1);
  }, [current, pick, bundle, idx]);

  const clearResponse = useCallback(() => {
    if (!current) return;
    const qid = current.question_id;
    setPick(null);
    setAnswers((a) => { const c = { ...a }; delete c[qid]; return c; });
  }, [current]);

  const answeredCount = Object.keys(answers).length;

  async function sealAndSubmit() {
    if (!bundle) return;
    setSealing(true);
    try {
      const { pem } = await sealingKey();
      // The answer is bound to the EXACT on-chain question leaf (not a label),
      // so the System Admin can pair each response to its committed question.
      const responses: ResponseEntry[] = bundle.items.map((it) => ({
        question_hash: "0x" + it.leaf,
        chosen_option: it.question_id in answers ? String.fromCharCode(65 + answers[it.question_id]) : "",
        answered_at_ms: Date.now(),
        revision_count: revisions.current[it.question_id] ?? 0,
      }));
      const record: AnswerRecord = {
        exam_id: examId,
        subject_ref: "seat:" + terminalId.slice(0, 8), // pseudonymous, no PII
        responses,
        timing: { started: startedAt.current, submitted: new Date().toISOString() },
        anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
        receipt_nonce: receiptNonce(),
      };
      const sealed = await sealRecord(record, pem);
      const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      const res = await submitAnswer({
        terminalId, ct: hex(sealed.ct), iv: hex(sealed.iv), tag: hex(sealed.tag), wrappedDk: hex(sealed.wrappedDk),
      });
      setReceipt(res.receipt);
    } catch (e) {
      const reason = e instanceof EdgeError ? e.body.reason : (e as Error).message;
      onError(`Submission failed · ${reason}`);
    } finally {
      setSealing(false);
    }
  }

  if (receipt) return <ReceiptCard receipt={receipt} answered={answeredCount} total={bundle?.items.length ?? 0} />;

  if (loadState !== "READY") {
    return (
      <div style={examPage}>
        <ExamHeader remaining={null} terminalId={terminalId} />
        <div style={{ display: "grid", placeItems: "center", flex: 1, padding: 40 }}>
          <div style={{ textAlign: "center", maxWidth: 460 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1e3a8a" }}>
              {loadState === "LOADING" ? "Verifying the sealed question paper…" : "Waiting for the exam to start (T₀)…"}
            </div>
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
              {loadState === "LOADING"
                ? "The paper arrived as sealed ciphertext and is being checked, question by question, against the blockchain-committed root. Nothing renders unless every question matches."
                : "The paper is verified and held sealed on this device. It can only be decrypted at the synchronized start beacon (T₀) — the same instant for every candidate in the country. This screen advances on its own."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const item = current!;
  const qid = item.question_id;
  return (
    <div style={examPage}>
      <ExamHeader remaining={remaining} terminalId={terminalId} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", flex: 1, minHeight: 0 }}>
        {/* ── question panel ── */}
        <section style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", background: "#fafaf9", borderBottom: "1px solid #e2e8f0" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1e3a8a" }}>Question {idx + 1}</span>
            {currentQ?.subject && <span style={subjectPill}>{currentQ.subject}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>+4 / −1</span>
          </div>

          <div style={{ padding: "22px 24px", overflow: "auto", flex: 1 }}>
            {!currentQ ? (
              <p style={{ color: "#64748b" }}>Decrypting question…</p>
            ) : (
              <>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: "#0f172a", margin: "0 0 20px" }}>{currentQ.prompt}</p>
                <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
                  {currentQ.options.map((opt, oi) => (
                    <label key={oi} style={optRow(pick === oi)}>
                      <input type="radio" name={qid} checked={pick === oi} onChange={() => setPick(oi)} style={{ accentColor: "#1e40af" }} />
                      <span style={{ fontWeight: 600, color: "#475569", minWidth: 18 }}>{String.fromCharCode(65 + oi)}.</span>
                      <span style={{ color: "#0f172a" }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* action bar */}
          <div style={{ display: "flex", gap: 10, padding: "12px 24px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", flexWrap: "wrap" }}>
            <button onClick={() => saveCurrent(true)} style={actBtn("#fff", "#64748b")}>Mark for Review &amp; Next</button>
            <button onClick={clearResponse} style={actBtn("#fff", "#64748b")}>Clear Response</button>
            <button onClick={() => saveCurrent(false)} style={{ ...actBtn("#15803d", "#15803d"), color: "#fff", marginLeft: "auto" }}>
              Save &amp; Next
            </button>
          </div>
        </section>

        {/* ── palette + submit ── */}
        <aside style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#fff" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
            <PaletteLegend />
          </div>
          <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {bundle!.items.map((it, i) => (
                <button key={it.question_id} onClick={() => setIdx(i)} title={it.question_id} style={paletteCell(stateOf(it.question_id), i === idx)}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: 16, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>
              Answered <strong>{answeredCount}</strong> / {bundle!.items.length} · all answers encrypted on this device (INV-6)
            </div>
            <button disabled={sealing} onClick={sealAndSubmit} style={{ ...submitBtn, opacity: sealing ? 0.7 : 1 }}>
              {sealing ? "Sealing & submitting…" : "Submit examination"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ExamHeader({ remaining, terminalId }: { remaining: number | null; terminalId: string }) {
  const mm = remaining == null ? "—" : String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = remaining == null ? "—" : String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 24px", background: "#1e3a8a", color: "#fff" }}>
      <strong style={{ fontSize: 15, letterSpacing: "0.02em" }}>NEET 2026 · Slot 1</strong>
      <span style={{ fontSize: 12, opacity: 0.8 }}>ZUUP-OS secure terminal</span>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 12, opacity: 0.85 }}>seat {terminalId.slice(0, 8)}…</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.12)", padding: "6px 12px", borderRadius: 8, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ fontSize: 11, opacity: 0.8 }}>TIME LEFT</span>
          <strong style={{ fontSize: 16 }}>{mm}:{ss}</strong>
        </span>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#cbd5e1", display: "grid", placeItems: "center", color: "#1e3a8a", fontWeight: 700 }}>C</span>
      </div>
    </header>
  );
}

function PaletteLegend() {
  const rows: Array<[QState, string]> = [
    ["ANSWERED", "Answered"],
    ["NOT_ANSWERED", "Not Answered"],
    ["NOT_VISITED", "Not Visited"],
    ["MARKED", "Marked for Review"],
    ["ANSWERED_MARKED", "Answered & Marked"],
  ];
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map(([s, label]) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#475569" }}>
          <span style={{ ...paletteCell(s, false), width: 22, height: 22, minWidth: 22, fontSize: 10, cursor: "default" }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function ReceiptCard({ receipt, answered, total }: { receipt: Receipt; answered: number; total: number }) {
  return (
    <div style={examPage}>
      <ExamHeader remaining={null} terminalId="" />
      <div style={{ display: "grid", placeItems: "center", flex: 1, padding: "32px 16px", overflow: "auto" }}>
        <div style={{ width: "min(620px, 96vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "30px 32px" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#dcfce7", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <span style={{ color: "#15803d", fontSize: 28 }}>✓</span>
          </div>
          <h1 style={{ textAlign: "center", margin: "0 0 4px", fontSize: 22, color: "#0f172a" }}>Examination submitted</h1>
          <p style={{ textAlign: "center", color: "#64748b", fontSize: 14, margin: "0 0 18px" }}>
            {answered} of {total} questions answered. Your responses were encrypted on this device,
            sealed to the System Admin key, and committed to the centre hash-chain (INV-6 / §11.3).
          </p>
          <dl style={receiptBox}>
            <Row k="leaf #" v={String(receipt.leafIndex)} />
            <Row k="leaf" v={receipt.leaf} mono />
            <Row k="prev root" v={receipt.prevRoot} mono />
            <Row k="chain root" v={receipt.root} mono />
            <Row k="node signature" v={receipt.nodeRootSig} mono />
            <Row k="node pubkey" v={receipt.nodePubkey} mono />
          </dl>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 14, textAlign: "center" }}>
            root = SHA-256(prev root ‖ leaf). Verifiable against the root the System Admin anchors on-chain (§11.5).
          </p>
        </div>
      </div>
    </div>
  );
}

// ── presentation helpers (light, TCS-iON-style throughout) ──────────────────
function Shell({ state, children }: { state: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", background: "#f1f5f9", padding: "40px 16px" }}>
      <div style={{ width: "min(560px, 96vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "30px 32px", textAlign: "left" }}>
        <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "4px 10px", borderRadius: 999, marginBottom: 14 }}>{state}</span>
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, padding: "6px 0", borderBottom: "1px solid #eef2f7" }}>
      <dt style={{ color: "#64748b", fontSize: 12 }}>{k}</dt>
      <dd style={{ margin: 0, fontSize: mono ? 11 : 13, fontFamily: mono ? "ui-monospace, monospace" : "inherit", color: "#1e40af", wordBreak: "break-all" }}>{v}</dd>
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#475569", marginTop: 14, fontWeight: 600 };
const field: React.CSSProperties = {
  width: "100%", padding: "11px 13px", marginTop: 5, borderRadius: 8, border: "1px solid #cbd5e1",
  background: "#fff", color: "#0f172a", fontFamily: "ui-monospace, monospace", fontSize: 15,
};
const btnPrimary: React.CSSProperties = {
  width: "100%", marginTop: 20, padding: "14px", borderRadius: 10, border: "none",
  background: "#1e40af", color: "#fff", fontWeight: 600, fontSize: 16, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  marginTop: 16, padding: "9px 14px", borderRadius: 10, border: "1px solid #cbd5e1",
  background: "transparent", color: "#475569", fontSize: 13, cursor: "pointer",
};
const receiptBox: React.CSSProperties = {
  marginTop: 18, padding: "12px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc",
};

// ── exam-surface styles ─────────────────────────────────────────────────────
const examPage: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", background: "#fff", color: "#0f172a" };
const subjectPill: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "2px 8px", borderRadius: 999 };

function optRow(selected: boolean): React.CSSProperties {
  return {
    display: "flex", gap: 10, alignItems: "center", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
    border: selected ? "2px solid #1e40af" : "1px solid #e2e8f0",
    background: selected ? "#eff6ff" : "#fff",
  };
}
function actBtn(bg: string, border: string): React.CSSProperties {
  return { padding: "9px 14px", borderRadius: 8, border: `1px solid ${border}`, background: bg, color: border, fontSize: 13, fontWeight: 600, cursor: "pointer" };
}
const submitBtn: React.CSSProperties = {
  width: "100%", padding: "13px", borderRadius: 10, border: "none", background: "#15803d", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
};

// TCS-iON palette colours.
function paletteCell(state: QState, active: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 40, height: 36, minWidth: 40, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
    display: "grid", placeItems: "center", border: active ? "2px solid #0f172a" : "1px solid transparent",
  };
  switch (state) {
    case "ANSWERED": return { ...base, background: "#22c55e", color: "#fff" };
    case "NOT_ANSWERED": return { ...base, background: "#ef4444", color: "#fff" };
    case "MARKED": return { ...base, background: "#7c3aed", color: "#fff" };
    case "ANSWERED_MARKED": return { ...base, background: "#7c3aed", color: "#fff", boxShadow: "inset 0 -8px 0 -4px #22c55e" };
    default: return { ...base, background: "#e2e8f0", color: "#334155" };
  }
}
