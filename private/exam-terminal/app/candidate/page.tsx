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
 * The paper rendered here is minimal demo content. In production the sealed
 * per-question pipeline (lib/question-crypto.ts, §10.7) delivers the real paper
 * after the T₀ beacon; that is orthogonal to the answer-egress flow proven here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  candidateLogin,
  getTerminalId,
  sealingKey,
  seatState,
  submitAnswer,
  EdgeError,
  type Receipt,
} from "@/lib/edge";
import { sealRecord, receiptNonce, type AnswerRecord, type ResponseEntry } from "@/lib/answer-seal";

type Phase = "BOOT" | "WAIT_ASSIGN" | "LOGIN" | "EXAM" | "SEALING" | "RECEIPT" | "ERROR";

// Demo paper — three single-answer questions. Each question_hash stands in for
// the on-chain-verified question leaf the System Admin pairs against (§11.2).
const PAPER = [
  { id: "Q1", hash: "0x" + "a1".repeat(32), prompt: "A sealed answer leaves the seat as…", options: ["plaintext", "ciphertext", "a photograph"], correctHintIndex: 1 },
  { id: "Q2", hash: "0x" + "b2".repeat(32), prompt: "Who alone can decrypt an answer bundle?", options: ["the Centre Admin", "the invigilator", "the System Admin (HSM)"], correctHintIndex: 2 },
  { id: "Q3", hash: "0x" + "c3".repeat(32), prompt: "What proves a submission was not back-dated?", options: ["a timestamp", "the Merkle hash-chain + anchor", "trust"], correctHintIndex: 1 },
];

export default function CandidatePortal() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("BOOT");
  const [terminalId, setTid] = useState<string | null>(null);
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

