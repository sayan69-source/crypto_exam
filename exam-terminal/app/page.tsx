"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readSnapshot, type TerminalSnapshot, type TerminalState } from "@/lib/terminal-state";

/**
 * Terminal entry.
 *
 * Reads the local terminal snapshot and renders the screen that matches the
 * current state. A real centre terminal also polls the backend; this scaffold
 * just shows the local snapshot.
 */
export default function TerminalEntry() {
  const [snap, setSnap] = useState<TerminalSnapshot | null>(null);

  useEffect(() => {
    setSnap(readSnapshot());
  }, []);

  if (!snap) {
    return (
      <div className="screen">
        <div className="screen-panel">
          <p>Initialising terminal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-panel">
        <span className="screen-state">STATE · {snap.state}</span>
        {renderForState(snap.state)}
      </div>
    </div>
  );
}

function renderForState(state: TerminalState) {
  switch (state) {
    case "PROVISIONED":
      return (
        <>
          <h1>This terminal is not yet bound to a candidate.</h1>
          <p>
            Your terminal will activate when an examination is scheduled and a
            seat is assigned. There is nothing to do from here.
          </p>
        </>
      );
    case "AWAITING_CANDIDATE":
      return (
        <>
          <h1>Awaiting candidate.</h1>
          <p>
            A candidate is expected at this seat. The exam will become available
            only after the centre invigilator has verified the candidate and
            marked attendance.
          </p>
          <p style={{ marginTop: 28, fontSize: 14, color: "#64748b" }}>
            Invigilator? Open the <Link href="/invigilator">centre invigilator portal</Link>.
          </p>
        </>
      );
    case "ATTENDED":
      return (
        <>
          <h1>Verification complete.</h1>
          <p>
            Attendance has been marked. The examination paper is sealed and will
            become available at the scheduled start time.
          </p>
          <p style={{ marginTop: 28, fontSize: 14, color: "#64748b" }}>
            When the paper opens, this screen will automatically advance to the{" "}
            <Link href="/candidate">examination portal</Link>.
          </p>
        </>
      );
    case "IN_EXAM":
      return (
        <>
          <h1>Examination in progress.</h1>
          <p>
            Continue to the <Link href="/candidate">examination portal</Link>.
          </p>
        </>
      );
    case "SUBMITTED":
      return (
        <>
          <h1>Examination submitted.</h1>
          <p>
            Your cryptographic receipt has been printed. You may leave the
            centre. This terminal will reset for its next slot.
          </p>
        </>
      );
  }
}
