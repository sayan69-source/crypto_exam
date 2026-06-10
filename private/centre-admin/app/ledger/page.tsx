"use client";
/**
 * Blind courier (§10.3, §11.3) — the held answer bundles for THIS centre,
 * rendered as hashes only.
 *
 * The Edge endpoint returns {leafIndex, leafHash, chainRoot, nodeRootSig,
 * syncState} and nothing else — no ciphertext, no wrapped key, no key material
 * (INV-6 is asserted by an integration test on the API itself). The Centre
 * Admin can verify the chain is intact and count bundles; it can never open one.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SealedBadge } from "@zuup/exam-ui";
import { fetchLedger, getToken, type LedgerBundle } from "../../lib/edge";

const POLL_MS = 5_000;

const shortHex = (h: string) => (h.length <= 18 ? h : `${h.slice(0, 10)}…${h.slice(-8)}`);

export default function Ledger() {
  const router = useRouter();
  const [bundles, setBundles] = useState<LedgerBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBundles((await fetchLedger()).bundles);
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return router.push("/login");
      setError((e as Error).message);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) return void router.push("/login");
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, router]);

  return (
    <main style={{ padding: "32px 28px", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "0.04em" }}>BLIND COURIER</h1>
        <p style={{ color: "#8b97a7", marginTop: 6, fontSize: 13 }}>
          Held answer bundles — hashes only. Sealed to the System Admin key before
          they reached this store; there is no decryption key at this centre (INV-6).
        </p>
        {error && <p role="alert" style={{ color: "#f85149", fontSize: 13 }}>{error}</p>}
      </header>

      {!bundles ? (
        <p style={{ color: "#8b97a7" }}>Loading ledger…</p>
      ) : bundles.length === 0 ? (
        <p style={{ color: "#8b97a7" }}>No bundles held yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["#", "leaf", "chain root", "node signature", "status"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.leafIndex}>
                  <td style={td}>{b.leafIndex}</td>
                  <td style={tdMono} title={b.leafHash}>{shortHex(b.leafHash)}</td>
                  <td style={tdMono} title={b.chainRoot}>{shortHex(b.chainRoot)}</td>
                  <td style={tdMono} title={b.nodeRootSig}>{shortHex(b.nodeRootSig)}</td>
                  <td style={td}>
                    <SealedBadge state={b.syncState === "SYNCED" ? "SYNCED" : "SEALED"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: "#6b7888" }}>
        Each row is one submission&apos;s commitment in the centre hash-chain
        (root<sub>n</sub> = SHA-256(root<sub>n−1</sub> ‖ leaf<sub>n</sub>), §11.3).
        Tampering with any stored bundle breaks every later root and fails the
        on-chain anchor (INV-9).
      </p>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "8px 10px", color: "#8b97a7",
  borderBottom: "1px solid var(--zuup-line)", fontWeight: 600, fontSize: 12,
};
const td: React.CSSProperties = {
  padding: "10px 10px", borderBottom: "1px solid var(--zuup-line)",
};
const tdMono: React.CSSProperties = {
  ...td, fontFamily: "ui-monospace, monospace", color: "#9ecbff",
};
