// ============================================================
// PER-PLAYER STATE FILTER — the anti-cheat seam.
//
// The engine's GameState contains EVERYONE's secrets (that's
// correct: the engine is the source of truth and, in hot-seat
// mode, the one screen legitimately sees all). The server calls
// this before sending state to each client so that a player's
// wire traffic NEVER contains another player's un-revealed secret.
//
// Three kinds of per-seat secret, with DIFFERENT reveal gates:
//   - holeCards + arrangement (DFT split): revealed TOGETHER at the
//     simultaneous reveal that ends the picking phase — the engine's
//     `revealed` flag flips true for showdown seats at that instant.
//   - declarations (DFT run/surrender): BLIND through the entire
//     decisions phase — public only once the hand is fully over.
//     `revealed` is already true during decisions, so declarations
//     need their own gate (phase === "handEnded"), NOT the card gate.
//
// Kept as a pure function in its own file so test-filter.ts can
// hammer it directly, without a websocket in the loop.
// ============================================================

import type { GameState } from "../shared/engine/types";

/**
 * Return a copy of `state` as seen by `viewerSeat`
 * (null = spectator: sees no hidden secrets at all).
 *
 * A seat keeps its holeCards/arrangement only if it IS the viewer, or
 * the engine marked it `revealed` (showdown / voluntary show / the DFT
 * picking reveal — the engine owns that rule; we never re-derive it).
 * A seat's run/surrender declarations survive to other viewers only once
 * the hand has ended — they are blind and simultaneous until then.
 */
export function filterStateFor(
  state: GameState,
  viewerSeat: number | null
): GameState {
  const handOver = state.phase === "handEnded";
  return {
    ...state,
    seats: state.seats.map((s) => {
      if (s.seat === viewerSeat) return s; // you always see all of your own
      const hideCards = !s.revealed;       // holeCards + arrangement
      const hideDecls = !handOver;         // run/surrender declarations
      // NLHE seats carry neither DFT field, so this is a pure holeCards
      // strip for them (arrangement/declarations stay undefined).
      if (!hideCards && !hideDecls) return s;
      const next = { ...s };
      if (hideCards) {
        next.holeCards = null;
        if (s.arrangement !== undefined) next.arrangement = null;
      }
      if (hideDecls && s.declarations !== undefined) {
        next.declarations = undefined;
      }
      return next;
    }),
  };
}