// ════════════════════════ exam + seal + receipt (§11) ══════════════════════
function ExamCard({ terminalId, onError }: { terminalId: string; onError: (m: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [sealing, setSealing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const startedAt = useRef(new Date().toISOString());
  const revisions = useRef<Record<string, number>>({});

  const choose = useCallback((qid: string, idx: number) => {
    setAnswers((a) => {
      if (qid in a) revisions.current[qid] = (revisions.current[qid] ?? 0) + 1;
      return { ...a, [qid]: idx };
    });
  }, []);

  const allAnswered = useMemo(() => PAPER.every((q) => q.id in answers), [answers]);

  async function sealAndSubmit() {
    setSealing(true);
    try {
      const { pem } = await sealingKey();
      const responses: ResponseEntry[] = PAPER.map((q) => ({
        question_hash: q.hash,
        chosen_option: String.fromCharCode(65 + (answers[q.id] ?? 0)), // A/B/C
        answered_at_ms: Date.now(),
        revision_count: revisions.current[q.id] ?? 0,
      }));
      const record: AnswerRecord = {
        exam_id: "44444444-4444-4444-4444-444444444444",
        subject_ref: "seat:" + terminalId.slice(0, 8), // pseudonymous, no PII
        responses,
        timing: { started: startedAt.current, submitted: new Date().toISOString() },
        anomaly_summary: { tab_switch: 0, face_fail: 0, multi_face: 0 },
        receipt_nonce: receiptNonce(),
      };

      // Seal in-browser to the SA key; the DK is wrapped and dropped here.
      const sealed = await sealRecord(record, pem);
      const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      const res = await submitAnswer({
        terminalId,
        ct: hex(sealed.ct),
        iv: hex(sealed.iv),
        tag: hex(sealed.tag),
        wrappedDk: hex(sealed.wrappedDk),
      });
      setReceipt(res.receipt);
    } catch (e) {
      const reason = e instanceof EdgeError ? e.body.reason : (e as Error).message;
      onError(`Submission failed · ${reason}`);
    } finally {
      setSealing(false);
    }
  }

  if (receipt) return <ReceiptCard receipt={receipt} />;

  return (
    <main style={{ height: "100%", overflow: "auto", padding: "32px 8vw", background: "#0b1020", color: "#e6edf3" }}>
      <header style={{ marginBottom: 22 }}>
        <span className="screen-state" style={{ color: "#7c93b8" }}>EXAMINATION IN PROGRESS</span>
        <h1 style={{ fontSize: 22, marginTop: 6 }}>Answer all questions, then submit.</h1>
        <p style={{ color: "#7c93b8", fontSize: 13 }}>
          Your answers are encrypted on this device before they leave it. The
          centre stores only ciphertext (INV-6).
        </p>
      </header>

      <ol style={{ display: "grid", gap: 18, listStyle: "none", padding: 0, maxWidth: 720 }}>
        {PAPER.map((q, qi) => (
          <li key={q.id} style={{ border: "1px solid #233", borderRadius: 12, padding: 18, background: "#0f1626" }}>
            <strong style={{ fontSize: 15 }}>{qi + 1}. {q.prompt}</strong>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {q.options.map((opt, oi) => (
                <label
                  key={oi}
                  style={{
                    display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 8,
                    border: answers[q.id] === oi ? "1px solid #3b82f6" : "1px solid #233",
                    background: answers[q.id] === oi ? "rgba(59,130,246,0.12)" : "transparent", cursor: "pointer",
                  }}
                >
                  <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => choose(q.id, oi)} />
                  <span>{String.fromCharCode(65 + oi)}. {opt}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <button disabled={!allAnswered || sealing} onClick={sealAndSubmit} style={{ ...btnPrimary, maxWidth: 720 }}>
        {sealing ? "Sealing & committing…" : allAnswered ? "Seal & submit answers" : "Answer all questions to submit"}
      </button>
    </main>
  );
}

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <Shell state="SUBMITTED · RECEIPT">
      <h1>Examination submitted ✓</h1>
      <p style={{ color: "#94a3b8", fontSize: 14 }}>
        Your answers were sealed to the System Admin key and committed to the
        centre hash-chain. Keep this receipt — it proves your submission was
        recorded, unaltered, against a node-signed root (§11.3).
      </p>
      <dl style={receiptBox}>
        <Row k="leaf #" v={String(receipt.leafIndex)} />
        <Row k="leaf" v={receipt.leaf} mono />
        <Row k="prev root" v={receipt.prevRoot} mono />
        <Row k="chain root" v={receipt.root} mono />
        <Row k="node signature" v={receipt.nodeRootSig} mono />
        <Row k="node pubkey" v={receipt.nodePubkey} mono />
      </dl>
      <p style={{ color: "#64748b", fontSize: 12, marginTop: 14 }}>
        root = SHA-256(prev root ‖ leaf). Anyone can later verify this receipt
        against the root the System Admin anchors on-chain (§11.5).
      </p>
    </Shell>
  );
}

// ── presentation helpers ───────────────────────────────────────────────────
function Shell({ state, children }: { state: string; children: React.ReactNode }) {
  return (
    <div className="screen" style={{ background: "#0b1020" }}>
      <div className="screen-panel" style={{ background: "#0f1626", border: "1px solid #233", color: "#e6edf3", maxWidth: 560, textAlign: "left" }}>
        <span className="screen-state" style={{ color: "#7c93b8" }}>{state}</span>
        {children}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, padding: "5px 0", borderBottom: "1px solid #1c2740" }}>
      <dt style={{ color: "#7c93b8", fontSize: 12 }}>{k}</dt>
      <dd style={{ margin: 0, fontSize: mono ? 11 : 13, fontFamily: mono ? "ui-monospace, monospace" : "inherit", color: "#9ecbff", wordBreak: "break-all" }}>{v}</dd>
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#7c93b8", marginTop: 14 };
const field: React.CSSProperties = {
  width: "100%", padding: "11px 13px", marginTop: 5, borderRadius: 8, border: "1px solid #2a3550",
  background: "#0b1020", color: "#e6edf3", fontFamily: "ui-monospace, monospace", fontSize: 15,
};
const btnPrimary: React.CSSProperties = {
  width: "100%", marginTop: 20, padding: "14px", borderRadius: 10, border: "none",
  background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: 16, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  marginTop: 16, padding: "9px 14px", borderRadius: 10, border: "1px solid #2a3550",
  background: "transparent", color: "#94a3b8", fontSize: 13, cursor: "pointer",
};
const receiptBox: React.CSSProperties = {
  marginTop: 18, padding: "12px 14px", borderRadius: 10, border: "1px solid #233", background: "#0b1020",
};
