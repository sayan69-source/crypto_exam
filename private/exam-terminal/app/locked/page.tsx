/**
 * /locked — the fail-closed wall the kiosk launcher loads by contract
 * (zuup-kiosk-launch.sh) whenever a terminal has no identity, an unknown
 * capability, or the Edge is unreachable. It offers no actionable control: a
 * locked terminal can only be released by a correctly provisioned boot (§7.6,
 * INV-10). Static + server-rendered so it shows even if nothing else loads.
 */
export const dynamic = "force-static";

export default function Locked() {
  return (
    <div className="screen" style={{ background: "#0b0f14" }}>
      <div className="screen-panel" style={{ background: "transparent", border: "none", color: "#e6edf3" }}>
        <span className="screen-state" style={{ color: "#f85149" }}>
          TERMINAL LOCKED
        </span>
        <h1 style={{ color: "#e6edf3" }}>This terminal is locked.</h1>
        <p style={{ color: "#8b97a7" }}>
          No examination role is permitted on this machine. This happens when the
          terminal is unprovisioned, its capability is unknown to the Centre
          Edge, or the centre link is down. There is no degraded or cached mode.
          Contact your invigilator.
        </p>
      </div>
    </div>
  );
}
