"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  biometricHealth,
  capability as fetchCapability,
  health,
  readiness as fetchReadiness,
  terminalIdentity,
  type BiometricHealth,
  type TerminalCapability,
  type TerminalReadiness,
} from "@/lib/edge";
import { watchAssignment } from "@/lib/assignment";

/**
 * The Login Gate (§7.6, L6) — the first and only screen at boot.
 *
 * Deny-by-default chooser: it offers the two role buttons and nothing else.
 * Which button is *live* is driven by this terminal's provisioned capability
 * as the Edge reports it — an invigilator station can never open the
 * candidate path and vice versa.
 *
 * Fail-closed (INV-10): while `GET /api/health` fails, the Gate shows a
 * locked "Centre offline" wall with no actionable control. There is no
 * cached or degraded mode.
 */

type GateHealth = "PROBING" | "ONLINE" | "OFFLINE";
const HEALTH_POLL_MS = 3_000;

// The Centre Admin portal (private/centre-admin) is served BY the Centre Edge
// on the centre LAN at /admin/ in production (same origin → no CORS, no public
// exposure). In dev it runs on its own port; set NEXT_PUBLIC_CENTRE_ADMIN_URL.
const ADMIN_PORTAL_URL = process.env.NEXT_PUBLIC_CENTRE_ADMIN_URL ?? "/admin/";

