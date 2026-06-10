"use client";
/**
 * Seat-assignment watcher (§9.6) — the candidate-seat side of the iON-style
 * hand-off. An AVAILABLE seat polls its own state on the Edge; the moment an
 * invigilator's `assign_random_seat()` binds a roll to THIS terminal, the
 * watcher reports ASSIGNED and the Gate auto-redirects into candidate auth.
 *
 * Poll, not push, on purpose: the seat keeps no listening socket open (§6.3
 * nftables allows outbound-to-Edge only), and a missed poll fails closed —
 * the seat simply stays locked.
 */
import { seatState, type SeatStateResponse } from "./edge";

export interface AssignmentWatch {
  stop: () => void;
}

export function watchAssignment(
  terminalId: string,
  onChange: (s: SeatStateResponse) => void,
  intervalMs = 2_000,
): AssignmentWatch {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped) return;
    try {
      const s = await seatState(terminalId);
      if (!stopped) onChange(s);
    } catch {
      // Edge unreachable → report nothing; the Gate's own health probe will
      // flip the surface to "Centre offline" (INV-10).
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  }

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
