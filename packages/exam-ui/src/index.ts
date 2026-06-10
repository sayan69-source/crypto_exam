/**
 * @zuup/exam-ui — shared presentational components.
 *
 * Everything here is pure presentation: it takes props and renders. It makes
 * no network calls, holds no secrets, and contains no role/authorisation
 * logic. That keeps it safe to share across the public/ ↔ private/ boundary
 * (§14): the boundary gate forbids private/** from importing public/** code,
 * but a presentational package shared by both halves crosses nothing.
 */
export { LockGate } from "./LockGate";
export type { LockGateProps, TerminalCapability } from "./LockGate";
export { StatCard } from "./StatCard";
export type { StatCardProps } from "./StatCard";
export { CodeBadge } from "./CodeBadge";
export type { CodeBadgeProps } from "./CodeBadge";
export { SealedBadge } from "./SealedBadge";
export type { SealedBadgeProps } from "./SealedBadge";
