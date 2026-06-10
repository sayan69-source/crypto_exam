/**
 * StatCard — a single labelled count tile for the dashboards (§10.3 counts
 * panel, §10.4 nationwide view). Presentational; the value is supplied by the
 * caller after a scoped, authorised counts query.
 */
import type { CSSProperties, ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  accent?: "default" | "ok" | "warn" | "danger" | "sealed";
  hint?: string;
}

const ACCENTS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "#1f6feb",
  ok: "#3fb950",
  warn: "#d29922",
  danger: "#f85149",
  sealed: "#8957e5",
};

export function StatCard({ label, value, accent = "default", hint }: StatCardProps) {
  const bar = ACCENTS[accent];
  const card: CSSProperties = {
    borderRadius: 12,
    border: "1px solid var(--zuup-line, #243044)",
    background: "var(--zuup-panel, #11161d)",
    padding: "16px 18px",
    borderLeft: `4px solid ${bar}`,
    minWidth: 180,
  };
  return (
    <div style={card}>
      <div style={{ fontSize: 12, letterSpacing: "0.05em", color: "#8b97a7" }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6, color: "#e6edf3" }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: "#6b7888", marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}
