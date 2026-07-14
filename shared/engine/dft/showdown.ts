// ============================================================
// DFT showdown — the flip / surrender / board-winner resolver.
// Pure given a seeded RNG. No poker-ts, no UI.
//
// Two-phase so the manager can interleave interactivity:
//   prepareShowdown()  runs the intermediate REPRESENTATION flips (chops ->
//                      one representative each) and returns the contests plus
//                      exactly which seats MAY surrender.
//   finalizeShowdown() applies the collected blind decisions + the final flips.
// resolveShowdown() chains both for the headless tests.
//
// The seven places a bug hides (Parth + Kabir's rulings), all enforced here:
//  1. Board winners are computed PER POT, on that pot's eligible set only.
//  2. Surrender is UNAVAILABLE in a 3+ representation flip (all must run).
//  3. Run/surrender are blind + simultaneous — the resolver only READS them;
//     it never lets one seat's decision or cards inform another's.
//  4. The final flip is ALWAYS exactly heads-up (2 board representatives).
//  5. Winning both boards = 100%: no flip, no decision.
//  6. Guaranteed-50%: the banked 50% is irrevocable; a SINGLE representation
//     flip decides the other 50%; there is NO subsequent final flip.
//  7. TIE RESOLUTION (Kabir's ruling, final): any flip that ties splits the
//     contested amount evenly among that flip's tied winners, IMMEDIATELY —
//     no re-runs, and seat position NEVER decides chips. This holds for every
//     flip type. A final/gtd flip that ties just splits its stake. A
//     representation flip that ties crowns no single champion, so that board
//     produces no representative for a final flip; instead each board's 50%
//     is split among that board's tied reps (a `boardSplit` — see below).
//
// Surrender eligibility (E2, Kabir's ruling, final): a participant may
// surrender iff they already own >= half the pot AND the flip is the final,
// heads-up (2-player) resolution. A challenger who owns nothing must run.
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
export type DecisionFor = (potIndex: number, seat: number) => Decision;
export type SeatDelta = Map<number, number>; // seat -> chips won (>= 0)

type Side = { outright: number } | { chop: number[] };

export type PotPlan =
  | { kind: "whole"; potIndex: number; amount: number; winner: number }
  | { kind: "final"; potIndex: number; amount: number; sideA: Side; sideB: Side }
  | { kind: "guaranteed"; potIndex: number; amount: number; banker: number; chop: number[] };

/** A pot after its representation flips are resolved — ready for the blind
 *  decision phase and the final flip. `decisionSeatsOf` says who may surrender. */
export type PreparedContest =
  | { kind: "whole"; potIndex: number; amount: number; winner: number }
  | { kind: "headsup"; potIndex: number; amount: number; a: number; b: number }
  | { kind: "gtdHeadsUp"; potIndex: number; amount: number; banker: number; other: number }
  | { kind: "gtdMulti"; potIndex: number; amount: number; banker: number; chop: number[] }
  // A representation flip tied, so neither/one board crowned a single rep.
  // No final flip, no run/surrender: each board's half is split among its
  // tied reps (repsA/repsB — length 1 for an outright/clean-flip side,
  // length >1 for a tied representation flip). (Ruling #7)
  | { kind: "boardSplit"; potIndex: number; amount: number; repsA: number[]; repsB: number[] };

// ---------- board winners + classification ----------

