// ============================================================
// PER-PLAYER STATE FILTER — the anti-cheat seam.
//
// The engine's GameState contains EVERYONE's hole cards (that's
// correct: the engine is the source of truth and, in hot-seat
// mode, the one screen legitimately sees all). The server calls
// this before sending state to each client so that a player's
// wire traffic NEVER contains another player's un-revealed cards.
//
// Kept as a pure function in its own file so test-filter.ts can
// hammer it directly, without a websocket in the loop.
// ============================================================

import type { GameState } from "../shared/engine/types";

/**
 * Return a copy of `state` as seen by `viewerSeat`
 * (null = spectator: sees no hidden cards at all).
 *
 * A seat keeps its holeCards only if it IS the viewer, or the
 * engine marked it `revealed` (showdown or voluntary show — the
 * engine already owns that rule; we never re-derive it here).
 */
export function filterStateFor(
  state: GameState,
  viewerSeat: number | null
): GameState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.seat === viewerSeat || s.revealed ? s : { ...s, holeCards: null }
    ),
  };
}
