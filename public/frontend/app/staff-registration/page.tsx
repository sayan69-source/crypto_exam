"use client";
/**
 * Public staff registration (§9.2 step 3 / §10.1 step 3, captured at HQ).
 *
 * The centre LAN is internet-free (ZUUP-OS INV-3), so a NEW Centre Admin or
 * Centre Invigilator registers HERE on the public website. The request is
 * relayed to their centre's Edge (app/api/staff-registration) and lands as
 * PENDING_APPROVAL in the normal cascade:
 *
 *   Centre Admin applicant  → approved by the SYSTEM ADMIN (HQ portal)
 *   Invigilator applicant   → approved by that centre's CENTRE ADMIN (LAN portal)
 *
 * Registration here is capture ONLY. Becoming ACTIVE always happens in person
 * at the centre: the approver issues a one-time code (shown only to them),
 * authorises the fingerprint, and the applicant activates at a centre station
 * with code + live fingerprint (§9.4). This page cannot mint a working login.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { staffApi, type Centre } from "@/lib/api/staff";

type Role = "CENTER_INVIGILATOR" | "CENTER_ADMIN";

export default function StaffRegistration() {
  const [role, setRole] = useState<Role>("CENTER_INVIGILATOR");
  const [centres, setCentres] = useState<Centre[] | null>(null);
  const [relayDown, setRelayDown] = useState(false);
  const [centerId, setCenterId] = useState("");
  const [fullName, setFullName] = useState("");
  const [faceHash, setFaceHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ requestId: string; approver: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staffApi.centres()
      .then((c) => setCentres(c))
      .catch(() => setRelayDown(true));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const j = await staffApi.register({ role, centerId, fullName, faceEmbeddingHash: faceHash! });
      setResult({ requestId: j.requestId, approver: j.approver });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main style={page}>
        <section style={card}>
          <h1 style={h1}>Registration submitted ✓</h1>
          <p style={muted}>
            Your request is <strong>PENDING_APPROVAL</strong> at your centre&apos;s Edge.
          </p>
          <p style={{ ...mono, margin: "14px 0", fontSize: 13 }}>request id&nbsp;&nbsp;{result.requestId}</p>
          <ol style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 18 }}>
            <li>
              {result.approver === "SYSTEM_ADMIN"
                ? "The System Admin reviews your request in the HQ portal."
                : "Your centre's Centre Admin reviews your request in the centre portal."}
            </li>
            <li>If approved, the approver issues a <strong>one-time code</strong> (10-minute validity) and authorises your fingerprint enrolment — they share the code with you directly, in person or via a verified channel.</li>
            <li>
              <strong>Visit your centre.</strong> At a centre station you enter the code and enrol your
              fingerprint live. Only then does your identity become ACTIVE — and your station + LAN IP
              are bound at that moment.
            </li>
          </ol>
          <p style={{ ...muted, fontSize: 13, marginTop: 12 }}>
            Note: this website cannot activate you. Every activation is an in-person ceremony at the
            centre — that is what keeps a stolen browser session worthless.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={page}>
      <section style={card}>
        <h1 style={h1}>Centre staff registration</h1>
        <p style={muted}>
          Exam-centre networks are sealed from the internet, so new centre staff register here.
          Approval and activation still happen through your centre&apos;s chain of trust.
        </p>

        <label style={label}>I am registering as</label>
        <div style={{ display: "flex", gap: 8 }}>
          {(
            [
              ["CENTER_INVIGILATOR", "Centre Invigilator", "approved by your Centre Admin"],
              ["CENTER_ADMIN", "Centre Admin", "approved by the System Admin"],
            ] as Array<[Role, string, string]>
          ).map(([r, title, sub]) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              style={{
                flex: 1, padding: "12px 10px", borderRadius: 10, cursor: "pointer",
                border: role === r ? "2px solid #1e40af" : "1px solid #cbd5e1",
                background: role === r ? "#eff6ff" : "#fff", textAlign: "left",
              }}
            >
              <strong style={{ fontSize: 14 }}>{title}</strong>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sub}</div>
            </button>
          ))}
        </div>

        <label style={label}>Examination centre</label>
        {relayDown ? (
          <p style={{ color: "#b91c1c", fontSize: 13 }}>
            The HQ↔centre relay is unavailable right now — try again later. (Registrations are never
            taken without a live link to your centre.)
          </p>
        ) : (
          <select value={centerId} onChange={(e) => setCenterId(e.target.value)} style={field}>
            <option value="">{centres ? "— choose your centre —" : "loading centres…"}</option>
            {(centres ?? []).map((c) => (
              <option key={c.centerId} value={c.centerId}>
                {c.name}{c.state ? ` · ${c.state}` : ""}
              </option>
            ))}
          </select>
        )}

        <label style={label}>Full name (as on your government ID)</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={field} placeholder="e.g. Neha Rao" />

        <label style={label}>Face capture</label>
        <FaceCapture onHash={setFaceHash} />

        {error && (
          <p role="alert" style={{ color: "#b91c1c", fontSize: 13, marginTop: 12 }}>
            Registration failed · {error}
          </p>
        )}

        <button
          disabled={busy || !centerId || !fullName.trim() || !faceHash || relayDown}
          onClick={submit}
          style={{
            width: "100%", marginTop: 18, padding: 14, borderRadius: 10, border: "none",
            background: busy || !centerId || !fullName.trim() || !faceHash ? "#94a3b8" : "#1e40af",
            color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer",
          }}
        >
          {busy ? "Submitting…" : "Submit registration (PENDING approval)"}
        </button>

        <p style={{ ...muted, fontSize: 12, marginTop: 14 }}>
          Fingerprints are never captured in a browser — you enrol yours in person at the centre when
          you activate with the approver&apos;s one-time code. Your face image is processed locally and
          only its digest leaves this page.
        </p>
      </section>
    </main>
  );
}

/** Webcam capture → SHA-256 digest of the frame (the enrolment embedding-hash
 * stand-in). The raw image never leaves the browser. */
