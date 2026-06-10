/**
 * CodeBadge — renders a one-time authorisation code (§9.4) inside the
 * approver's portal ONLY. The code is a security primitive: it is generated
 * server-side on the Edge, shown only here for its short TTL, and handed over
 * in person. It never travels by email/SMS/internet.
 *
 * Presentational: the caller passes the cleartext code (which exists only in
 * the approver's authenticated view) and the expiry. This component does not
 * fetch, store, or transmit it.
 */
import type { CSSProperties } from "react";

export interface CodeBadgeProps {
  /** Cleartext one-time code, e.g. "7-3K9-Q2". Shown only in the approver view. */
  code: string;
  /** Human-readable expiry, e.g. "expires in 9:41". */
  expiresLabel?: string;
  consumed?: boolean;
}

const box: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px dashed var(--zuup-accent, #1f6feb)",
  background: "rgba(31,111,235,0.08)",
};

export function CodeBadge({ code, expiresLabel, consumed }: CodeBadgeProps) {
  return (
    <span style={box} aria-label="one-time authorisation code">
      <span
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: consumed ? "#6b7888" : "#58a6ff",
          textDecoration: consumed ? "line-through" : "none",
        }}
      >
        {code}
      </span>
      <span style={{ fontSize: 11, color: consumed ? "#f85149" : "#8b97a7" }}>
        {consumed ? "consumed — single use" : expiresLabel ?? "one-time · single use"}
      </span>
    </span>
  );
}
