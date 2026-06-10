"use client";
/**
 * Centre Admin approvals (§9.2 steps 4–6, §9.4) — pending invigilator
 * registrations for THIS centre.
 *
 * For each pending request the admin can:
 *   1. "Issue one-time code" — the Edge generates a single-use, time-boxed
 *      code; its cleartext appears ONLY in this authenticated view (CodeBadge)
 *      and is handed to the applicant in person. It never travels by network.
 *   2. "Authorise & bind fingerprint" — marks the applicant's captured
 *      fingerprint as approver-verified.
 * Activation itself happens on the applicant's station (code + re-supplied
 * fingerprint, §9.2 step 7) — the approver can never self-activate an identity.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeBadge } from "@zuup/exam-ui";
import {
  authoriseFp,
  fetchPending,
  getToken,
  issueCode,
  type PendingApproval,
} from "../../lib/edge";

interface IssuedCode {
  code: string;
  ttl: number; // epoch ms when it expires
}

export default function Approvals() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [issued, setIssued] = useState<Record<string, IssuedCode>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const guard = useCallback(
    (e: unknown) => {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        router.push("/login");
        return true;
      }
      setError((e as Error).message);
      return false;
    },
    [router],
  );

  const refresh = useCallback(async () => {
    try {
      setPending((await fetchPending()).pending);
      setError(null);
    } catch (e) {
      guard(e);
    }
  }, [guard]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    void refresh();
  }, [refresh, router]);

  // 1 Hz tick so the code TTL counts down live.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function onIssueCode(id: string) {
    setBusy(id);
    try {
      const r = await issueCode(id);
      setIssued((m) => ({ ...m, [id]: { code: r.code, ttl: r.ttl } }));
    } catch (e) {
      guard(e);
    } finally {
      setBusy(null);
    }
  }

  async function onAuthoriseFp(id: string) {
    setBusy(id);
    try {
      await authoriseFp(id);
      await refresh();
    } catch (e) {
      guard(e);
    } finally {
      setBusy(null);
    }
  }

  const expiresLabel = (c: IssuedCode) => {
    const left = Math.max(0, Math.floor((c.ttl - nowMs) / 1000));
    const mm = Math.floor(left / 60);
    const ss = String(left % 60).padStart(2, "0");
    return left === 0 ? "expired" : `expires in ${mm}:${ss}`;
  };

  return (
    <main style={{ padding: "32px 28px", maxWidth: 880, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "0.04em" }}>PENDING APPROVALS</h1>
        <p style={{ color: "#8b97a7", marginTop: 6, fontSize: 13 }}>
          Invigilator registrations for this centre (§9.2). Codes are one-time,
          time-boxed, shown only here, and handed over in person — never sent (§9.4).
        </p>
        {error && <p role="alert" style={{ color: "#f85149", fontSize: 13 }}>{error}</p>}
      </header>

      {!pending ? (
        <p style={{ color: "#8b97a7" }}>Loading…</p>
      ) : pending.length === 0 ? (
        <p style={{ color: "#8b97a7" }}>No pending requests. ✓</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
          {pending.map((p) => (
            <li
              key={p.requestId}
              style={{
                border: "1px solid var(--zuup-line)", borderRadius: 12, padding: 18,
                background: "var(--zuup-panel)", display: "grid", gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 16 }}>{p.applicantName}</strong>
                <span style={{ fontSize: 12, color: "#8b97a7" }}>{p.kind}</span>
                <span style={{ fontSize: 12, color: p.fingerprintAuthorised ? "#3fb950" : "#d29922" }}>
                  {p.fingerprintAuthorised ? "✓ fingerprint authorised" : "fingerprint not yet authorised"}
                </span>
              </div>

              {issued[p.requestId] && (
                <CodeBadge
                  code={issued[p.requestId]!.code}
                  expiresLabel={expiresLabel(issued[p.requestId]!)}
                />
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  disabled={busy === p.requestId}
                  onClick={() => onIssueCode(p.requestId)}
                  style={btnPrimary}
                >
                  {issued[p.requestId] ? "Re-issue one-time code" : "Issue one-time code"}
                </button>
                <button
                  disabled={busy === p.requestId || p.fingerprintAuthorised}
                  onClick={() => onAuthoriseFp(p.requestId)}
                  style={btnGhost}
                >
                  Authorise &amp; bind fingerprint
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: "#6b7888" }}>
        Final activation happens on the applicant&apos;s own station with the code +
        a re-supplied fingerprint (§9.2 step 7). It cannot be done from here.
      </p>
    </main>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 10, border: "none",
  background: "var(--zuup-accent)", color: "#fff", fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 10,
  border: "1px solid var(--zuup-line)", background: "transparent", color: "var(--zuup-fg)", cursor: "pointer",
};
