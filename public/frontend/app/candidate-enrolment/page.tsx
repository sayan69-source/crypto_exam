"use client";
/**
 * Public CANDIDATE enrolment.
 *
 * A candidate is not a web account and never logs in online. They enrol here
 * with their details + a face capture (only the digest leaves the device); the
 * fingerprint is bound in person at the centre seat. The enrolment is stored
 * and provisioned to the centre's Edge so the candidate is verified
 * biometrically, OFFLINE, at the exam-centre terminal on exam day.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { staffApi, type Centre } from "@/lib/api/staff";
import { enrollApi, type EnrolExam } from "@/lib/api/enroll";
import { detectFace, loadFaceApi } from "@/lib/biometric/face-real";

export default function CandidateEnrolment() {
  const [exams, setExams] = useState<EnrolExam[] | null>(null);
  const [centres, setCentres] = useState<Centre[] | null>(null);
  const [down, setDown] = useState(false);
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [examId, setExamId] = useState("");
  const [centerId, setCenterId] = useState("");
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rollNumber: string; centre: string; exam: string; registrationYear?: number; emailDevPreview?: string; emailDelivery?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([enrollApi.exams(), staffApi.centres()])
      .then(([e, c]) => { setExams(e); setCentres(c); })
      .catch(() => setDown(true));
  }, []);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const j = await enrollApi.enrol({ fullName, dateOfBirth: dob, examId, centerId, email: email.trim() || undefined, faceDescriptor: faceDescriptor! });
      setResult({ rollNumber: j.rollNumber, centre: j.centre, exam: j.exam, registrationYear: (j as any).registrationYear, emailDevPreview: (j as any).emailDevPreview, emailDelivery: (j as any).emailDelivery });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <main style={page}>
        <section style={card}>
          <h1 style={h1}>You&apos;re enrolled ✓</h1>
          <p style={{ ...mono, margin: "14px 0", fontSize: 15 }}>Roll number&nbsp;&nbsp;{result.rollNumber}</p>
          <p style={muted}>{result.exam} · {result.centre}{result.registrationYear ? ` · ${result.registrationYear}` : ""}</p>
          {result.emailDevPreview && (
            <div style={{ marginTop: 14, padding: 12, background: "#fffbe8", border: "1px solid #d4b800", borderRadius: 8, fontSize: 12 }}>
              <strong>📧 Dev-mode email preview</strong> (no SMTP configured — in production this would be sent to your email):
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 11 }}>{result.emailDevPreview}</pre>
            </div>
          )}
          {result.emailDelivery === "smtp" && (
            <p style={{ fontSize: 12, color: "#2f5438", marginTop: 8 }}>✓ Confirmation email sent.</p>
          )}
          <ol style={{ fontSize: 14, lineHeight: 1.8, paddingLeft: 18, marginTop: 16 }}>
            <li>Your enrolment (face digest + details) is now stored and will be pre-positioned on your centre&apos;s secure terminal before exam day.</li>
            <li><strong>There is no online login.</strong> On exam day you are verified by <strong>face + fingerprint at the centre</strong> — your fingerprint is enrolled in person at your seat.</li>
            <li>The centre network is offline during the exam; everything is verified locally.</li>
          </ol>
        </section>
      </main>
    );
  }

  return (
    <main style={page}>
      <section style={card}>
        <h1 style={h1}>Candidate enrolment</h1>
        <p style={muted}>
          Candidates don&apos;t log in online. Enrol here with your details and face; you&apos;ll be
          verified by face + fingerprint at your exam centre, offline, on exam day.
        </p>

        <label style={label}>Full name (as on your government ID)</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={field} placeholder="e.g. Aarav Sharma" />

        <label style={label}>Email address (for enrolment confirmation)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} placeholder="e.g. aarav.sharma@example.com" />

        <label style={label}>Date of birth</label>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={field} />

        <label style={label}>Examination</label>
        {down ? <p style={errp}>Couldn&apos;t reach the server — try again later.</p> : (
          <select value={examId} onChange={(e) => setExamId(e.target.value)} style={field}>
            <option value="">{exams ? "— choose your exam —" : "loading…"}</option>
            {(exams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}

        <label style={label}>Examination centre</label>
        <select value={centerId} onChange={(e) => setCenterId(e.target.value)} style={field} disabled={down}>
          <option value="">{centres ? "— choose your centre —" : "loading…"}</option>
          {(centres ?? []).map((c) => <option key={c.centerId} value={c.centerId}>{c.name}{c.state ? ` · ${c.state}` : ""}</option>)}
        </select>

        <label style={label}>Face capture</label>
        <FaceCapture onDescriptor={setFaceDescriptor} />

        {error && <p role="alert" style={{ ...errp, marginTop: 12 }}>Enrolment failed · {error}</p>}

        <button
          disabled={busy || down || !fullName.trim() || !dob || !examId || !centerId || !faceDescriptor}
          onClick={submit}
          style={{ width: "100%", marginTop: 18, padding: 14, borderRadius: 10, border: "none",
            background: busy || !fullName.trim() || !dob || !examId || !centerId || !faceDescriptor ? "#939084" : "#4a3f34",
            color: "#fffefb", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
        >
          {busy ? "Enrolling…" : "Enrol"}
        </button>

        <p style={{ ...muted, fontSize: 12, marginTop: 14 }}>
          A real 128-d face descriptor is computed on your device (face-recognition CNN) — only that
          descriptor leaves this page, never the photo. Your fingerprint is enrolled in person at your
          centre seat.
        </p>
      </section>
    </main>
  );
}

/** Webcam → REAL 128-d face descriptor (face-api.js on-device). Only the
 *  descriptor leaves the browser, never the photo. */
