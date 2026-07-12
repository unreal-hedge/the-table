// ============================================================
// DFT showdown — the flip / surrender / board-winner resolver.
// Pure given a seeded RNG + a decision callback. No poker-ts, no UI.
//
// The six places a bug hides (Parth), all enforced here:
//  1. Board winners are computed PER POT, on that pot's eligible set only.
//  2. Surrender is UNAVAILABLE in a 3+ representation flip (all must run).
//  3. Run/surrender are blind + simultaneous — the manager collects them
//     without leaking; this resolver only reads them via `decisionFor`.
//  4. The final flip is ALWAYS exactly heads-up (2 board representatives).
//  5. Winning both boards = 100%: no flip, no decision.
//  6. Guaranteed-50%: the banked 50% is irrevocable; a SINGLE representation
//     flip decides the other 50%; there is NO subsequent final flip.
//
// Unifying surrender rule (derived from "surrender requires owning half the
// pot"): a participant may surrender iff they already own >= half the pot AND
// the flip is the final, heads-up (2-player) resolution. Everyone else runs.
// ============================================================

import type { Card } from "../types";
import { bestHand, winnerIndices } from "./eval";
import { freshDeckMinus } from "./deck";
import type { SidePot } from "./betting";

export interface Arrangement {
  handA: [Card, Card]; // plays Board A
  handB: [Card, Card]; // plays Board B
  tex: [Card, Card]; // flip hand (heads-up / representation flips only)
}
export interface Boards {
  a: Card[]; // Board A: 5 cards (flop A + turn A + river A)
  b: Card[]; // Board B: 5 cards
}
export type Decision = "run" | "surrender";
/** Supplies a blind run/surrender decision for a seat that MAY surrender. The
 *  resolver only ever calls this for seats that own >= half the pot at a final
 *  heads-up flip; everyone else is forced to run and is never asked. */
export type DecisionFor = (potIndex: number, seat: number) => Decision;

export type SeatDelta = Map<number, number>; // seat -> chips won (>= 0)

type Side = { outright: number } | { chop: number[] };

export type PotPlan =
  | { kind: "whole"; potIndex: number; amount: number; winner: number }
  | { kind: "final"; potIndex: number; amount: number; sideA: Side; sideB: Side }
  | { kind: "guaranteed"; potIndex: number; amount: number; banker: number; chop: number[] };

// ---------- board winners ----------

function boardWinners(
  eligible: number[],
  arrangements: Map<number, Arrangement>,
  board: Card[],
  which: "handA" | "handB"
): number[] {
  const evals = eligible.map((seat) => bestHand(arrangements.get(seat)![which], board));
  return winnerIndices(evals).map((i) => eligible[i]);
}

/** Classify every pot into its resolution branch. Pure. */
export function planShowdown(
  pots: SidePot[],
  arrangements: Map<number, Arrangement>,
  boards: Boards
): PotPlan[] {
  const plans: PotPlan[] = [];
  pots.forEach((pot, potIndex) => {
    const E = pot.eligibleSeats;
    if (E.length === 0) throw new Error(`pot ${potIndex} has no eligible players`);
    if (E.length === 1) {
      plans.push({ kind: "whole", potIndex, amount: pot.amount, winner: E[0] });
      return;
    }
    const winA = boardWinners(E, arrangements, boards.a, "handA");
    const winB = boardWinners(E, arrangements, boards.b, "handB");
    const aOut = winA.length === 1;
    const bOut = winB.length === 1;

    if (aOut && bOut) {
      if (winA[0] === winB[0]) {
        plans.push({ kind: "whole", potIndex, amount: pot.amount, winner: winA[0] }); // #5
      } else {
        plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { outright: winA[0] }, sideB: { outright: winB[0] } });
      }
    } else if (aOut && !bOut) {
      const x = winA[0];
      if (winB.includes(x)) {
        plans.push({ kind: "guaranteed", potIndex, amount: pot.amount, banker: x, chop: winB }); // #6
      } else {
        plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { outright: x }, sideB: { chop: winB } });
      }
    } else if (!aOut && bOut) {
      const y = winB[0];
      if (winA.includes(y)) {
        plans.push({ kind: "guaranteed", potIndex, amount: pot.amount, banker: y, chop: winA });
      } else {
        plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { chop: winA }, sideB: { outright: y } });
      }
    } else {
      plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { chop: winA }, sideB: { chop: winB } });
    }
  });
  return plans;
}

// ---------- flips ----------

export interface FlipResult {
  board: Card[];
  winners: number[]; // seats; >1 == tie
}

/** A heads-up or multi-way Tex flip: fresh 52-deck minus participants' tex
 *  cards, a fresh 5-card board, best hand wins. */
export function flip(
  hands: { seat: number; tex: [Card, Card] }[],
  rng: () => number
): FlipResult {
  const known = hands.flatMap((h) => h.tex);
  const board = freshDeckMinus(known, rng).draw(5);
  const evals = hands.map((h) => bestHand(h.tex, board));
  return { board, winners: winnerIndices(evals).map((i) => hands[i].seat) };
}

