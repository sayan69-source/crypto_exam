"use client";
/**
 * Centre Invigilator Portal (§10.2) — runs on an INVIGILATOR_STATION, LAN-only.
 *
 * Unauthenticated: §9.1 match-all login (face + fingerprint + IP + TPM) and
 * the §9.2 registration path (submit → PENDING → activate with the Centre
 * Admin's one-time code + re-supplied fingerprint).
 *
 * Authenticated console: today's roster, the v2 "Verify & Seat" widget
 * (biometric check-in → random seat assignment → seat number), the live seat
 * map for THIS centre, and incident raising. The invigilator can not approve
 * other invigilators, read answers, or see another centre (§3.2).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignSeat,
  checkin,
  clearToken,
  getTerminalId,
  getToken,
  raiseIncident,
  roster as fetchRoster,
  seatMap as fetchSeatMap,
  EdgeError,
  type RosterRow,
  type SeatMapRow,
} from "@/lib/edge";
import {
  activateWithCode,
  captureProbe,
  invigilatorLogin,
  registerInvigilator,
} from "@/lib/identity";

// Demo defaults provisioned by seed-demo.ts.
const DEMO_CENTRE = "11111111-1111-1111-1111-111111111111";
const DEMO_EXAM = "44444444-4444-4444-4444-444444444444";
const DEMO_STATION = "55555555-5555-5555-5555-555555555555";
const DEMO_IP = "10.0.0.6";

export default function InvigilatorPortal() {
  const [authed, setAuthed] = useState<boolean>(false);
  useEffect(() => {
    setAuthed(Boolean(getToken()));
  }, []);
  return authed ? <Console onLock={() => { clearToken(); setAuthed(false); }} /> : <Login onAuthed={() => setAuthed(true)} />;
}

// ════════════════════════ login + registration ════════════════════════════
function Login({ onAuthed }: { onAuthed: () => void }) {
  const [stationId, setStationId] = useState(getTerminalId() ?? DEMO_STATION);
  const [observedIp, setObservedIp] = useState(DEMO_IP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  async function login(spoof: "ip" | "face" | null) {
    setBusy(true);
    setError(null);
    const verdict = await invigilatorLogin(captureProbe({ terminalId: stationId, observedIp, spoof }));
    setBusy(false);
    if (verdict.ok) return onAuthed();
    setError(`Denied · ${(verdict.failures ?? ["UNKNOWN"]).join(", ")}`);
  }

  return (
    <div className="screen">
      <div className="screen-panel" style={{ maxWidth: 520 }}>
        <span className="screen-state">CENTRE INVIGILATOR · {mode === "login" ? "LOGIN" : "REGISTRATION"}</span>

        {mode === "login" ? (
          <>
            <h1>Invigilator login</h1>
            <p style={{ fontSize: 14 }}>
              Face + fingerprint + bound IP + TPM must ALL match (§8.2). Any
              single miss denies and is logged (INV-4).
            </p>
            <label style={label}>Station id</label>
            <input value={stationId} onChange={(e) => setStationId(e.target.value)} style={field} />
            <label style={label}>Edge-observed LAN IP</label>
            <input value={observedIp} onChange={(e) => setObservedIp(e.target.value)} style={field} />
            {error && <p role="alert" style={{ color: "#dc2626", fontSize: 14, marginTop: 12 }}>{error}</p>}
            <button disabled={busy} onClick={() => login(null)} style={btnPrimary}>
              {busy ? "Verifying…" : "Capture face + fingerprint & login"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={() => login("ip")} style={btnGhost}>
                Spoof IP (deny)
              </button>
              <button disabled={busy} onClick={() => login("face")} style={btnGhost}>
                Wrong face (deny)
              </button>
            </div>
            <button onClick={() => setMode("register")} style={{ ...btnGhost, marginTop: 18 }}>
              New invigilator? Register (§9.2)
            </button>
          </>
        ) : (
          <Registration onBack={() => setMode("login")} stationId={stationId} observedIp={observedIp} />
        )}
      </div>
    </div>
  );
}

function Registration({ onBack, stationId, observedIp }: { onBack: () => void; stationId: string; observedIp: string }) {
  const [fullName, setFullName] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    const r = await registerInvigilator({
      centerId: DEMO_CENTRE,
      fullName,
      boundIp: observedIp,
      boundTerminalId: stationId,
    });
    setBusy(false);
    if ("error" in r) return setStatus(`Registration failed · ${r.error}`);
    setRequestId(r.requestId);
    setStatus("PENDING_APPROVAL — give this request id to your Centre Admin in person.");
  }

  async function activate() {
    if (!requestId) return;
    setBusy(true);
    const r = await activateWithCode({ requestId, code, fingerprintMatch: true });
    setBusy(false);
    setStatus(r.ok ? "ACTIVE ✓ — you can now log in." : `Activation denied · ${r.reason}`);
  }

  return (
    <>
      <h1>Register at this centre</h1>
      <p style={{ fontSize: 14 }}>
        Creates a PENDING identity bound to this station + IP. It activates only
        after the Centre Admin issues a one-time code (§9.4) and you re-supply
        your fingerprint with it (§9.2 step 7).
      </p>
      <label style={label}>Full name</label>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={field} />
      <button disabled={busy || !fullName} onClick={submit} style={btnPrimary}>
        Capture biometrics & submit registration
      </button>

      {requestId && (
        <>
          <p style={{ fontSize: 13, marginTop: 14, fontFamily: "ui-monospace, monospace" }}>
            request <strong>{requestId}</strong>
          </p>
          <label style={label}>One-time code (from the Centre Admin, in person)</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} style={field} placeholder="X-XXX-XXX-…" />
          <button disabled={busy || !code} onClick={activate} style={btnPrimary}>
            Activate with code + fingerprint
          </button>
        </>
      )}

      {status && <p style={{ fontSize: 14, marginTop: 12 }}>{status}</p>}
      <button onClick={onBack} style={{ ...btnGhost, marginTop: 16 }}>← Back to login</button>
    </>
  );
}

// ═══════════════════════════ the console ══════════════════════════════════
function Console({ onLock }: { onLock: () => void }) {
  const [examId] = useState(DEMO_EXAM);
  const [rosterRows, setRosterRows] = useState<RosterRow[] | null>(null);
  const [seats, setSeats] = useState<SeatMapRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyRoll, setBusyRoll] = useState<string | null>(null);

  const guard = useCallback(
    (e: unknown): string => {
      if (e instanceof EdgeError && (e.status === 401 || e.status === 403)) {
        onLock();
        return "session expired";
      }
      return (e as Error).message;
    },
    [onLock],
  );

  const refreshRoster = useCallback(async () => {
    try {
      setRosterRows((await fetchRoster(examId)).roster);
    } catch (e) {
      setNotice(`roster: ${guard(e)}`);
    }
  }, [examId, guard]);

  const refreshSeats = useCallback(async () => {
    try {
      setSeats((await fetchSeatMap()).seats);
    } catch (e) {
      setNotice(`seatmap: ${guard(e)}`);
    }
  }, [guard]);

  useEffect(() => {
    void refreshRoster();
    void refreshSeats();
    const t = setInterval(refreshSeats, 3_000);
    return () => clearInterval(t);
  }, [refreshRoster, refreshSeats]);

  /** The v2 "Verify & Seat" widget (§10.2): check-in then random assignment. */
  async function verifyAndSeat(roll: string, simulateBioFail = false) {
    setBusyRoll(roll);
    setNotice(null);
    try {
      const bio = simulateBioFail ? { faceScore: 0.4, fpScore: 0.2 } : { faceScore: 0.95, fpScore: 0.9 };
      await checkin({ examId, roll, ...bio });
      const seat = await assignSeat({ examId, roll });
      setNotice(`✓ ${roll} verified & seated at ${seat.seatNo}`);
      await Promise.all([refreshRoster(), refreshSeats()]);
    } catch (e) {
      if (e instanceof EdgeError) {
        setNotice(
          e.body.reason === "BIOMETRIC_MISMATCH"
            ? `✗ ${roll}: biometric mismatch — check-in DENIED and logged (§9.5)`
            : `✗ ${roll}: ${e.body.reason ?? guard(e)}`,
        );
      } else setNotice(`✗ ${roll}: ${guard(e)}`);
    } finally {
      setBusyRoll(null);
    }
  }

  async function incident(seatNo: string, type: string) {
    try {
      await raiseIncident({ seatNo, type, severity: "HIGH", note: "raised from console" });
      setNotice(`incident logged for ${seatNo} (${type})`);
    } catch (e) {
      setNotice(`incident: ${guard(e)}`);
    }
  }

  const pending = useMemo(() => (rosterRows ?? []).filter((r) => r.status === "ENROLLED"), [rosterRows]);
  const present = useMemo(() => (rosterRows ?? []).filter((r) => r.status === "PRESENT"), [rosterRows]);

  return (
    <main style={{ height: "100%", overflow: "auto", padding: "26px 30px", background: "#f8fafc" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "0.03em" }}>INVIGILATOR CONSOLE</h1>
        <span style={{ fontSize: 13, color: "#64748b" }}>this centre · this session only (§3.2)</span>
        <button onClick={onLock} style={{ ...btnGhost, marginLeft: "auto", width: "auto" }}>Lock station</button>
      </header>

      {notice && (
        <p role="status" style={{ padding: "10px 14px", borderRadius: 10, background: "#eef2ff", border: "1px solid #c7d2fe", fontSize: 14, marginBottom: 16 }}>
          {notice}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 1fr) minmax(320px, 1fr)", gap: 22 }}>
        {/* ── Verify & Seat ── */}
        <section>
          <h2 style={h2}>Verify &amp; Seat</h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 12px" }}>
            Biometric check-in (§9.5) then random free-seat assignment (§9.6).
            The seat number exists only after both succeed.
          </p>
          {!rosterRows ? (
            <p style={{ fontSize: 14 }}>Loading roster…</p>
          ) : (
            <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["roll", "name", "status", ""].map((h) => (
                      <th key={h} style={thLight}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...pending, ...present].slice(0, 40).map((r) => (
                    <tr key={r.roll}>
                      <td style={tdLight}>{r.roll}</td>
                      <td style={tdLight}>{r.name}</td>
                      <td style={{ ...tdLight, color: r.status === "PRESENT" ? "#15803d" : "#92400e" }}>{r.status}</td>
                      <td style={{ ...tdLight, whiteSpace: "nowrap" }}>
                        <button
                          disabled={busyRoll === r.roll}
                          onClick={() => verifyAndSeat(r.roll)}
                          style={{ ...miniBtn, background: "#1e40af", color: "#fff", border: "none" }}
                        >
                          {busyRoll === r.roll ? "…" : "Verify & Seat"}
                        </button>{" "}
                        <button
                          disabled={busyRoll === r.roll}
                          onClick={() => verifyAndSeat(r.roll, true)}
                          style={miniBtn}
                          title="INV-4 demo: a failed biometric denies check-in"
                        >
                          bio-fail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Live seat map ── */}
        <section>
          <h2 style={h2}>Live seat map</h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 12px" }}>
            Every candidate seat in this centre, refreshed every 3 s.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {seats
              .filter((s) => s.capability === "CANDIDATE_SEAT")
              .map((s) => (
                <div
                  key={s.terminalId}
                  title={`${s.seatNo} · ${s.state}${s.health && s.health !== "OK" ? ` · ${s.health}` : ""}`}
                  style={{
                    padding: "8px 10px", borderRadius: 8, fontSize: 12, fontFamily: "ui-monospace, monospace",
                    border: "1px solid #e2e8f0", background: seatColor(s.state), color: "#0f172a", minWidth: 64,
                  }}
                >
                  <strong>{s.seatNo}</strong>
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{s.state}</div>
                  {s.state === "IN_EXAM" && (
                    <button onClick={() => incident(s.seatNo, "MULTI_FACE")} style={{ ...miniBtn, marginTop: 4, fontSize: 10 }}>
                      raise incident
                    </button>
                  )}
                </div>
              ))}
          </div>
          <Legend />
        </section>
      </div>
    </main>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ["AVAILABLE", "free"],
    ["ASSIGNED", "candidate walking to seat"],
    ["ATTENDED", "logged in, paper sealed"],
    ["IN_EXAM", "exam under way"],
    ["SUBMITTED", "sealed & committed"],
    ["DOWN", "fault"],
  ];
  return (
    <p style={{ fontSize: 11, color: "#64748b", marginTop: 12 }}>
      {items.map(([k, v]) => (
        <span key={k} style={{ marginRight: 12 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: seatColor(k), marginRight: 4, verticalAlign: "baseline" }} />
          {k} — {v}
        </span>
      ))}
    </p>
  );
}

function seatColor(state: string): string {
  switch (state) {
    case "AVAILABLE": return "#dcfce7";
    case "ASSIGNED": return "#fef9c3";
    case "ATTENDED": return "#e0f2fe";
    case "IN_EXAM": return "#dbeafe";
    case "SUBMITTED": return "#ede9fe";
    case "DOWN": case "LOCKED": return "#fee2e2";
    default: return "#f1f5f9";
  }
}

const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#64748b", marginTop: 12, textAlign: "left" };
const field: React.CSSProperties = {
  width: "100%", padding: "10px 12px", marginTop: 4, borderRadius: 8,
  border: "1px solid #cbd5e1", fontFamily: "ui-monospace, monospace", fontSize: 14,
};
const btnPrimary: React.CSSProperties = {
  width: "100%", marginTop: 16, padding: "13px", borderRadius: 10, border: "none",
  background: "#1e40af", color: "#fff", fontWeight: 600, fontSize: 15,
};
const btnGhost: React.CSSProperties = {
  width: "100%", marginTop: 8, padding: "9px", borderRadius: 10,
  border: "1px solid #cbd5e1", background: "transparent", color: "#475569", fontSize: 13,
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff",
  color: "#475569", fontSize: 11, cursor: "pointer",
};
const h2: React.CSSProperties = { fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", color: "#334155" };
const thLight: React.CSSProperties = {
  position: "sticky", top: 0, background: "#f8fafc", textAlign: "left", padding: "8px 10px",
  fontSize: 11, color: "#64748b", borderBottom: "1px solid #e2e8f0",
};
const tdLight: React.CSSProperties = { padding: "7px 10px", borderBottom: "1px solid #f1f5f9" };