function boardWinners(
  eligible: number[],
  arrangements: Map<number, Arrangement>,
  board: Card[],
  which: "handA" | "handB"
): number[] {
  const evals = eligible.map((seat) => bestHand(arrangements.get(seat)![which], board));
  return winnerIndices(evals).map((i) => eligible[i]);
}

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
      if (winA[0] === winB[0]) plans.push({ kind: "whole", potIndex, amount: pot.amount, winner: winA[0] }); // #5
      else plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { outright: winA[0] }, sideB: { outright: winB[0] } });
    } else if (aOut && !bOut) {
      const x = winA[0];
      if (winB.includes(x)) plans.push({ kind: "guaranteed", potIndex, amount: pot.amount, banker: x, chop: winB }); // #6
      else plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { outright: x }, sideB: { chop: winB } });
    } else if (!aOut && bOut) {
      const y = winB[0];
      if (winA.includes(y)) plans.push({ kind: "guaranteed", potIndex, amount: pot.amount, banker: y, chop: winA });
      else plans.push({ kind: "final", potIndex, amount: pot.amount, sideA: { chop: winA }, sideB: { outright: y } });
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

export function flip(
  hands: { seat: number; tex: [Card, Card] }[],
  rng: () => number
): FlipResult {
  const known = hands.flatMap((h) => h.tex);
  const board = freshDeckMinus(known, rng).draw(5);
  const evals = hands.map((h) => bestHand(h.tex, board));
  return { board, winners: winnerIndices(evals).map((i) => hands[i].seat) };
}

/** Representation flip -> the tied winner set (length 1 = a clean champion,
 *  length >1 = a tie). ONE flip only: no re-runs, no seat-based fallback —
 *  a tie is resolved downstream by splitting the board's half (ruling #7). */
function repFlipWinners(chop: number[], arrangements: Map<number, Arrangement>, rng: () => number): number[] {
  return flip(chop.map((seat) => texOf(seat, arrangements)), rng).winners;
}

/** The seat(s) representing one board: the outright winner, or the tied
 *  winners of that board's representation flip. */
function resolveSide(side: Side, arrangements: Map<number, Arrangement>, rng: () => number): number[] {
  return "outright" in side ? [side.outright] : repFlipWinners(side.chop, arrangements, rng);
}

// ---------- prepare / finalize ----------

export function decisionSeatsOf(c: PreparedContest): number[] {
  if (c.kind === "headsup") return [c.a, c.b];
  if (c.kind === "gtdHeadsUp") return [c.banker];
  return [];
}

/** Phase 1: resolve every pot's representation flips, so who-may-surrender is
 *  known. Consumes rng for the rep flips only. */
export function prepareShowdown(
  pots: SidePot[],
  arrangements: Map<number, Arrangement>,
  boards: Boards,
  rng: () => number
): PreparedContest[] {
  return planShowdown(pots, arrangements, boards).map((plan): PreparedContest => {
    if (plan.kind === "whole") return { kind: "whole", potIndex: plan.potIndex, amount: plan.amount, winner: plan.winner };
    if (plan.kind === "guaranteed") {
      if (plan.chop.length === 2) {
        const other = plan.chop.find((s) => s !== plan.banker)!;
        return { kind: "gtdHeadsUp", potIndex: plan.potIndex, amount: plan.amount, banker: plan.banker, other };
      }
      return { kind: "gtdMulti", potIndex: plan.potIndex, amount: plan.amount, banker: plan.banker, chop: plan.chop };
    }
    const repsA = resolveSide(plan.sideA, arrangements, rng);
    const repsB = resolveSide(plan.sideB, arrangements, rng);
    // Only a clean single-rep-per-board result yields the heads-up final flip.
    // If either representation flip tied, no champion is crowned for that board
    // (ruling #7) — each board's half is split among its tied reps instead.
    if (repsA.length === 1 && repsB.length === 1) {
      const a = repsA[0], b = repsB[0];
      if (a === b) return { kind: "whole", potIndex: plan.potIndex, amount: plan.amount, winner: a };
      return { kind: "headsup", potIndex: plan.potIndex, amount: plan.amount, a, b };
    }
    return { kind: "boardSplit", potIndex: plan.potIndex, amount: plan.amount, repsA, repsB };
  });
}

/** Phase 2: apply the blind decisions + final flips. Consumes rng for flips. */
export function finalizeShowdown(
  prepared: PreparedContest[],
  decisions: Map<string, Decision>,
  arrangements: Map<number, Arrangement>,
  rng: () => number
): SeatDelta {
  const delta: SeatDelta = new Map();
  const add = (seat: number, amt: number) => {
    if (amt < 0) throw new Error("negative award");
    delta.set(seat, (delta.get(seat) ?? 0) + amt);
  };
  const dec = (pot: number, seat: number): Decision => decisions.get(`${pot}:${seat}`) ?? "run";

  for (const c of prepared) {
    if (c.kind === "whole") {
      add(c.winner, c.amount);
    } else if (c.kind === "headsup") {
      const da = dec(c.potIndex, c.a);
      const db = dec(c.potIndex, c.b);
      if (da === "surrender" && db === "surrender") splitAmong([c.a, c.b], c.amount, add);
      else if (da === "run" && db === "surrender") payRunSurrender(c.a, c.b, c.amount, add);
      else if (da === "surrender" && db === "run") payRunSurrender(c.b, c.a, c.amount, add);
      else splitAmong(flip([texOf(c.a, arrangements), texOf(c.b, arrangements)], rng).winners, c.amount, add);
    } else if (c.kind === "gtdHeadsUp") {
      const banked = Math.floor(c.amount / 2);
      const contested = c.amount - banked;
      add(c.banker, banked);
      if (dec(c.potIndex, c.banker) === "surrender") payRunSurrender(c.other, c.banker, contested, add);
      else splitAmong(flip([texOf(c.banker, arrangements), texOf(c.other, arrangements)], rng).winners, contested, add);
    } else if (c.kind === "gtdMulti") {
      const banked = Math.floor(c.amount / 2);
      const contested = c.amount - banked;
      add(c.banker, banked);
      // ONE flip; a tie splits the contested half among the tied winners (#7).
      const winners = flip(c.chop.map((s) => texOf(s, arrangements)), rng).winners;
      splitAmong(winners, contested, add);
    } else {
      // boardSplit: a representation flip tied, so no final flip happens.
      // Each board's half goes to that board's tied reps (ruling #7). A seat
      // that shares both boards' reps is paid from both halves.
      const halfA = Math.floor(c.amount / 2);
      const halfB = c.amount - halfA;
      splitAmong(c.repsA, halfA, add);
      splitAmong(c.repsB, halfB, add);
    }
  }
  return delta;
}

/** Chain both phases; the headless path with an on-demand decision callback. */
export function resolveShowdown(
  pots: SidePot[],
  arrangements: Map<number, Arrangement>,
  boards: Boards,
  decisionFor: DecisionFor,
  rng: () => number
): SeatDelta {
  const prepared = prepareShowdown(pots, arrangements, boards, rng);
  const decisions = new Map<string, Decision>();
  for (const c of prepared) {
    for (const seat of decisionSeatsOf(c)) decisions.set(`${c.potIndex}:${seat}`, decisionFor(c.potIndex, seat));
  }
  return finalizeShowdown(prepared, decisions, arrangements, rng);
}

// ---------- helpers ----------

function splitAmong(seats: number[], amount: number, add: (s: number, a: number) => void): void {
  const ordered = [...seats].sort((a, b) => a - b);
  const base = Math.floor(amount / ordered.length);
  let remainder = amount - base * ordered.length;
  for (const s of ordered) {
    add(s, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
}

function payRunSurrender(runner: number, surrenderer: number, amount: number, add: (s: number, a: number) => void): void {
  const surrShare = Math.floor(amount * 0.3);
  add(surrenderer, surrShare);
  add(runner, amount - surrShare); // 70% (+ any rounding chip)
}

function texOf(seat: number, arrangements: Map<number, Arrangement>): { seat: number; tex: [Card, Card] } {
  return { seat, tex: arrangements.get(seat)!.tex };
}
