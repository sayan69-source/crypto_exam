import Link from "next/link";

/**
 * Centre Invigilator Portal — entry point on the centre terminal.
 *
 * The full invigilator flow already exists in
 *   public/frontend/app/invigilator/* (login, verify, roster, alerts)
 *
 * This scaffold renders a placeholder; the canonical screens will be pulled
 * in via a shared workspace package in a later commit — see README.md.
 */
export default function InvigilatorPortalEntry() {
  return (
    <div className="screen">
      <div className="screen-panel">
        <span className="screen-state">INVIGILATOR PORTAL · SCAFFOLD</span>
        <h1>Centre Invigilator Portal</h1>
        <p>
          On an invigilator station inside a centre, this screen renders the
          roster, the candidate verification flow, the live attendance view,
          and the incident-report channel.
        </p>
        <p style={{ marginTop: 18, fontSize: 14, color: "#64748b" }}>
          The canonical implementation of these screens lives in{" "}
          <code>public/frontend/app/invigilator/*</code>. They will be brought into
          this terminal via a shared workspace package; that work is described
          in the project README and is not part of this scaffold commit.
        </p>
        <p style={{ marginTop: 28, fontSize: 14 }}>
          <Link href="/">← Back to terminal</Link>
        </p>
      </div>
    </div>
  );
}
