"use client";
/**
 * System Admin login (§13.5 entry, tier-0) — the SAME match-all rule as every
 * privileged role (§8.2): face + fingerprint + bound HQ IP + TPM, inside one
 * time-box, no subset ever enough (INV-4). The identity is centre-less and
 * bound to an HQ workstation on the HQ WireGuard link; it was provisioned at
 * commissioning and never self-registered — no tier admits itself.
 *
 * This page states nothing. It reads the workstation's commissioned identity,
 * runs the challenge → capture → verdict protocol in lib/station.ts, and
 * renders what the Edge said. What it replaces: a typed-in workstation id, four
 * literal factors posted as the operator's biometrics, a "simulate spoofed IP"
 * button, and no login challenge — which, since the gate began timing logins
 * itself, meant the root of trust could not log in at all.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "../../lib/edge";
import { stationId, stationLogin } from "../../lib/station";

export default function SystemLogin() {
  const router = useRouter();
  const [station, setStation] = useState<string | null>(null);
  const [identityRead, setIdentityRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const r = await stationLogin("/system/login", station);
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
        <h1 style={{ marginTop: 0, fontSize: 20, letterSpacing: "0.05em" }}>SYSTEM ADMIN · LOGIN</h1>
        <p style={{ color: "#8b97a7", fontSize: 13 }}>
          Tier-0 root of trust (§3.1). Face + fingerprint + bound HQ IP + TPM
          (§8.2). This identity was provisioned at commissioning, never
          self-registered.
        </p>

        {!station ? (
          <p style={{ color: identityRead ? "#f85149" : "#8b97a7", fontSize: 13, marginTop: 18 }}>
            {identityRead
              ? "This machine has no commissioned identity (/etc/zuup/terminal-id). An HQ workstation must be registered before it can take a tier-0 login."
              : "Reading this workstation's identity…"}
          </p>
        ) : (
          <>
            <p style={{ color: "#8b97a7", fontSize: 12, marginTop: 16, fontFamily: "ui-monospace, monospace" }}>
              workstation {station.slice(0, 8)}… · the Edge observes this
              machine&apos;s address and attestation itself
            </p>
            {error && <p role="alert" style={{ color: "#f85149", fontSize: 13, marginTop: 14 }}>{error}</p>}
            <button disabled={busy} onClick={login} style={primary(busy)}>
              {busy ? "Look at the camera and hold your finger on the reader…" : "Capture biometrics & login"}
            </button>
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
