// ============================================================
// handLabel — friendly, live hand names for the UI (readability 2.3).
//
// "Pair of Kings", "Flush, Queen high", "Two Pair, Aces and Kings" —
// computed from pokersolver via the DFT engine's own evaluator, so the
// name the player reads is the same evaluation the showdown uses.
//
// LANDMINE: pokersolver's rank scale is ITS OWN. Nothing here ever goes
// through handNames.ts (poker-ts's scale). We read pokersolver's `name`
// + its ordered best-five `cards` and build the words ourselves.
// pokersolver also calls a royal flush "Straight Flush" (descr "Royal
// Flush") — handled below.
// ============================================================

import type { Card } from "@/engine/types";
import { bestHand } from "@/engine/dft/eval";

export interface HandLabel {
  name: string;      // "Two Pair, Aces and Kings"
  category: string;  // pokersolver's family name: "Two Pair" — a short label for tight spaces
  rank: number;      // pokersolver's rank (its own scale — compare only with other HandLabels)
  used: Card[];      // the exact five cards that make the hand (board + hole), best first
}

const PLURAL: Record<Card["rank"], string> = {
  A: "Aces", K: "Kings", Q: "Queens", J: "Jacks", T: "Tens", "9": "Nines", "8": "Eights",
  "7": "Sevens", "6": "Sixes", "5": "Fives", "4": "Fours", "3": "Threes", "2": "Twos",
};
const SINGULAR: Record<Card["rank"], string> = {
  A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten", "9": "Nine", "8": "Eight",
  "7": "Seven", "6": "Six", "5": "Five", "4": "Four", "3": "Three", "2": "Two",
};
const LETTER_TO_SUIT: Record<string, Card["suit"]> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };

/** pokersolver Card -> our Card. A wheel's ace is re-valued to "1" internally. */
function toCard(c: { value: string; suit: string }): Card {
  const v = c.value === "1" ? "A" : c.value === "10" ? "T" : c.value;
  return { rank: v as Card["rank"], suit: LETTER_TO_SUIT[c.suit] ?? "spades" };
}

/** Best five from `hole` + `board`, named. Null until at least 5 cards exist. */
export function labelHand(hole: readonly Card[], board: readonly Card[]): HandLabel | null {
  if (hole.length + board.length < 5) return null;
  const ev = bestHand(hole, board);
  const used = (ev.solved.cards as { value: string; suit: string }[]).map(toCard);
  const r = (i: number): Card["rank"] => used[i]?.rank ?? "2";
  let name: string;
  switch (ev.name) {
    case "Straight Flush":
      name = ev.descr === "Royal Flush" ? "Royal Flush" : `Straight Flush, ${SINGULAR[r(0)]} high`;
      break;
    case "Four of a Kind": name = `Four of a Kind, ${PLURAL[r(0)]}`; break;
    case "Full House": name = `Full House, ${PLURAL[r(0)]} full of ${PLURAL[r(3)]}`; break;
    case "Flush": name = `Flush, ${SINGULAR[r(0)]} high`; break;
    case "Straight": name = `Straight, ${SINGULAR[r(0)]} high`; break;
    case "Three of a Kind": name = `Three of a Kind, ${PLURAL[r(0)]}`; break;
    case "Two Pair": name = `Two Pair, ${PLURAL[r(0)]} and ${PLURAL[r(2)]}`; break;
    case "Pair": name = `Pair of ${PLURAL[r(0)]}`; break;
    default: name = `${SINGULAR[r(0)]} high`;
  }
  return { name, category: ev.name === "Straight Flush" && ev.descr === "Royal Flush" ? "Royal Flush" : ev.name, rank: ev.rank, used };
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** Is `c` one of the five that made the hand? */
export function isUsed(label: HandLabel | null, c: Card): boolean {
  return !!label && label.used.some((u) => sameCard(u, c));
}
