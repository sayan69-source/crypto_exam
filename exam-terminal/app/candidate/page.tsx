import Link from "next/link";

/**
 * Candidate Examination Portal — entry point on the centre terminal.
 *
 * The full candidate flow already exists and is battle-tested in
 *   frontend/app/exam/* (system-check, instructions, session, receipt)
 *
 * For this scaffold we render a clear placeholder rather than duplicating
 * those screens here. Porting them in (via a shared workspace package or a
 * controlled copy) is the next step and is intentionally out of scope for
 * this commit — see README.md, section "What is in this project today".
 */
export default function CandidatePortalEntry() {
  return (
    <div className="screen">
      <div className="screen-panel">
        <span className="screen-state">CANDIDATE PORTAL · SCAFFOLD</span>
        <h1>Candidate Examination Portal</h1>
        <p>
          On a provisioned centre terminal, this screen renders the sealed
          examination interface for the candidate at this seat — system check,
          instructions, the paper itself, and the cryptographic receipt.
        </p>
        <p style={{ marginTop: 18, fontSize: 14, color: "#64748b" }}>
          The canonical implementation of these screens lives in{" "}
          <code>frontend/app/exam/*</code>. They will be brought into this
          terminal via a shared workspace package; that work is described in
          the project README and is not part of this scaffold commit.
        </p>
        <p style={{ marginTop: 28, fontSize: 14 }}>
          <Link href="/">← Back to terminal</Link>
        </p>
      </div>
    </div>
  );
}
