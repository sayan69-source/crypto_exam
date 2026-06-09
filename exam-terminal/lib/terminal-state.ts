/**
 * Terminal state machine.
 *
 * A centre terminal moves through five states; the screen the candidate
 * sees on this device is a pure function of which state the terminal is
 * in. Backend is authoritative; local cache survives short network blips.
 */

export type TerminalState =
  | "PROVISIONED"          // bound to an exam and a seat, not yet opened
  | "AWAITING_CANDIDATE"   // waiting for the candidate + invigilator
  | "ATTENDED"             // invigilator marked attendance; paper still sealed
  | "IN_EXAM"              // T0 reached, paper decrypted, exam under way
  | "SUBMITTED";           // receipt printed; back to PROVISIONED for next slot

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

/** Transitions that are legal in the state machine. */
const ALLOWED: Record<TerminalState, TerminalState[]> = {
  PROVISIONED:        ["AWAITING_CANDIDATE"],
  AWAITING_CANDIDATE: ["ATTENDED", "PROVISIONED"],
  ATTENDED:           ["IN_EXAM", "AWAITING_CANDIDATE"],
  IN_EXAM:            ["SUBMITTED"],
  SUBMITTED:          ["PROVISIONED"],
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
