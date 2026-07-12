// ============================================================
// DFT hand evaluation — a thin wrapper over pokersolver.
//
// pokersolver.solve() takes up to 7 cards and returns the best 5-card
// hand, so "playing the board" (using 2, 1, or 0 hole cards) is handled
// for free. Its rank scale is ITS OWN (flush = 6, not poker-ts's 5) — we
// never route it through handNames.ts.
// ============================================================

import type { Card } from "../types";
import { cardToStr } from "./cards";
import pokersolver, { type SolvedHand } from "pokersolver";

const { Hand } = pokersolver;

export interface Evaluated {
  hole: Card[];
  board: Card[];
  rank: number; // pokersolver's own scale; higher = better
  name: string; // "Flush", "Straight Flush", …
  descr: string; // "Flush, Ace High"
  solved: SolvedHand; // kept for winners() reference comparison
}

/** Best 5-card Hold'em hand from a player's 2 hole cards + a 5-card board. */
export function bestHand(hole: readonly Card[], board: readonly Card[]): Evaluated {
  const solved = Hand.solve([...hole, ...board].map(cardToStr));
  return {
    hole: hole.slice(),
    board: board.slice(),
    rank: solved.rank,
    name: solved.name,
    descr: solved.descr,
    solved,
  };
}

/** Indices of the winning hand(s) among the given evaluations. Ties
 *  (chops) return multiple indices. pokersolver.winners() returns the
 *  same object references passed in, so identity comparison is safe. */
export function winnerIndices(hands: readonly Evaluated[]): number[] {
  if (hands.length === 0) return [];
  if (hands.length === 1) return [0];
  const winning = Hand.winners(hands.map((h) => h.solved));
  const out: number[] = [];
  hands.forEach((h, i) => {
    if (winning.indexOf(h.solved) !== -1) out.push(i);
  });
  return out;
}
