"use client";
/**
 * HQ Answer Vault (§11.4, §13.5) — where sealed answers become readable, and
 * nowhere else. The operator pastes a centre's sync bundle (the ciphertext-only
 * export the Centre Admin produced as a blind courier, §13.4) and this page
 * POSTs it to /hq/ingest — a route served by THIS portal's own process, the
 * HSM stand-in. The page renders the verification trail (node signature →
 * chain re-walk → envelope binding → decrypt → NO-PII anchors) so the operator
 * sees every check that ran before any plaintext appeared.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SealedBadge } from "@zuup/exam-ui";
import { getToken } from "../../lib/edge";

interface IngestStep { name: string; ok: boolean; detail: string }
interface DecryptedAnswer { examId: string; seatNo: string | null; leafIndex: number; record: unknown }
interface AnchorPayload { centreIdHash: string; examId: string; answerRoot: string; count: number; nodePubkey: string }
interface IngestResponse {
  ok: boolean;
  reason?: string;
  hint?: string;
  refusedBy?: string;
  centreIdHash?: string;
  steps?: IngestStep[];
  decrypted?: DecryptedAnswer[];
  anchors?: AnchorPayload[];
}

export default function Vault() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.push("/login");
  }, [router]);

  async function ingest() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        setError("Not valid JSON — paste the bundle exactly as exported by the Centre Admin portal.");
        return;
      }
      // The export endpoint wraps it as { ok, exported, bundle } — accept both.
      const bundle = (body as { bundle?: unknown }).bundle ?? body;
      const res = await fetch("/hq/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      });
      const json = (await res.json()) as IngestResponse;
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: "32px 28px", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "0.04em" }}>HQ ANSWER VAULT</h1>
        <p style={{ color: "#8b97a7", marginTop: 6, fontSize: 13 }}>
          The decrypt boundary (INV-6): centres hold ciphertext they cannot
          open; this vault holds the only key. Verify-then-decrypt, fail-closed
          — a bundle that cannot prove its integrity decrypts nothing.
        </p>
      </header>

      <section style={{ display: "grid", gap: 10 }}>
        <label style={{ fontSize: 12, color: "#8b97a7" }}>
          Centre sync bundle (paste the JSON from the Centre Admin portal&apos;s &quot;Export to HQ&quot;)
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='{"manifest":{"centreId":"…","records":[…]},"manifestHash":"…","nodeSig":"…","nodePubkey":"…"}'
          style={{
            width: "100%", padding: 12, borderRadius: 10, border: "1px solid var(--zuup-line)",
            background: "#0b0f14", color: "var(--zuup-fg)", fontFamily: "ui-monospace, monospace", fontSize: 12,
          }}
        />
        <div>
          <button disabled={busy || raw.trim() === ""} onClick={ingest} style={btnPrimary(busy || raw.trim() === "")}>
            {busy ? "Verifying & decrypting…" : "Verify & decrypt at HQ"}
          </button>
        </div>
        {error && <p role="alert" style={{ color: "#f85149", fontSize: 13 }}>{error}</p>}
      </section>

      {result && (
        <section style={{ marginTop: 26, display: "grid", gap: 18 }}>
          {/* refusal banner (key not provisioned / bad bundle / failed check) */}
          {!result.ok && (
            <div style={{ border: "1px solid #f85149", borderRadius: 12, padding: 16, background: "rgba(248,81,73,0.06)" }}>
              <strong style={{ color: "#f85149" }}>
                INGEST REFUSED{result.refusedBy ? ` — ${result.refusedBy}` : result.reason ? ` — ${result.reason}` : ""}
              </strong>
              {result.hint && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8b97a7" }}>{result.hint}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8b97a7" }}>
                Nothing was decrypted. Raise the failing check with the centre — the bundle may have been tampered in transit or at rest.
              </p>
            </div>
          )}

          {/* the verification trail */}
          {result.steps && result.steps.length > 0 && (
            <div>
              <h2 style={h2}>Verification trail</h2>
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {result.steps.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13 }}>
                    <span style={{ color: s.ok ? "#3fb950" : "#f85149", fontWeight: 700, width: 18 }}>{s.ok ? "✓" : "✗"}</span>
                    <code style={{ color: s.ok ? "#e6edf3" : "#f85149", width: 150 }}>{s.name}</code>
                    <span style={{ color: "#8b97a7" }}>{s.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* decrypted records — the System Admin database receives these */}
          {result.ok && result.decrypted && (
            <div>
              <h2 style={h2}>
                Decrypted submissions <span style={{ color: "#8b97a7", fontWeight: 400 }}>({result.decrypted.length})</span>
              </h2>
              <p style={{ fontSize: 12, color: "#6b7888", marginTop: 4 }}>
                Each record R carries the candidate&apos;s responses with their
                questions (§11.2) — this table is the System Admin database
                ingest view, the first and only place R exists in cleartext.
              </p>
              <div style={{ overflowX: "auto", border: "1px solid var(--zuup-line)", borderRadius: 12, marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--zuup-panel)", textAlign: "left" }}>
                      {["#", "Exam", "Seat", "Record R (plaintext)"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.decrypted.map((d) => (
                      <tr key={`${d.examId}-${d.leafIndex}`} style={{ borderTop: "1px solid var(--zuup-line)" }}>
                        <td style={td}>{d.leafIndex}</td>
                        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{d.examId.slice(0, 8)}…</td>
                        <td style={td}>{d.seatNo ?? "—"}</td>
                        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 11, maxWidth: 560, overflowWrap: "anywhere" }}>
                          {JSON.stringify(d.record)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* anchors for the public chain */}
          {result.ok && result.anchors && result.anchors.length > 0 && (
            <div>
              <h2 style={h2}>Public-chain anchors (no PII)</h2>
              <p style={{ fontSize: 12, color: "#6b7888", marginTop: 4 }}>
                What goes on Polygon (§11.5): centre-id hash, final answer root,
                count, node key. The PII guard ran before these were emitted.
              </p>
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, marginTop: 10 }}>
                {result.anchors.map((a, i) => (
                  <li key={i} style={{ border: "1px solid var(--zuup-line)", borderRadius: 12, padding: 14, display: "grid", gap: 6 }}>
                    <SealedBadge state="ANCHORED" />
                    <code style={{ fontSize: 11, color: "#8b97a7", overflowWrap: "anywhere" }}>
                      centre {a.centreIdHash.slice(0, 16)}… · exam {a.examId.slice(0, 8)}… · root {a.answerRoot.slice(0, 16)}… · {a.count} submission(s)
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const h2: React.CSSProperties = { fontSize: 15, letterSpacing: "0.04em", margin: 0 };
const th: React.CSSProperties = { padding: "10px 12px", fontSize: 12, letterSpacing: "0.05em", color: "#8b97a7" };
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
const btnPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: "12px 18px", borderRadius: 10, border: "none",
  background: disabled ? "#1b2230" : "var(--zuup-accent)", color: "#fff", fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
});