function FaceCapture({ onHash }: { onHash: (h: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"idle" | "live" | "captured" | "denied">("idle");
  const [hash, setHash] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("live");
    } catch {
      setState("denied");
      onHash(null);
    }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("capture"))), "image/png"),
    );
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    setHash(hex);
    onHash(hex);
    setState("captured");
    stop();
  }

  return (
    <div style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
      {state === "idle" && (
        <button onClick={start} style={ghostBtn}>Enable camera for face capture</button>
      )}
      {state === "denied" && (
        <p style={{ fontSize: 13, color: "#b91c1c", margin: 0 }}>
          Camera unavailable or denied — face capture is required to register.
          <button onClick={start} style={{ ...ghostBtn, marginTop: 8 }}>Retry</button>
        </p>
      )}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ width: "100%", borderRadius: 8, display: state === "live" ? "block" : "none" }}
      />
      {state === "live" && (
        <button onClick={capture} style={{ ...ghostBtn, marginTop: 10, background: "#1e40af", color: "#fff", border: "none" }}>
          Capture face
        </button>
      )}
      {state === "captured" && hash && (
        <p style={{ ...mono, fontSize: 12, margin: 0, color: "#15803d" }}>
          ✓ face captured · digest {hash.slice(0, 16)}… (image stayed on this device)
        </p>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center",
  padding: "48px 16px", background: "#f1f5f9",
};
const card: React.CSSProperties = {
  width: "min(640px, 96vw)", background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 16, padding: "30px 32px",
};
const h1: React.CSSProperties = { margin: 0, fontSize: 24 };
const muted: React.CSSProperties = { color: "#64748b", fontSize: 14 };
const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#64748b", margin: "18px 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" };
const field: React.CSSProperties = {
  width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14, background: "#fff",
};
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", wordBreak: "break-all" };
const ghostBtn: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontSize: 13, cursor: "pointer",
};
