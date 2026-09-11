// ============================================================
// Presentation timing — the ONE place the showdown choreography's pace is
// defined. The client animates with these numbers; the server holds a
// finished hand on the table for exactly as long as that animation needs
// (handEndHoldMs) before dealing the next one. Keep them together: a pace
// change here moves both sides at once, so the next deal never cuts a
// reveal short. Plain constants + one pure function — no UI, no I/O.
// ============================================================

import type { GameState } from "./types";

export const TIMING = {
  dealCardMs: 90,       // one hole card leaves the dealer every 90ms
  dealFlightMs: 420,    // how long a card is in the air
  boardCardMs: 340,     // flop cards land one at a time, this far apart
  streetBeatMs: 700,    // a visible beat before a turn or river card
  runoutCardMs: 1000,   // all-in runout: reveal → ~1s → reveal (never both at once)
  foldWinMs: 2400,      // "X takes the pot" hold when everyone folded
  boardHoldMs: 3600,    // DFT showdown: Board A step, then Board B step
  flipMs: 4600,         // DFT: one flip — deal five cards (5 × 350ms) then hold on the winner
  outcomeMs: 2600,      // DFT: a pot decided WITHOUT a flip (surrender / tied representation flip)
  nlheRevealMs: 4200,   // Hold'em showdown: hands + winner + the five cards, held
  potMoveMs: 1800,      // the pot slides to the winner(s)
  maxHoldMs: 45_000,    // hard cap on any hand-end hold
} as const;

/** Board cards dealt out AFTER betting ended (all-in) — the client reveals
 *  them one at a time with a beat before the showdown begins. */
function runoutMs(s: GameState): number {
  return (s.runoutCards ?? 0) * TIMING.runoutCardMs;
}

/** How long a finished hand stays on the table before the next deal. */
export function handEndHoldMs(s: GameState): number {
  if (s.variant === "dft") {
    const showdown = s.seats.some((x) => !x.empty && x.revealed);
    if (!showdown) return TIMING.foldWinMs + TIMING.potMoveMs;
    const flips = s.dft?.flips ?? [];
    const contests = s.dft?.contests ?? [];
    // pots that resolved with neither a flip nor a clean sweep need their own
    // explanation beat (a surrender, or a tied representation flip)
    const outcomes = contests.filter(
      (c) => c.kind !== "whole" && !flips.some((f) => f.potIndex === c.potIndex && f.stage !== "representation")
    ).length;
    return Math.min(
      TIMING.maxHoldMs,
      TIMING.boardHoldMs * 2 + flips.length * TIMING.flipMs + outcomes * TIMING.outcomeMs + TIMING.potMoveMs
    );
  }
  const showdown = (s.lastHandResult ?? []).some((r) => r.handName != null);
  if (!showdown) return TIMING.foldWinMs + TIMING.potMoveMs;
  return Math.min(TIMING.maxHoldMs, runoutMs(s) + TIMING.nlheRevealMs + TIMING.potMoveMs);
}
