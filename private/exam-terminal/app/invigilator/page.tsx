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
  centreExams,
  checkin,
  clearToken,
  getToken,
  raiseIncident,
  roster as fetchRoster,
  seatMap as fetchSeatMap,
  terminalIdentity,
  EdgeError,
  type CentreExam,
  type RosterRow,
  type SeatMapRow,
} from "@/lib/edge";
import {
  activateWithCode,
  captureCheckin,
  invigilatorLogin,
  registerStaff,
} from "@/lib/identity";

export default function InvigilatorPortal() {
  const [authed, setAuthed] = useState<boolean>(false);
  const [stationId, setStationId] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
    // On a machine commissioned as several stations (the all-in-one), take the
    // invigilator one; a single-role terminal returns its only identity.
    void terminalIdentity("INVIGILATOR_STATION").then(setStationId);
  }, []);

  // The station id comes from the signed image; there is nothing to type and
  // nothing to choose (§7.1).
  if (!stationId) {
    return (
      <div className="screen">
        <div className="screen-panel" style={{ maxWidth: 520 }}>
          <span className="screen-state">STATION NOT COMMISSIONED</span>
          <h1>This machine has no identity.</h1>
          <p style={{ fontSize: 14 }}>
            No commissioned identity was found in the signed image. An
            invigilator station must be registered with the Edge before it can
            take a login.
          </p>
        </div>
      </div>
    );
  }

  return authed
    ? <Console stationId={stationId} onLock={() => { clearToken(); setAuthed(false); }} />
    : <Login stationId={stationId} onAuthed={() => setAuthed(true)} />;
}

// ════════════════════════ login + registration ════════════════════════════
function Login({ stationId, onAuthed }: { stationId: string; onAuthed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  async function login() {
    setBusy(true);
    setError(null);
    // Everything happens outside this component: the daemon measures and signs,
    // the Edge verifies and decides. There is no probe to assemble here and no
    // switch that could make a station without a camera look like one with.
    const verdict = await invigilatorLogin(stationId);
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
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 10 }}>
              station <code>{stationId.slice(0, 8)}…</code> · the Edge observes
              this machine&apos;s address and attestation itself
            </p>
            {error && <p role="alert" style={{ color: "#dc2626", fontSize: 14, marginTop: 12 }}>{error}</p>}
            <button disabled={busy} onClick={login} style={btnPrimary}>
              {busy ? "Look at the camera and hold your finger on the reader…" : "Capture face + fingerprint & login"}
            </button>
            <button onClick={() => setMode("register")} style={{ ...btnGhost, marginTop: 18 }}>
              New invigilator? Register (§9.2)
            </button>
          </>
        ) : (
          <Registration onBack={() => setMode("login")} stationId={stationId} />
        )}
      </div>
    </div>
  );
}

function Registration({ onBack, stationId }: { onBack: () => void; stationId: string }) {
  const [fullName, setFullName] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setStatus(null);
    // No centre and no bindings are sent: the Edge reads the centre from this
    // station's registry row and the address from the connection.
    const r = await registerStaff("/invigilator/register", { terminalId: stationId, fullName });
    setBusy(false);
    if ("error" in r) return setStatus(`Registration failed · ${r.error}`);
    setRequestId(r.requestId);
    setStatus("PENDING_APPROVAL — give this request id to your Centre Admin in person.");
  }

  async function activate() {
    if (!requestId) return;
    setBusy(true);
    const r = await activateWithCode({ requestId, code, terminalId: stationId });
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
function Console({ stationId, onLock }: { stationId: string; onLock: () => void }) {
  const [exams, setExams] = useState<CentreExam[] | null>(null);
  const [examId, setExamId] = useState<string | null>(null);
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

  // Which exam this console is invigilating comes from the centre's own data.
  useEffect(() => {
    void (async () => {
      try {
        const { exams: list } = await centreExams();
        setExams(list);
        setExamId((current) => current ?? list[0]?.id ?? null);
      } catch (e) {
        setNotice(`exams: ${guard(e)}`);
        setExams([]);
      }
    })();
  }, [guard]);

  const refreshRoster = useCallback(async () => {
    if (!examId) return;
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

  /**
   * The "Verify & Seat" widget (§10.2): capture at the desk, check in, then
   * random assignment.
   *
   * The capture is a live measurement of the person standing there, signed by
   * this station's daemon and bound to this roll. It cannot be pre-recorded,
   * reused for the next candidate, or replaced with a number.
   */
  async function verifyAndSeat(roll: string) {
    if (!examId) return;
    setBusyRoll(roll);
    setNotice(null);
    try {
      const captured = await captureCheckin({ stationId, examId, roll });
      if ("error" in captured) {
        setNotice(`✗ ${roll}: ${captured.error}`);
        return;
      }
      await checkin({ examId, roll, challengeNonce: captured.nonce, bio: captured.bio });
      const seat = await assignSeat({ examId, roll });
      setNotice(`✓ ${roll} verified & seated at ${seat.seatNo}`);
      await Promise.all([refreshRoster(), refreshSeats()]);
    } catch (e) {
      if (e instanceof EdgeError) {
        setNotice(
          e.body.reason === "BIOMETRIC_MISMATCH"
            ? `✗ ${roll}: biometric mismatch — check-in DENIED and logged (§9.5)`
            : e.body.reason === "BIOMETRIC_ATTESTATION_INVALID"
              ? `✗ ${roll}: the capture was not accepted (${(e.body.failures ?? []).join(", ")})`
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
        {exams && exams.length > 1 && (
          <select
            value={examId ?? ""}
            onChange={(e) => setExamId(e.target.value)}
            style={{ ...miniBtn, padding: "6px 10px", fontSize: 12 }}
          >
            {exams.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        )}
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
          {exams?.length === 0 ? (
            <p style={{ fontSize: 14, color: "#92400e" }}>
              No exam is scheduled at this centre. The roster arrives with the
              HQ provisioning sync before exam day.
            </p>
          ) : !rosterRows ? (
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
                          title="Capture this candidate's face and fingerprint now"
                        >
                          {busyRoll === r.roll ? "capturing…" : "Verify & Seat"}
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
