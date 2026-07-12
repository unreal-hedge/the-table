// ============================================================
// DFT deck — seeded, injectable RNG + shuffle + a draw-from-top deck.
//
// HARD RULE (Parth): never Math.random. Every shuffle and every Tex
// flip must be reproducible from a seed, so a failing test replays
// exactly. The RNG is passed in; nothing in here reaches for global
// randomness.
// ============================================================

import type { Card } from "../types";
import { fullDeck, sameCard } from "./cards";

/** mulberry32 — a tiny deterministic PRNG. Same seed -> same stream,
 *  forever. Good enough for dealing/flips (not cryptographic). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with the injected rng. Returns a new array; input untouched. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** A deck you draw from the top. Constructed already shuffled. */
export class Deck {
  private cards: Card[];
  private idx = 0;

  constructor(rng: () => number, cards: Card[] = fullDeck()) {
    this.cards = shuffle(cards, rng);
  }

  draw(n = 1): Card[] {
    if (this.idx + n > this.cards.length) {
      throw new Error(
        `deck exhausted: need ${n}, have ${this.cards.length - this.idx}`
      );
    }
    const out = this.cards.slice(this.idx, this.idx + n);
    this.idx += n;
    return out;
  }

  /** Burn = draw and discard. Spec keeps burns; digitally they only
   *  advance the deck, but we honor the ritual for fidelity. */
  burn(n = 1): void {
    this.draw(n);
  }

  get remaining(): number {
    return this.cards.length - this.idx;
  }
}

/** A fresh 52-card deck minus `exclude` (the flip participants' cards),
 *  shuffled with `rng`. For Tex flips: spec says a fresh deck minus the
 *  cards held by the players in the flip. */
export function freshDeckMinus(exclude: readonly Card[], rng: () => number): Deck {
  const remaining = fullDeck().filter((c) => !exclude.some((e) => sameCard(e, c)));
  return new Deck(rng, remaining);
}
