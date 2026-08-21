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
import {
  enrollApi,
  type EnrolExam,
  type ExamOptions,
  type Organisation,
} from "@/lib/api/enroll";
import { detectFace, loadFaceApi } from "@/lib/biometric/face-real";
import { api } from "@/lib/api/client";

type Result = Awaited<ReturnType<typeof enrollApi.enrol>>;

export default function CandidateEnrolment() {
  // Registration is now anchored to an EXAM, not to a centre picked off a
  // separate list. You choose the body conducting it, then the exam it is
  // running, and everything after that — which locations exist, whether you may
  // choose between them, which subjects are optional — comes from the exam
  // itself. A candidate can no longer name an exam that was never approved, or
  // pick a centre that has nothing to do with the paper they are sitting.
  const [orgs, setOrgs] = useState<Organisation[] | null>(null);
  const [exams, setExams] = useState<EnrolExam[] | null>(null);
  const [options, setOptions] = useState<ExamOptions | null>(null);
  const [down, setDown] = useState(false);

  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [examId, setExamId] = useState("");
  const [prefs, setPrefs] = useState<string[]>([]);       // ordered location ids
  const [subjects, setSubjects] = useState<string[]>([]); // optional subject ids
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [otpStep, setOtpStep] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [otp, setOtp] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [emailVerificationToken, setEmailVerificationToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  useEffect(() => {
    enrollApi.organisations().then(setOrgs).catch(() => setDown(true));
  }, []);

  // Choosing a body reloads its exams and clears everything downstream — a
  // location or subject from the previous exam must never survive the change.
  useEffect(() => {
    setExamId(""); setOptions(null); setPrefs([]); setSubjects([]); setOptionsError(null);
    if (!org) { setExams(null); return; }
    let live = true;
    enrollApi.exams(org).then((e) => { if (live) setExams(e); }).catch(() => setDown(true));
    return () => { live = false; };
  }, [org]);

  useEffect(() => {
    setOptions(null); setPrefs([]); setSubjects([]); setOptionsError(null);
    if (!examId) return;
    let live = true;
    enrollApi.options(examId)
      .then((o) => {
        if (!live) return;
        setOptions(o);
        // One location is not a decision: fill it in rather than presenting a
        // list of one and asking someone to choose.
        if (!o.locationChoice && o.locations.length === 1) setPrefs([o.locations[0].id]);
      })
      .catch((e) => { if (live) setOptionsError((e as Error).message); });
    return () => { live = false; };
  }, [examId]);

  const optionalSubjects = (options?.subjects ?? []).filter((s) => !s.compulsory);
  const min = options?.subjectChoiceMin ?? 0;
  const max = options?.subjectChoiceMax ?? optionalSubjects.length;
  const subjectsOk = !options?.subjectChoice || (subjects.length >= min && subjects.length <= max);
  const locationsOk = prefs.length > 0;

  function togglePref(id: string) {
    setPrefs((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function toggleSubject(id: string) {
    setSubjects((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const j = await enrollApi.enrol({
        fullName, dateOfBirth: dob, examId,
        locationPreferences: prefs, subjectIds: subjects,
        email: email.trim(),
        emailVerificationToken: emailVerificationToken!,
        faceDescriptor: faceDescriptor!,
      });
      setResult(j);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <main style={page}>
        <section style={card}>
          <h1 style={h1}>You&apos;re enrolled ✓</h1>
          <p style={{ ...mono, margin: "14px 0", fontSize: 15 }}>Roll number&nbsp;&nbsp;{result.rollNumber}</p>
          <p style={muted}>{result.exam} · {result.organisation}{result.registrationYear ? ` · ${result.registrationYear}` : ""}</p>
          
          {result.emailDevPreview && (
            <div style={{ marginTop: 14, padding: 12, background: "#fffbe8", border: "1px solid #d4b800", borderRadius: 8, fontSize: 12 }}>
              <strong>🛠 Dev-mode email preview</strong> (no SMTP configured — in production this would be sent to your email):
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", fontSize: 11 }}>{result.emailDevPreview}</pre>
            </div>
          )}
          {result.emailDelivery === "smtp" && (
            <p style={{ fontSize: 12, color: "#2f5438", marginTop: 8 }}>✓ Confirmation email sent.</p>
          )}

          <dl style={{ fontSize: 14, margin: "16px 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
            <dt style={muted}>Location</dt>
            <dd style={{ margin: 0 }}>
              {result.location}
              {/* Say which preference was honoured. A candidate told only where
                  they are going cannot tell whether their ranking was used. */}
              {result.locationChoiceRank > 1 && (
                <span style={muted}> · your choice #{result.locationChoiceRank}</span>
              )}
            </dd>
            {result.subjects.length > 0 && (
              <>
                <dt style={muted}>Subjects</dt>
                <dd style={{ margin: 0 }}>{result.subjects.join(", ")}</dd>
              </>
            )}
          </dl>
          <ol style={{ fontSize: 14, lineHeight: 1.8, paddingLeft: 18, marginTop: 16 }}>
            <li>
              Your enrolment (face digest + details) is now stored
              {result.centre
                ? " and will be pre-positioned on your centre's secure terminal before exam day."
                : ". Your centre for this location is not commissioned yet — you will be told which one once it is."}
            </li>
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

        <label style={label}>Email address</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => {
              setEmail(e.target.value);
              if (otpStep !== 'idle') {
                setOtpStep('idle');
                setEmailVerificationToken(null);
                setOtp('');
              }
            }} 
            disabled={otpStep === 'verified' || busy}
            style={{ ...field, flex: 1 }} 
            placeholder="For your enrolment confirmation" 
          />
          {otpStep === 'idle' && (
            <button 
              type="button"
              disabled={!email || busy}
              onClick={async () => {
                setOtpError(null); setBusy(true);
                try {
                  const res = await api.requestEmailVerification({ email: email.trim(), purpose: 'CANDIDATE_REGISTRATION' });
                  setEmailChallengeId(res.challenge_id);
                  setOtpStep('sent');
                } catch (e) {
                  setOtpError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              style={{ ...ghostBtn, width: 'auto', whiteSpace: 'nowrap' }}
            >
              Verify
            </button>
          )}
          {otpStep === 'verified' && (
            <span style={{ color: '#15803d', fontSize: 13, fontWeight: 600 }}>✓ Verified</span>
          )}
        </div>
        {otpError && <p style={errp}>{otpError}</p>}
        
        {otpStep === 'sent' && (
          <div style={{ marginTop: 8, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <p style={{ fontSize: 13, margin: '0 0 8px', color: '#166534' }}>An OTP was sent to your email.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                type="text" 
                value={otp} 
                onChange={e => setOtp(e.target.value)} 
                maxLength={6}
                placeholder="Enter 6-digit OTP"
                style={{ ...field, width: 140 }}
              />
              <button
                type="button"
                disabled={otp.length !== 6 || busy}
                onClick={async () => {
                  setOtpError(null); setBusy(true);
                  try {
                    const res = await api.verifyEmailOtp({ challenge_id: emailChallengeId!, code: otp, email: email.trim() });
                    if (res.verified) {
                      setEmailVerificationToken(res.verification_token);
                      setOtpStep('verified');
                    }
                  } catch (e) {
                    setOtpError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{ ...ghostBtn, width: 'auto' }}
              >
                Confirm
              </button>
            </div>
          </div>
        )}

        <label style={label}>Date of birth</label>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={field} />

        <label style={label}>Conducting organisation</label>
        {down ? <p style={errp}>Couldn&apos;t reach the server — try again later.</p> : (
          <select value={org} onChange={(e) => setOrg(e.target.value)} style={field}>
            <option value="">{orgs ? "— who is conducting your exam? —" : "loading…"}</option>
            {(orgs ?? []).map((o) => <option key={o.key} value={o.name}>{o.name}</option>)}
          </select>
        )}
        {orgs?.length === 0 && (
          <p style={{ ...muted, fontSize: 12, marginTop: 6 }}>
            No exam is open for registration right now. An exam appears here once the
            conducting body&apos;s request has been approved.
          </p>
        )}

        <label style={label}>Examination</label>
        <select value={examId} onChange={(e) => setExamId(e.target.value)} style={field} disabled={!org || down}>
          <option value="">
            {!org ? "— choose the organisation first —" : exams ? "— choose your exam —" : "loading…"}
          </option>
          {/* The year disambiguates cycles of the same exam — a name alone
              cannot tell "NEET UG 2026" from the 2027 sitting. Appended only
              when the name does not already carry it. */}
          {(exams ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.year && !x.name.includes(String(x.year)) ? `${x.name} (${x.year})` : x.name}
            </option>
          ))}
        </select>

        {optionsError && <p role="alert" style={{ ...errp, marginTop: 10 }}>{optionsError}</p>}

        {options && (
          <>
            <label style={label}>
              {options.locationChoice ? "Preferred locations — best first" : "Examination location"}
            </label>
            {options.locationChoice ? (
              <>
                <p style={{ ...muted, fontSize: 12, margin: "0 0 8px" }}>
                  Tap in the order you want them. You are allotted the first one with a
                  seat left, so a second choice is worth giving.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {options.locations.map((l) => {
                    const rank = prefs.indexOf(l.id);
                    const picked = rank >= 0;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => togglePref(l.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                          padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14,
                          border: picked ? "1px solid #1e40af" : "1px solid #cbd5e1",
                          background: picked ? "#eff6ff" : "#fff",
                        }}
                      >
                        <span style={{
                          minWidth: 24, height: 24, borderRadius: 12, fontSize: 12, fontWeight: 700,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          background: picked ? "#1e40af" : "#e2e8f0", color: picked ? "#fff" : "#64748b",
                        }}>{picked ? rank + 1 : "+"}</span>
                        <span>
                          {l.name}
                          {(l.city || l.state) && (
                            <span style={muted}> · {[l.city, l.state].filter(Boolean).join(", ")}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!locationsOk && (
                  <p style={{ ...muted, fontSize: 12, marginTop: 6 }}>Choose at least one location.</p>
                )}
              </>
            ) : (
              // Exactly one location: stated, not chosen.
              <p style={{ ...field, margin: 0, background: "#f8fafc", color: "#334155" }}>
                {options.locations[0]?.name ?? "—"}
                {options.locations[0] && (options.locations[0].city || options.locations[0].state) && (
                  <span style={muted}>
                    {" "}· {[options.locations[0].city, options.locations[0].state].filter(Boolean).join(", ")}
                  </span>
                )}
                <span style={{ ...muted, display: "block", fontSize: 12 }}>
                  This exam is held at one location, so there is nothing to choose.
                </span>
              </p>
            )}

            {options.subjectChoice && (
              <>
                <label style={label}>Subjects</label>
                <p style={{ ...muted, fontSize: 12, margin: "0 0 8px" }}>
                  {min === max
                    ? `Choose exactly ${min}.`
                    : min > 0
                      ? `Choose between ${min} and ${max}.`
                      : `Choose up to ${max}.`}
                  {" "}Selected {subjects.length}.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {options.subjects.map((s) => (
                    <label
                      key={s.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                        borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14,
                        background: s.compulsory ? "#f8fafc" : "#fff",
                        cursor: s.compulsory ? "default" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={s.compulsory || subjects.includes(s.id)}
                        disabled={s.compulsory || (!subjects.includes(s.id) && subjects.length >= max)}
                        onChange={() => toggleSubject(s.id)}
                      />
                      <span>
                        {s.name}
                        {s.compulsory && <span style={muted}> · compulsory</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <label style={label}>Face capture</label>
        <FaceCapture onDescriptor={setFaceDescriptor} />

        {error && <p role="alert" style={{ ...errp, marginTop: 12 }}>Enrolment failed · {error}</p>}

        {(() => {
          const ready = !busy && !down && !!fullName.trim() && !!dob && !!examId
            && !!options && locationsOk && subjectsOk && !!faceDescriptor && otpStep === 'verified';
          return (
            <button
              disabled={!ready}
              onClick={submit}
              style={{ width: "100%", marginTop: 18, padding: 14, borderRadius: 10, border: "none",
                background: ready ? "#1e40af" : "#94a3b8",
                color: "#fff", fontWeight: 600, fontSize: 15, cursor: ready ? "pointer" : "not-allowed" }}
            >
              {busy ? "Enrolling…" : "Enrol"}
            </button>
          );
        })()}

        <p style={{ ...muted, fontSize: 12, marginTop: 14 }}>
          A real 128-d face descriptor is computed on your device (face-recognition CNN) — only that
          descriptor leaves this page, never the photo. Your fingerprint is enrolled in person at your
          centre seat.
        </p>
      </section>
    </main>
  );
}

/**
 * Why this component says so much when it fails.
 *
 * It used to be one `try` around both the model load and `getUserMedia`, with
 * `catch { setState("denied") }` — so a blocked permission, a laptop with no
 * camera, a camera already held by a video call, a page served over plain HTTP,
 * and a CDN that did not answer all produced the same sentence:
 * "Camera/model unavailable". None of those has the same remedy, and the Enrol
 * button is disabled without a descriptor, so whichever one a candidate hit was
 * a dead end they could not act on and we could not diagnose. On a public
 * registration page that is the difference between "allow the camera" and a
 * candidate who cannot sit the exam.
 *
 * The two stages are separated and every DOMException the spec defines for
 * getUserMedia is named, because the person reading it is a candidate, not an
 * engineer with a console open.
 */

/** getUserMedia's failure modes, in words a candidate can act on. */
function cameraProblem(err: unknown): { title: string; fix: string } {
  const name = (err as DOMException | undefined)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        title: "Your browser blocked camera access.",
        fix: "Click the camera icon in the address bar and choose Allow, then press Retry. If you dismissed the prompt earlier, the browser remembers that until you change it here.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "No camera was found on this device.",
        fix: "Connect a webcam and press Retry, or use “Upload a photo instead” below.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "The camera is in use by another application.",
        fix: "Close any video call, camera or meeting app that may be holding it, then press Retry.",
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        title: "This camera cannot provide the requested video format.",
        fix: "Press Retry — we will ask for whatever resolution it does support.",
      };
    case "SecurityError":
      return {
        title: "This page is not allowed to use the camera.",
        fix: "Cameras only work on a secure (https://) address. Open this page over https and try again.",
      };
    default:
      return {
        title: "The camera could not be started.",
        fix: (err as Error)?.message
          ? `The browser reported: ${(err as Error).message}`
          : "Press Retry, or use “Upload a photo instead” below.",
      };
  }
}

/** Webcam (or an uploaded photo) → REAL 128-d face descriptor, computed
 *  on-device by face-api.js. Only the descriptor leaves the browser, never the
 *  image — which is exactly why the upload fallback is safe to offer. */
function FaceCapture({ onDescriptor }: { onDescriptor: (d: number[] | null) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "live" | "captured" | "failed">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; fix: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  function fail(title: string, fix: string) {
    stop();
    setProblem({ title, fix });
    setState("failed");
    setMsg(null);
    onDescriptor(null);
  }

  async function start() {
    setState("loading"); setProblem(null);

    // Stage 1 — the model. Separated from the camera so "the CDN did not answer"
    // is never reported as "your camera is blocked".
    setMsg("Loading the face-recognition model…");
    try {
      await loadFaceApi();
    } catch (e) {
      fail(
        "The face-recognition model could not be loaded.",
        `This needs a working internet connection to fetch the model files. ${(e as Error)?.message ?? ""}`.trim(),
      );
      return;
    }

    // getUserMedia does not exist at all outside a secure context, so without
    // this the next line throws a TypeError and the old code called it a denial.
    // The remedy (serve over https) has nothing to do with permissions.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail(
        "This browser will not give any page camera access here.",
        "Cameras are only available on a secure (https://) address. Open this page over https, or use “Upload a photo instead” below.",
      );
      return;
    }

    // Stage 2 — the camera. `ideal`, not exact: an older webcam that cannot do
    // 640×480 should give us its own resolution rather than refuse outright.
    setMsg("Waiting for camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setState("live"); setMsg(null);
    } catch (e) {
      const p = cameraProblem(e);
      fail(p.title, p.fix);
    }
  }

  async function capture() {
    const v = videoRef.current;
    if (!v) return;
    setMsg("Detecting face…");
    try {
      const res = await detectFace(v);
      if (!res) { setMsg("No face detected — face the camera squarely, in good light, and try again."); return; }
      onDescriptor(res.descriptor);
      setState("captured"); setMsg(`✓ face captured · 128-d descriptor · detector ${(res.detectionScore * 100).toFixed(0)}%`);
      stop();
    } catch { setMsg("Face detection failed — try again."); }
  }

  /**
   * Fallback: a still photo. `detectFace` already accepts an HTMLImageElement,
   * and the descriptor is computed here in the browser exactly as it is from the
   * video — so the photo never leaves the device and the DPDP position is
   * unchanged. Without this, a candidate whose camera is broken simply cannot
   * enrol, and the exam is the thing they lose.
   */
  async function fromFile(file: File) {
    setState("loading"); setProblem(null); setMsg("Reading the photo…");
    const url = URL.createObjectURL(file);
    try {
      await loadFaceApi();
      const img = new Image();
      img.src = url;
      await img.decode();
      setMsg("Detecting face…");
      const res = await detectFace(img);
      if (!res) {
        fail(
          "No face was found in that photo.",
          "Use a clear, front-facing photo of just your face, in good light, and try again.",
        );
        return;
      }
      onDescriptor(res.descriptor);
      setState("captured");
      setMsg(`✓ face captured from photo · 128-d descriptor · detector ${(res.detectionScore * 100).toFixed(0)}%`);
    } catch (e) {
      fail("That photo could not be processed.", (e as Error)?.message ?? "Try a different photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const uploadControl = (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        style={{ ...ghostBtn, marginTop: 8 }}
      >
        Upload a photo instead
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = ""; }}
        style={{ display: "none" }}
      />
    </>
  );

  return (
    <div style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
      {state === "idle" && (
        <>
          <button type="button" onClick={start} style={ghostBtn}>Enable camera for face capture</button>
          {uploadControl}
        </>
      )}
      {state === "loading" && <p style={{ fontSize: 13, color: "#334155", margin: 0 }}>{msg}</p>}
      {state === "failed" && problem && (
        <div role="alert" style={{ fontSize: 13, margin: 0 }}>
          <p style={{ color: "#b91c1c", margin: 0, fontWeight: 600 }}>{problem.title}</p>
          <p style={{ color: "#334155", margin: "6px 0 0" }}>{problem.fix}</p>
          <button type="button" onClick={start} style={{ ...ghostBtn, marginTop: 10 }}>Retry the camera</button>
          {uploadControl}
        </div>
      )}
      <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 8, display: state === "live" ? "block" : "none" }} />
      {state === "live" && (
        <>
          <button type="button" onClick={capture} style={{ ...ghostBtn, marginTop: 10, background: "#1e40af", color: "#fff", border: "none" }}>Capture face</button>
          {msg && <p style={{ fontSize: 12, color: "#334155", margin: "8px 0 0" }}>{msg}</p>}
        </>
      )}
      {state === "captured" && (
        <>
          <p style={{ ...mono, fontSize: 12, margin: 0, color: "#15803d" }}>{msg}</p>
          <button type="button" onClick={start} style={{ ...ghostBtn, marginTop: 8 }}>Retake</button>
        </>
      )}
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