export default function LoginGate() {
  const router = useRouter();
  const [edge, setEdge] = useState<GateHealth>("PROBING");
  const [terminalId, setTid] = useState<string | null>(null);
  const [identityRead, setIdentityRead] = useState(false);
  const [cap, setCap] = useState<TerminalCapability | null>(null);
  const [seatState, setSeatState] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TerminalReadiness | null>(null);
  const [bio, setBio] = useState<BiometricHealth | null>(null);
  const redirected = useRef(false);

  // Terminal identity comes from the signed image and nowhere else (§7.1).
  //
  // `?role=` is read here, but it names a ROLE and is resolved against the
  // machine's own commissioning list — so it can only ever select an identity
  // this hardware already holds. On a production terminal there is exactly one,
  // and the parameter is inert.
  useEffect(() => {
    const role = new URLSearchParams(window.location.search).get("role");
    void terminalIdentity(role).then((id) => {
      setTid(id);
      setIdentityRead(true);
    });
  }, []);

  // Fail-closed liveness probe (INV-10).
  useEffect(() => {
    let stop = false;
    async function probe() {
      const ok = await health();
      if (!stop) setEdge(ok ? "ONLINE" : "OFFLINE");
    }
    void probe();
    const t = setInterval(probe, HEALTH_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // Capability — which role button may render (§7.6).
  useEffect(() => {
    if (!terminalId || edge !== "ONLINE") return;
    let stale = false;
    void fetchCapability(terminalId).then((c) => {
      if (!stale) setCap(c);
    });
    // …and WHY a login will succeed or fail on this machine. Gathered once and
    // shown below the buttons, because on hardware there may be exactly one
    // boot in which to discover that a laptop has no TPM or no reader.
    void Promise.all([fetchReadiness(terminalId), biometricHealth()]).then(([r, b]) => {
      if (stale) return;
      setReadiness(r);
      setBio(b);
    });
    return () => {
      stale = true;
    };
  }, [terminalId, edge]);

  // Candidate seats poll for their assignment; ASSIGNED → auto-redirect (§9.6).
  useEffect(() => {
    if (!terminalId || cap !== "CANDIDATE_SEAT" || edge !== "ONLINE") return;
    const watch = watchAssignment(terminalId, (s) => {
      setSeatState(s.state);
      if (s.state === "ASSIGNED" && !redirected.current) {
        redirected.current = true;
        router.push("/candidate");
      }
    });
    return () => watch.stop();
  }, [terminalId, cap, edge, router]);

  // ── fail-closed wall (INV-10) ───────────────────────────────────────────
  if (edge !== "ONLINE") {
    return (
      <div className="screen" style={{ background: "#0b0f14" }}>
        <div className="screen-panel" style={{ background: "transparent", border: "none", color: "#e6edf3" }}>
          <span className="screen-state" style={{ color: "#f85149" }}>
            {edge === "PROBING" ? "CONTACTING CENTRE EDGE…" : "CENTRE OFFLINE · TERMINAL LOCKED"}
          </span>
          <h1 style={{ color: "#e6edf3" }}>
            {edge === "PROBING" ? "Verifying centre link…" : "This terminal is locked."}
          </h1>
          <p style={{ color: "#8b97a7" }}>
            {edge === "PROBING"
              ? "Establishing the secure LAN tunnel to the Centre Edge."
              : "The Centre Edge is unreachable. No login is possible until the centre link is restored. Contact your invigilator."}
          </p>
        </div>
      </div>
    );
  }

  // ── uncommissioned machine (INV-10) ─────────────────────────────────────
  //
  // There is no way to supply an identity from this screen. A terminal is
  // commissioned by writing /etc/zuup/terminal-id into its signed image and
  // registering that id — with its WireGuard key, golden PCRs and biometric
  // attestation key — in the Edge terminal registry. A machine that can be told
  // what seat it is, is a machine that can be told to be the seat it wants.
  if (!terminalId) {
    return (
      <div className="screen" style={{ background: "#0b0f14" }}>
        <div className="screen-panel" style={{ background: "transparent", border: "none", color: "#e6edf3" }}>
          <span className="screen-state" style={{ color: "#f85149" }}>
            {identityRead ? "UNCOMMISSIONED TERMINAL · LOCKED" : "READING TERMINAL IDENTITY…"}
          </span>
          <h1 style={{ color: "#e6edf3" }}>
            {identityRead ? "This machine has no identity." : "Identifying this terminal…"}
          </h1>
          <p style={{ color: "#8b97a7" }}>
            {identityRead
              ? "No commissioned identity was found in the signed image (/etc/zuup/terminal-id). This machine cannot attest, cannot log in, and cannot serve a paper. Return it to the System Admin for commissioning."
              : "Reading the identity written into this image at commissioning."}
          </p>
        </div>
      </div>
    );
  }

  const isInvigilatorStation = cap === "INVIGILATOR_STATION";
  const isCandidateSeat = cap === "CANDIDATE_SEAT";
  const isAdminStation = cap === "ADMIN_STATION";

  return (
    <div className="screen">
      <div className="screen-panel">
        <span className="screen-state">
          ZUUP-OS · LOGIN GATE · {cap ?? "VERIFYING TERMINAL…"}
        </span>
        <h1>Examination Terminal</h1>
        <p>
          This machine permits exactly two roles. Every other action is denied
          by construction (§1.1). All traffic stays on the centre LAN.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 28 }}>
          <button
            disabled={!isInvigilatorStation}
            onClick={() => router.push("/invigilator")}
            style={chooserBtn(isInvigilatorStation)}
          >
            Centre Invigilator login
            {!isInvigilatorStation && <small style={smallNote}>not an invigilator station</small>}
          </button>

          <button
            disabled={!(isCandidateSeat && seatState === "ASSIGNED")}
            onClick={() => router.push("/candidate")}
            style={chooserBtn(isCandidateSeat && seatState === "ASSIGNED")}
          >
            Candidate
            {isCandidateSeat && seatState !== "ASSIGNED" && (
              <small style={smallNote}>
                {seatState === null ? "checking seat…" : `seat ${seatState} — awaiting assignment by the invigilator`}
              </small>
            )}
            {!isCandidateSeat && <small style={smallNote}>not a candidate seat</small>}
          </button>

          {/* Centre Admin is a LAN-only role (NOT the public website — that is
              the System Admin's HQ tier). On a real ADMIN_STATION the kiosk
              launcher opens the Centre Admin portal directly; this button is
              the same entry on the unified dev surface. */}
          <button
            disabled={!isAdminStation}
            onClick={() => { window.location.href = ADMIN_PORTAL_URL; }}
            style={chooserBtn(isAdminStation)}
          >
            Centre Admin login
            {!isAdminStation && <small style={smallNote}>not an admin station</small>}
            {isAdminStation && <small style={smallNote}>centre LAN · match-all (face + fingerprint + IP + TPM)</small>}
          </button>
        </div>

        <ReadinessPanel readiness={readiness} bio={bio} />

        <p style={{ marginTop: 20, fontSize: 12, color: "#94a3b8" }}>
          terminal <code>{terminalId.slice(0, 8)}…</code> · edge link OK ·
          fail-closed gate (INV-10)
        </p>
      </div>
    </div>
  );
}

/**
 * What this machine can and cannot do, before anyone presses anything.
 *
 * Every line is a fact the Edge or the daemon reported about THIS terminal. The
 * point is diagnosis in one boot: a station that will deny every login should
 * say why here, not after an operator has scanned their face four times.
 */
function ReadinessPanel({
  readiness,
  bio,
}: {
  readiness: TerminalReadiness | null;
  bio: BiometricHealth | null;
}) {
  if (!readiness) return null;

  const checks: Array<{ ok: boolean; label: string; missing: string }> = [
    {
      ok: readiness.registeredAttestationKey && readiness.registeredGoldenPcr,
      label: "TPM attestation key + golden measurements registered",
      missing: "no TPM attestation registered — the TPM factor cannot pass",
    },
    {
      ok: readiness.attestationCurrent,
      label: "this boot has attested",
      missing: "this boot has NOT attested — every privileged login will deny",
    },
    {
      ok: readiness.registeredBiometricKey,
      label: "biometric daemon key registered",
      missing: "no biometric key registered — captures cannot be verified",
    },
    {
      ok: Boolean(bio?.signing),
      label: "capture daemon is signing",
      missing: bio
        ? "the capture daemon has no attestation key"
        : "no capture daemon answered on this machine",
    },
    { ok: Boolean(bio?.face), label: "camera present", missing: "no camera — the face factor scores 0" },
    { ok: Boolean(bio?.fp), label: "fingerprint reader present", missing: "no reader — the fingerprint factor scores 0" },
    {
      ok: readiness.enrolledIdentity,
      label: "an identity is enrolled at this station",
      missing: "nobody is enrolled here yet — register first",
    },
  ];

  const blocking = checks.filter((c) => !c.ok);
  if (blocking.length === 0) {
    return (
      <p style={{ marginTop: 22, fontSize: 12, color: "#15803d", textAlign: "left" }}>
        All four §8.2 factors are available on this station.
      </p>
    );
  }

  return (
    <div
      style={{
        marginTop: 22, padding: "12px 14px", borderRadius: 10, textAlign: "left",
        background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", fontSize: 12,
      }}
    >
      <strong>This station cannot complete a login yet.</strong>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
        {blocking.map((c) => (
          <li key={c.label}>{c.missing}</li>
        ))}
      </ul>
      {readiness.commissionedVia === "FIRST_BOOT" && (
        <p style={{ margin: "10px 0 0", opacity: 0.9 }}>
          Commissioned by this machine itself at first boot, so its golden
          measurements are its own — attestation here proves the software has
          not changed since, not that an authority approved it.
        </p>
      )}
    </div>
  );
}

const chooserBtn = (enabled: boolean): React.CSSProperties => ({
  display: "grid",
  gap: 4,
  width: "100%",
  padding: "16px 18px",
  borderRadius: 12,
  border: enabled ? "1px solid #1e40af" : "1px solid #e2e8f0",
  background: enabled ? "#1e40af" : "#f1f5f9",
  color: enabled ? "#fff" : "#94a3b8",
  fontSize: 17,
  fontWeight: 600,
  cursor: enabled ? "pointer" : "not-allowed",
});

const smallNote: React.CSSProperties = { fontSize: 12, fontWeight: 400, opacity: 0.85 };