/** Representation flip -> exactly one representative. Re-flips on the (rare)
 *  tie so we never carry 3 players into a final flip; deterministic fallback
 *  after 8 straight ties. */
function repFlip(chop: number[], arrangements: Map<number, Arrangement>, rng: () => number): number {
  const hands = chop.map((seat) => ({ seat, tex: arrangements.get(seat)!.tex }));
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = flip(hands, rng);
    if (r.winners.length === 1) return r.winners[0];
  }
  return Math.min(...chop);
}

// ---------- settlement ----------

function splitAmong(seats: number[], amount: number, add: (s: number, a: number) => void): void {
  const ordered = [...seats].sort((a, b) => a - b);
  const base = Math.floor(amount / ordered.length);
  let remainder = amount - base * ordered.length;
  for (const s of ordered) {
    add(s, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
}

function resolveSide(side: Side, arrangements: Map<number, Arrangement>, rng: () => number): number {
  return "outright" in side ? side.outright : repFlip(side.chop, arrangements, rng);
}

/** Final heads-up flip between two half-owners, staking `amount` (100%). Both
 *  may surrender. */
function settleFinalFlip(
  potIndex: number,
  amount: number,
  x: number,
  y: number,
  arrangements: Map<number, Arrangement>,
  decisionFor: DecisionFor,
  rng: () => number,
  add: (s: number, a: number) => void
): void {
  const dx = decisionFor(potIndex, x);
  const dy = decisionFor(potIndex, y);
  if (dx === "surrender" && dy === "surrender") {
    splitAmong([x, y], amount, add); // 50/50
  } else if (dx === "run" && dy === "surrender") {
    payRunSurrender(x, y, amount, add);
  } else if (dx === "surrender" && dy === "run") {
    payRunSurrender(y, x, amount, add);
  } else {
    const r = flip([texOf(x, arrangements), texOf(y, arrangements)], rng);
    splitAmong(r.winners, amount, add); // 1 winner takes all; tie -> 50/50
  }
}

function payRunSurrender(runner: number, surrenderer: number, amount: number, add: (s: number, a: number) => void): void {
  const surrShare = Math.floor(amount * 0.3);
  add(surrenderer, surrShare);
  add(runner, amount - surrShare); // runner gets 70% (+ any rounding chip)
}

function texOf(seat: number, arrangements: Map<number, Arrangement>): { seat: number; tex: [Card, Card] } {
  return { seat, tex: arrangements.get(seat)!.tex };
}

function settlePot(
  plan: PotPlan,
  arrangements: Map<number, Arrangement>,
  decisionFor: DecisionFor,
  rng: () => number,
  add: (s: number, a: number) => void
): void {
  if (plan.kind === "whole") {
    add(plan.winner, plan.amount);
    return;
  }
  if (plan.kind === "final") {
    const repA = resolveSide(plan.sideA, arrangements, rng);
    const repB = resolveSide(plan.sideB, arrangements, rng);
    if (repA === repB) {
      add(repA, plan.amount); // one player represented both boards -> whole pot
      return;
    }
    settleFinalFlip(plan.potIndex, plan.amount, repA, repB, arrangements, decisionFor, rng, add);
    return;
  }
  // guaranteed-50%: banker keeps half no matter what; the other half is the
  // single representation flip among `chop` (which includes the banker).
  const banked = Math.floor(plan.amount / 2);
  const contested = plan.amount - banked;
  add(plan.banker, banked);
  if (plan.chop.length === 2) {
    // heads-up: banker owns a half -> may surrender; challenger must run.
    const other = plan.chop.find((s) => s !== plan.banker)!;
    const d = decisionFor(plan.potIndex, plan.banker);
    if (d === "surrender") {
      // banker surrenders on the contested half only: banker 30%, runner 70%.
      payRunSurrender(other, plan.banker, contested, add);
    } else {
      const r = flip([texOf(plan.banker, arrangements), texOf(other, arrangements)], rng);
      splitAmong(r.winners, contested, add);
    }
  } else {
    // 3+ representation flip: no surrender, everyone runs.
    const hands = plan.chop.map((s) => texOf(s, arrangements));
    let r = flip(hands, rng);
    for (let attempt = 0; attempt < 7 && r.winners.length > 1; attempt++) r = flip(hands, rng);
    splitAmong(r.winners, contested, add);
  }
}

/** Full showdown: plan every pot, then settle each. Returns per-seat chip
 *  deltas (all >= 0) whose total equals the total in all pots. */
export function resolveShowdown(
  pots: SidePot[],
  arrangements: Map<number, Arrangement>,
  boards: Boards,
  decisionFor: DecisionFor,
  rng: () => number
): SeatDelta {
  const delta: SeatDelta = new Map();
  const add = (seat: number, amt: number) => {
    if (amt < 0) throw new Error("negative award");
    delta.set(seat, (delta.get(seat) ?? 0) + amt);
  };
  const plans = planShowdown(pots, arrangements, boards);
  for (const plan of plans) settlePot(plan, arrangements, decisionFor, rng, add);
  return delta;
}
