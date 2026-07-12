// ============================================================
// DFT cards — the Card <-> pokersolver-string bijection and deck
// primitives. Pure, UI-free, no poker-ts. Reuses the shared Card
// type so the engine speaks one card language everywhere.
// ============================================================

import type { Card } from "../types";

export const RANKS: readonly Card["rank"][] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A",
] as const;
export const SUITS: readonly Card["suit"][] = [
  "clubs", "diamonds", "hearts", "spades",
] as const;

// pokersolver wants strings like "Th", "Ad": rank char + suit letter,
// ten as "T" (NOT "10"). Our rank is already the right char.
const SUIT_TO_LETTER: Record<Card["suit"], string> = {
  clubs: "c", diamonds: "d", hearts: "h", spades: "s",
};
const LETTER_TO_SUIT: Record<string, Card["suit"]> = {
  c: "clubs", d: "diamonds", h: "hearts", s: "spades",
};

export function cardToStr(c: Card): string {
  return c.rank + SUIT_TO_LETTER[c.suit];
}

export function strToCard(s: string): Card {
  const rank = s[0] as Card["rank"];
  const suit = LETTER_TO_SUIT[s[1]];
  if (!suit || !RANKS.includes(rank)) throw new Error(`bad card string: "${s}"`);
  return { rank, suit };
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** A fresh, ordered 52-card deck (unshuffled). */
export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) d.push({ rank, suit });
  return d;
}
