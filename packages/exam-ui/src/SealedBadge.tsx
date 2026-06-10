/**
 * SealedBadge — the §10.3 "blind courier" marker, and its §11.5 HQ counterpart.
 *
 * SEALED / SYNCED render at the Centre Admin store, which holds answer
 * ciphertext and hashes only; it has no private key and can never open a
 * bundle (INV-6). ANCHORED renders at HQ once a bundle's no-PII root has been
 * committed to the public chain (§11.5).
 */
import type { CSSProperties } from "react";

export interface SealedBadgeProps {
  state?: "SEALED" | "SYNCED" | "ANCHORED";
}

const badge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid #8957e5",
  background: "rgba(137,87,229,0.12)",
  color: "#b692f6",
  fontSize: 12,
  fontWeight: 600,
};

const COPY: Record<NonNullable<SealedBadgeProps["state"]>, { label: string; title: string }> = {
  SEALED: { label: "SEALED · cannot be opened here", title: "Cannot be opened here — sealed to System Admin (INV-6)" },
  SYNCED: { label: "SYNCED · cannot be opened here", title: "Cannot be opened here — sealed to System Admin (INV-6)" },
  ANCHORED: { label: "ANCHORED · public chain, no PII", title: "Answer root anchored on the public chain — hashes and counts only (§11.5)" },
};

export function SealedBadge({ state = "SEALED" }: SealedBadgeProps) {
  const { label, title } = COPY[state];
  return (
    <span style={badge} title={title}>
      🔒 {label}
    </span>
  );
}
