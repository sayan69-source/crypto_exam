"use client";
/**
 * LockGate — the §4.1 / §7.6 locked login chooser.
 *
 * This is the first and only screen a terminal shows at boot. It renders ONLY
 * the role buttons the terminal is provisioned for, and nothing else: no
 * settings, no network UI, no shell, no file access.
 *
 * Fail-closed (INV-10): when `online` is false (the Edge identity service is
 * unreachable), BOTH buttons are disabled and a locked "Centre offline"
 * message is shown. There is no fallback path — that is the whole point.
 *
 * Presentational only: it raises onInvigilator / onCandidate; the caller does
 * the actual Edge round-trip. It never holds credentials.
 */
import type { CSSProperties } from "react";

export type TerminalCapability =
  | "CANDIDATE_SEAT"
  | "INVIGILATOR_STATION"
  | "ADMIN_STATION";

export interface LockGateProps {
  terminalLabel: string; // e.g. "A-17"
  centreLabel: string; // e.g. "DL-IITD"
  capability: TerminalCapability;
  /** Edge /api/health reachable. When false → fail-closed lock (INV-10). */
  online: boolean;
  onInvigilator?: () => void;
  onCandidate?: () => void;
}

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--zuup-bg, #0b0f14)",
  color: "var(--zuup-fg, #e6edf3)",
  fontFamily: "var(--zuup-font, ui-monospace, monospace)",
};

const panel: CSSProperties = {
  width: "min(560px, 92vw)",
  border: "1px solid var(--zuup-line, #243044)",
  borderRadius: 14,
  padding: "32px 28px",
  background: "var(--zuup-panel, #11161d)",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 24px 64px rgba(0,0,0,0.5)",
};

function button(disabled: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "18px 20px",
    margin: "12px 0",
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "0.04em",
    borderRadius: 10,
    border: "1px solid var(--zuup-line, #243044)",
    background: disabled ? "#161b22" : "var(--zuup-accent, #1f6feb)",
    color: disabled ? "#5a6675" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

export function LockGate({
  terminalLabel,
  centreLabel,
  capability,
  online,
  onInvigilator,
  onCandidate,
}: LockGateProps) {
  const showInvigilator =
    capability === "INVIGILATOR_STATION" || capability === "ADMIN_STATION";
  const showCandidate = capability === "CANDIDATE_SEAT";

  return (
    <main style={wrap}>
      <section style={panel} aria-label="ZUUP-OS locked login gate">
        <header style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.06em" }}>
            ZUUP-OS · CENTRE TERMINAL
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#8b97a7" }}>
            Terminal #{terminalLabel} · Centre {centreLabel} ·{" "}
            <span style={{ color: online ? "#3fb950" : "#f85149" }}>
              {online ? "LOCKED" : "OFFLINE"}
            </span>
          </div>
        </header>

        {online ? (
          <>
            {showInvigilator && (
              <button
                type="button"
                style={button(false)}
                onClick={onInvigilator}
              >
                [ 1 ] CENTRE INVIGILATOR LOGIN
              </button>
            )}
            {showCandidate && (
              <button
                type="button"
                style={button(false)}
                onClick={onCandidate}
              >
                [ 2 ] CANDIDATE (STUDENT) LOGIN
              </button>
            )}
            <p
              style={{
                marginTop: 18,
                textAlign: "center",
                fontSize: 12,
                color: "#6b7888",
              }}
            >
              No other action is available on this device.
            </p>
          </>
        ) : (
          <div role="alert" style={{ textAlign: "center" }}>
            <button type="button" style={button(true)} disabled>
              CENTRE OFFLINE
            </button>
            <p style={{ marginTop: 18, fontSize: 13, color: "#f0a35e" }}>
              Centre identity service unreachable — call supervisor.
              <br />
              No login is possible until the centre is restored.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
