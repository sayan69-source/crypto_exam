"use client";
/**
 * Centre Admin login (§10.3 entry). The same multi-factor match-all rule as the
 * invigilator (§8.2): face + fingerprint + bound IP + TPM. On a real kiosk the
 * on-device biometric daemon + TPM produce the probe; here a "Capture" button
 * stands in for that capture step (the demo station id + bound IP are
 * pre-filled). The page never holds credentials — it forwards the probe and
 * renders the Edge's allow/deny verdict.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminLogin, setToken } from "../../lib/edge";

// Demo station provisioned by seed-demo.ts.
const DEMO_STATION = "22222222-2222-2222-2222-222222222222";
const DEMO_IP = "10.0.0.5";

export default function AdminLogin() {
  const router = useRouter();
  const [stationId, setStationId] = useState(DEMO_STATION);
  const [observedIp, setObservedIp] = useState(DEMO_IP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture(simulateSpoof: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await adminLogin({
        terminalId: stationId,
        observedIp: simulateSpoof ? "10.0.0.99" : observedIp, // spoof demo
        faceScore: 0.95, fpScore: 0.9, tpmValid: true, elapsedMs: 1200,
      });
      if (r.ok && r.token) {
        setToken(r.token);
        router.push("/");
      } else {
        setError(`Denied · ${(r.failures ?? ["UNKNOWN"]).join(", ")}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "calc(100vh - 49px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <section style={{ width: "min(460px, 92vw)", border: "1px solid var(--zuup-line)", borderRadius: 14, padding: 28, background: "var(--zuup-panel)" }}>
        <h1 style={{ marginTop: 0, fontSize: 20, letterSpacing: "0.05em" }}>CENTRE ADMIN · LOGIN</h1>
        <p style={{ color: "#8b97a7", fontSize: 13 }}>
          Face + fingerprint + bound IP + TPM (§8.2). Activated by the System Admin (§9.3).
        </p>

        <label style={{ display: "block", fontSize: 12, color: "#8b97a7", marginTop: 12 }}>Admin station id</label>
        <input value={stationId} onChange={(e) => setStationId(e.target.value)} style={field} />
        <label style={{ display: "block", fontSize: 12, color: "#8b97a7", marginTop: 12 }}>Bound LAN IP (Edge-observed)</label>
        <input value={observedIp} onChange={(e) => setObservedIp(e.target.value)} style={field} />

        {error && <p role="alert" style={{ color: "#f85149", fontSize: 13, marginTop: 14 }}>{error}</p>}

        <button disabled={busy} onClick={() => capture(false)} style={primary(busy)}>
          {busy ? "Verifying…" : "Capture biometrics & login"}
        </button>
        <button disabled={busy} onClick={() => capture(true)} style={ghost}>
          Simulate spoofed IP (should be denied · INV-4)
        </button>
      </section>
    </main>
  );
}

const field: React.CSSProperties = {
  width: "100%", padding: "10px 12px", marginTop: 4, borderRadius: 8,
  border: "1px solid var(--zuup-line)", background: "#0b0f14", color: "var(--zuup-fg)", fontFamily: "ui-monospace, monospace",
};
const primary = (busy: boolean): React.CSSProperties => ({
  width: "100%", marginTop: 18, padding: "14px", borderRadius: 10, border: "none",
  background: busy ? "#1b2230" : "var(--zuup-accent)", color: "#fff", fontWeight: 600, cursor: busy ? "wait" : "pointer",
});
const ghost: React.CSSProperties = {
  width: "100%", marginTop: 10, padding: "10px", borderRadius: 10,
  border: "1px solid var(--zuup-line)", background: "transparent", color: "#8b97a7", cursor: "pointer", fontSize: 13,
};