function FaceCapture({ onDescriptor }: { onDescriptor: (d: number[] | null) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "live" | "captured" | "denied">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    setState("loading"); setMsg("Loading face-recognition model…");
    try {
      await loadFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setState("live"); setMsg(null);
    } catch { setState("denied"); setMsg(null); onDescriptor(null); }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v) return;
    setMsg("Detecting face…");
    try {
      const res = await detectFace(v);
      if (!res) { setMsg("No face detected — face the camera and try again."); return; }
      onDescriptor(res.descriptor);
      setState("captured"); setMsg(`✓ face captured · 128-d descriptor · detector ${(res.detectionScore * 100).toFixed(0)}%`);
      stop();
    } catch { setMsg("Face detection failed — try again."); }
  }

  return (
    <div style={{ border: "1px solid #c5c0b1", borderRadius: 10, padding: 12, background: "#fffefb" }}>
      {state === "idle" && <button onClick={start} style={ghostBtn}>Enable camera for face capture</button>}
      {state === "loading" && <p style={{ fontSize: 13, color: "#36342e", margin: 0 }}>{msg}</p>}
      {state === "denied" && (
        <p style={{ fontSize: 13, color: "#8f2418", margin: 0 }}>
          Camera/model unavailable — face capture is required to enrol.
          <button onClick={start} style={{ ...ghostBtn, marginTop: 8 }}>Retry</button>
        </p>
      )}
      <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 8, display: state === "live" ? "block" : "none" }} />
      {state === "live" && (
        <>
          <button onClick={capture} style={{ ...ghostBtn, marginTop: 10, background: "#4a3f34", color: "#fffefb", border: "none" }}>Capture face</button>
          {msg && <p style={{ fontSize: 12, color: "#36342e", margin: "8px 0 0" }}>{msg}</p>}
        </>
      )}
      {state === "captured" && <p style={{ ...mono, fontSize: 12, margin: 0, color: "#2f5438" }}>{msg}</p>}
    </div>
  );
}

const page: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", background: "#f8f4f0" };
const card: React.CSSProperties = { width: "min(640px, 96vw)", background: "#fffefb", border: "1px solid #e8e2d8", borderRadius: 16, padding: "30px 32px" };
const h1: React.CSSProperties = { margin: 0, fontSize: 24 };
const muted: React.CSSProperties = { color: "#605d52", fontSize: 14 };
const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#605d52", margin: "18px 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" };
const field: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid #c5c0b1", fontSize: 14, background: "#fffefb" };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", wordBreak: "break-all" };
const errp: React.CSSProperties = { color: "#8f2418", fontSize: 13 };
const ghostBtn: React.CSSProperties = { display: "block", width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #c5c0b1", background: "#fffefb", color: "#36342e", fontSize: 13, cursor: "pointer" };
