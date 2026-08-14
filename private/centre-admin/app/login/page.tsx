"use client";
/**
 * Centre Admin login (§10.3 entry) — the same match-all rule as every other
 * privileged role (§8.2): face + fingerprint + bound IP + TPM, inside one
 * time-box, no subset ever enough (INV-4).
 *
 * This page states nothing. It reads the station's commissioned identity, asks
 * lib/station.ts to run the challenge → capture → verdict protocol, and renders
 * what the Edge said. What it replaces: two hard-coded ids, four literal
 * factors posted as the operator's biometrics, a "simulate spoofed IP" button,
 * and no login challenge — which, since the gate began timing logins itself,
 * meant this screen could never produce a successful login at all.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "../../lib/edge";
import { registerAdmin, stationId, stationLogin } from "../../lib/station";

export default function AdminLogin() {
  const router = useRouter();
  const [station, setStation] = useState<string | null>(null);
  const [identityRead, setIdentityRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function register() {
    if (!station || !fullName.trim()) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    const r = await registerAdmin(station, fullName.trim());
    setBusy(false);
    if ("error" in r) return setError(`Registration failed · ${r.error}`);
    setStatus(
      `PENDING_APPROVAL — request ${r.requestId}. A System Admin must approve it ` +
        `(§9.3), then activate here with the one-time code and your fingerprint.`,
    );
  }

  useEffect(() => {
    void stationId().then((id) => {
      setStation(id);
      setIdentityRead(true);
    });
  }, []);

  async function login() {
    if (!station) return;
    setBusy(true);
    setError(null);
    const r = await stationLogin("/admin/login", station);
    setBusy(false);
    if (r.ok && r.token) {
      setToken(r.token);
      router.push("/");
      return;
    }
    setError(`Denied · ${(r.failures ?? ["UNKNOWN"]).join(", ")}`);
  }

  return (
    <main style={{ minHeight: "calc(100vh - 49px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <section style={{ width: "min(460px, 92vw)", border: "1px solid var(--zuup-line)", borderRadius: 14, padding: 28, background: "var(--zuup-panel)" }}>
        <h1 style={{ marginTop: 0, fontSize: 20, letterSpacing: "0.05em" }}>CENTRE ADMIN · LOGIN</h1>
        <p style={{ color: "#8b97a7", fontSize: 13 }}>
          Face + fingerprint + bound IP + TPM (§8.2). Activated by the System
          Admin (§9.3).
        </p>

        {!station ? (
          <p style={{ color: identityRead ? "#f85149" : "#8b97a7", fontSize: 13, marginTop: 18 }}>
            {identityRead
              ? "This machine has no commissioned identity (/etc/zuup/terminal-id). An admin station must be registered with the Edge before it can take a login."
              : "Reading this station's identity…"}
          </p>
        ) : (
          <>
            <p style={{ color: "#8b97a7", fontSize: 12, marginTop: 16, fontFamily: "ui-monospace, monospace" }}>
              station {station.slice(0, 8)}… · the Edge observes this machine&apos;s
              address and attestation itself
            </p>
            {error && <p role="alert" style={{ color: "#f85149", fontSize: 13, marginTop: 14 }}>{error}</p>}
            {status && <p style={{ color: "#8b97a7", fontSize: 13, marginTop: 14 }}>{status}</p>}

            {mode === "login" ? (
              <>
                <button disabled={busy} onClick={login} style={primary(busy)}>
                  {busy ? "Look at the camera and hold your finger on the reader…" : "Capture biometrics & login"}
                </button>
                <button disabled={busy} onClick={() => { setMode("register"); setError(null); }} style={ghost}>
                  No Centre Admin enrolled here yet? Register (§10.1)
                </button>
              </>
            ) : (
              <>
                <p style={{ color: "#8b97a7", fontSize: 13, marginTop: 14 }}>
                  Enrols your face and fingerprint at THIS station. The centre and
                  the station binding come from the Edge&apos;s own record of this
                  machine — this form cannot choose them. Activation still needs a
                  System Admin&apos;s one-time code (§9.3).
                </p>
                <label style={{ display: "block", fontSize: 12, color: "#8b97a7", marginTop: 12 }}>Full name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 12px", marginTop: 4, borderRadius: 8,
                    border: "1px solid var(--zuup-line)", background: "#0b0f14",
                    color: "var(--zuup-fg)", fontSize: 14,
                  }}
                />
                <button disabled={busy || !fullName.trim()} onClick={register} style={primary(busy)}>
                  {busy ? "Capturing…" : "Capture biometrics & register"}
                </button>
                <button disabled={busy} onClick={() => { setMode("login"); setError(null); }} style={ghost}>
                  ← Back to login
                </button>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

const primary = (busy: boolean): React.CSSProperties => ({
  width: "100%", marginTop: 18, padding: "14px", borderRadius: 10, border: "none",
  background: busy ? "#1b2230" : "var(--zuup-accent)", color: "#fff", fontWeight: 600, cursor: busy ? "wait" : "pointer",
});
const ghost: React.CSSProperties = {
  width: "100%", marginTop: 10, padding: "10px", borderRadius: 10,
  border: "1px solid var(--zuup-line)", background: "transparent", color: "#8b97a7",
  cursor: "pointer", fontSize: 13,
};
