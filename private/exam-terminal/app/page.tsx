"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  capability as fetchCapability,
  getTerminalId,
  health,
  setTerminalId,
  type TerminalCapability,
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

export default function LoginGate() {
  const router = useRouter();
  const [edge, setEdge] = useState<GateHealth>("PROBING");
  const [terminalId, setTid] = useState<string | null>(null);
  const [cap, setCap] = useState<TerminalCapability | null>(null);
  const [seatState, setSeatState] = useState<string | null>(null);
  const [provisionField, setProvisionField] = useState("");
  const redirected = useRef(false);

  // Terminal identity: baked into the signed image on real hardware; in dev it
  // comes from ?terminal= / localStorage (see lib/edge.ts).
  useEffect(() => {
    setTid(getTerminalId());
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

  // ── dev provisioning (real terminals carry their id in the image) ────────
  if (!terminalId) {
    return (
      <div className="screen">
        <div className="screen-panel">
          <span className="screen-state">UNPROVISIONED TERMINAL</span>
          <h1>No terminal identity.</h1>
          <p>
            A production terminal carries its identity inside the signed OS
            image. For development, paste a provisioned terminal id (see{" "}
            <code>seed-demo.ts</code>) or open with <code>?terminal=&lt;uuid&gt;</code>.
          </p>
          <input
            value={provisionField}
            onChange={(e) => setProvisionField(e.target.value)}
            placeholder="terminal uuid"
            style={{
              marginTop: 18, width: "100%", padding: "12px 14px", borderRadius: 8,
              border: "1px solid #cbd5e1", fontFamily: "ui-monospace, monospace", fontSize: 14,
            }}
          />
          <button
            onClick={() => {
              if (provisionField.trim()) {
                setTerminalId(provisionField.trim());
                setTid(provisionField.trim());
              }
            }}
            style={chooserBtn(true)}
          >
            Provision this browser as that terminal
          </button>
        </div>
      </div>
    );
  }

  const isInvigilatorStation = cap === "INVIGILATOR_STATION";
  const isCandidateSeat = cap === "CANDIDATE_SEAT";

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
        </div>

        {cap === "ADMIN_STATION" && (
          <p style={{ marginTop: 22, fontSize: 13, color: "#64748b" }}>
            This is an admin station — the Centre Admin portal is its own
            surface (<code>centre-admin</code>), not part of this terminal.
          </p>
        )}

        <p style={{ marginTop: 26, fontSize: 12, color: "#94a3b8" }}>
          terminal <code>{terminalId.slice(0, 8)}…</code> · edge link OK ·
          fail-closed gate (INV-10)
        </p>
      </div>
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
