/**
 * Terminal state machine (§5.3, v2).
 *
 * The screen this device shows is a pure function of its state. The Edge is
 * authoritative; the local cache survives short network blips. v2 adds the
 * locked Gate and the assignment states around the original five:
 *
 *   LOCKED_GATE ─▶ INVIGILATOR_AUTH ─▶ INVIGILATOR_CONSOLE
 *        └──────▶ AVAILABLE ─▶ ASSIGNED ─▶ CANDIDATE_AUTH ─▶ ATTENDED
 *                     ▲                                          │ T₀
 *                     └────────── wipe ◀── SUBMITTED ◀── IN_EXAM ┘
 */

export type TerminalState =
  // v2 gate + assignment states (§5.3)
  | "LOCKED_GATE"          // boot rest state: locked chooser, fail-closed (§7.6)
  | "INVIGILATOR_AUTH"     // §9.1 match-all login in progress on a station
  | "INVIGILATOR_CONSOLE"  // authenticated invigilator surface (§10.2)
  | "AVAILABLE"            // candidate seat idle in the assignment pool, polling
  | "ASSIGNED"             // a roll is bound to THIS seat; auto-redirecting
  | "CANDIDATE_AUTH"       // roll + DOB login on the bound seat (§9.7)
  // original exam-session states
  | "PROVISIONED"          // legacy v1 rest state (kept for old snapshots)
  | "AWAITING_CANDIDATE"   // waiting for the candidate + invigilator
  | "ATTENDED"             // invigilator marked attendance; paper still sealed
  | "IN_EXAM"              // T0 reached, paper decrypted, exam under way
  | "SUBMITTED";           // receipt shown; wiped back to AVAILABLE for next slot

/** Identifies the seat this terminal is provisioned for. */
export interface TerminalBinding {
  terminal_id: string;
  centre_id: string;
  exam_id: string;
  seat_no: string;
  candidate_roll: string;
  paper_variant: string;
  language: string;
  scheduled_at: string;  // ISO 8601 — when the paper becomes readable
}

export interface TerminalSnapshot {
  state: TerminalState;
  binding: TerminalBinding | null;
  attended_at: string | null;
  submitted_at: string | null;
  updated_at: string;
}

/** Transitions that are legal in the state machine (§5.3). Anything not
 * listed throws — a terminal can never "jump" into an exam state. */
const ALLOWED: Record<TerminalState, TerminalState[]> = {
  LOCKED_GATE:         ["INVIGILATOR_AUTH", "AVAILABLE"],
  INVIGILATOR_AUTH:    ["INVIGILATOR_CONSOLE", "LOCKED_GATE"],
  INVIGILATOR_CONSOLE: ["LOCKED_GATE"],
  AVAILABLE:           ["ASSIGNED", "LOCKED_GATE"],
  ASSIGNED:            ["CANDIDATE_AUTH", "AVAILABLE"],
  CANDIDATE_AUTH:      ["ATTENDED", "LOCKED_GATE"],
  PROVISIONED:         ["AWAITING_CANDIDATE", "LOCKED_GATE"],
  AWAITING_CANDIDATE:  ["ATTENDED", "PROVISIONED"],
  ATTENDED:            ["IN_EXAM", "AWAITING_CANDIDATE"],
  IN_EXAM:             ["SUBMITTED"],
  SUBMITTED:           ["PROVISIONED", "AVAILABLE"],
};

export function canTransition(from: TerminalState, to: TerminalState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

const STORAGE_KEY = "exam_terminal_snapshot";

const EMPTY: TerminalSnapshot = {
  state: "PROVISIONED",
  binding: null,
  attended_at: null,
  submitted_at: null,
  updated_at: new Date(0).toISOString(),
};

/** Read the cached snapshot (browser only). Returns EMPTY off-server. */
export function readSnapshot(): TerminalSnapshot {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return JSON.parse(raw) as TerminalSnapshot;
  } catch {
    return EMPTY;
  }
}

/** Persist a snapshot to the local cache (browser only). */
export function writeSnapshot(next: TerminalSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * Apply a transition. Throws if the transition isn't legal so the caller
 * can fail fast rather than silently advance into a bad screen.
 */
export function transition(
  current: TerminalSnapshot,
  to: TerminalState,
  patch?: Partial<Omit<TerminalSnapshot, "state" | "updated_at">>,
): TerminalSnapshot {
  if (!canTransition(current.state, to)) {
    throw new Error(`Illegal terminal transition ${current.state} -> ${to}`);
  }
  return {
    ...current,
    ...patch,
    state: to,
    updated_at: new Date().toISOString(),
  };
}
