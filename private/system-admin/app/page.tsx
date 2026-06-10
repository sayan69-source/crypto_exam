"use client";
/**
 * Nationwide oversight (§13.5, §10.4) — one row per centre: Centre Admins,
 * invigilators, candidates, and sealed-bundle movement. Counts ONLY — this
 * portal can see THAT a centre holds N sealed answers, never their content
 * (decryption is the vault's HSM boundary, INV-6).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatCard } from "@zuup/exam-ui";
import { fetchOverview, getToken, type CentreOverviewRow } from "../lib/edge";

const POLL_MS = 5_000;

export default function Nationwide() {
  const router = useRouter();
  const [rows, setRows] = useState<CentreOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows((await fetchOverview()).centres);
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return void router.push("/login");
      setError((e as Error).message);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, router]);

  const total = (f: (r: CentreOverviewRow) => number) => (rows ?? []).reduce((s, r) => s + f(r), 0);

  return (
    <main style={{ padding: "32px 28px", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "0.04em" }}>NATIONWIDE OVERSIGHT</h1>
        <p style={{ color: "#8b97a7", marginTop: 6, fontSize: 13 }}>
          Tier-0 estate view (§13.5). Counts and hashes only — no roll numbers,
          no answers, no biometrics ever reach this screen.
        </p>
        {error && <p role="alert" style={{ color: "#f85149", fontSize: 13 }}>{error}</p>}
      </header>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 26 }}>
        <StatCard label="Centres" value={rows?.length ?? "…"} />
        <StatCard label="Centre Admins (active)" value={rows ? total((r) => r.centerAdminsActive) : "…"} accent="ok" />
        <StatCard label="CA approvals pending" value={rows ? total((r) => r.centerAdminPending) : "…"} accent={rows && total((r) => r.centerAdminPending) > 0 ? "warn" : "default"} hint="issue codes under Approvals" />
        <StatCard label="Invigilators (active)" value={rows ? total((r) => r.invigilatorsActive) : "…"} accent="ok" />
        <StatCard label="Candidates registered" value={rows ? total((r) => r.candidatesRegistered) : "…"} />
        <StatCard label="Sealed bundles held" value={rows ? total((r) => r.bundlesHeld) : "…"} accent="sealed" hint="ciphertext at centres (INV-6)" />
        <StatCard label="Bundles synced to HQ" value={rows ? total((r) => r.bundlesSynced) : "…"} accent="sealed" />
      </div>

      {!rows ? (
        <p style={{ color: "#8b97a7" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--zuup-line)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--zuup-panel)", textAlign: "left" }}>
                {["Centre", "State", "Centre Admin", "Invigilators", "Candidates", "Bundles held", "Synced"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.centerId} style={{ borderTop: "1px solid var(--zuup-line)" }}>
                  <td style={td}>
                    <strong>{r.centreName}</strong>
                    <div style={{ fontSize: 11, color: "#6b7888", fontFamily: "ui-monospace, monospace" }}>{r.centerId.slice(0, 8)}…</div>
                  </td>
                  <td style={td}>{r.state ?? "—"}</td>
                  <td style={td}>
                    {r.centerAdminsActive > 0 ? (
                      <span style={{ color: "#3fb950" }}>✓ active</span>
                    ) : r.centerAdminPending > 0 ? (
                      <span style={{ color: "#d29922" }}>{r.centerAdminPending} pending approval</span>
                    ) : (
                      <span style={{ color: "#f85149" }}>none</span>
                    )}
                  </td>
                  <td style={td}>
                    {r.invigilatorsActive}
                    {r.invigilatorsPending > 0 && <span style={{ color: "#d29922" }}> (+{r.invigilatorsPending} pending)</span>}
                  </td>
                  <td style={td}>{r.candidatesRegistered}</td>
                  <td style={td}>{r.bundlesHeld}</td>
                  <td style={td}>{r.bundlesSynced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: "#6b7888" }}>
        One centre · one Centre Admin (INV-7, enforced by a partial unique
        index). A centre with no active Centre Admin cannot approve invigilators
        — the cascade is the only path in (§3.1).
      </p>
    </main>
  );
}

const th: React.CSSProperties = { padding: "12px 14px", fontSize: 12, letterSpacing: "0.05em", color: "#8b97a7" };
const td: React.CSSProperties = { padding: "12px 14px", verticalAlign: "top" };
