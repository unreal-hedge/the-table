// ============================================================
// DFT invariant test — chip conservation, the same rigour as
// test-engine.ts but for the Double Flop Tex engine.
//
// STEP 3 scope: the ante + three betting rounds ONLY (no showdown
// exists yet). The invariant, asserted after EVERY action:
//     sum(stacks) + sum(pots) == total bought in
// and side pots sum exactly to the pot, with no folded player ever
// eligible. Randomness is seeded (mulberry32) so any failing hand
// replays exactly from its printed seed.
// (Step 5 extends this file with the showdown + the required edge
// cases.)
// ============================================================

import { makeRng } from "./shared/engine/dft/deck";
import { DftBetting, type LegalBet, type SeatStack } from "./shared/engine/dft/betting";

const ANTE = 200;
const MIN_BET = 200;
const INCREMENT = 50;
const MAX_DFT_SEATS = 6; // one 52-card deck can't deal 6 hole cards to more

let failures = 0;
function fail(msg: string): never {
  failures++;
  throw new Error(msg);
}

function pickAmount(legal: LegalBet, rng: () => number): number {
  if (legal.maxRaiseTo <= legal.minRaiseTo) return legal.maxRaiseTo;
  if (rng() < 0.3) return legal.maxRaiseTo; // go all-in sometimes
  const steps = Math.floor((legal.maxRaiseTo - legal.minRaiseTo) / INCREMENT);
  const target = legal.minRaiseTo + Math.floor(rng() * (steps + 1)) * INCREMENT;
  return Math.min(target, legal.maxRaiseTo);
}

/** Build a random table: 2..MAX seats, arbitrary stacks (sometimes below the
 *  ante, to force all-in-for-ante and the side pots that follow). */
function randomTable(rng: () => number): { seats: SeatStack[]; button: number; total: number } {
  const n = 2 + Math.floor(rng() * (MAX_DFT_SEATS - 1));
  const allSeats = [0, 1, 2, 3, 4, 5, 6, 7];
  // choose n distinct seats
  const chosen: number[] = [];
  const pool = [...allSeats];
  for (let i = 0; i < n; i++) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const seats: SeatStack[] = chosen.map((seat) => {
    const stack = rng() < 0.2 ? 1 + Math.floor(rng() * 199) : 200 + Math.floor(rng() * 5000);
    return { seat, stack };
  });
  const total = seats.reduce((a, s) => a + s.stack, 0);
  const button = chosen[Math.floor(rng() * chosen.length)];
  return { seats, button, total };
}

function assertConservation(b: DftBetting, seats: SeatStack[], total: number, seed: number, step: number) {
  let sumStacks = 0;
  let sumContrib = 0;
  for (const s of seats) {
    const stack = b.stackOf(s.seat);
    const contrib = b.contributedOf(s.seat);
    if (stack < 0) fail(`seed ${seed} step ${step}: seat ${s.seat} negative stack ${stack}`);
    if (contrib < 0) fail(`seed ${seed} step ${step}: seat ${s.seat} negative contribution ${contrib}`);
    if (stack + contrib !== s.stack) {
      fail(`seed ${seed} step ${step}: seat ${s.seat} stack+contrib ${stack + contrib} != buyIn ${s.stack}`);
    }
    sumStacks += stack;
    sumContrib += contrib;
  }
  if (sumStacks + sumContrib !== total) {
    fail(`seed ${seed} step ${step}: sum(stacks)=${sumStacks} + pot=${sumContrib} != total ${total}`);
  }
  if (b.totalPot() !== sumContrib) {
    fail(`seed ${seed} step ${step}: totalPot ${b.totalPot()} != sum(contrib) ${sumContrib}`);
  }
}

function runBettingHand(seed: number): { actions: number } {
  const rng = makeRng(seed);
  const { seats, button, total } = randomTable(rng);
  const b = new DftBetting(seats, button, { ante: ANTE, minBet: MIN_BET, increment: INCREMENT });

  let step = 0;
  assertConservation(b, seats, total, seed, step); // after antes

  let guard = 0;
  while (!b.isComplete()) {
    if (++guard > 2000) fail(`seed ${seed}: betting did not terminate (${guard} steps)`);
    if (b.status() === "roundComplete") {
      b.beginNextRound();
      continue;
    }
    const legal = b.legal();
    if (legal.actions.length === 0) fail(`seed ${seed} step ${step}: awaiting but no legal actions`);
    // non-all-in bets/raises must be clean 50-steps at or above the minimum
    for (const a of legal.actions) {
      if ((a === "bet" || a === "raise") && legal.minRaiseTo !== legal.maxRaiseTo) {
        if (legal.minRaiseTo % INCREMENT !== 0) fail(`seed ${seed}: minRaiseTo ${legal.minRaiseTo} not a 50-step`);
      }
    }
    const choice = legal.actions[Math.floor(rng() * legal.actions.length)];
    const amount = choice === "bet" || choice === "raise" ? pickAmount(legal, rng) : undefined;
    b.act(choice, amount);
    step++;
    assertConservation(b, seats, total, seed, step);
  }

  // side pots must sum to the pot, and no folded seat may be eligible
  const pots = b.sidePots();
  const potSum = pots.reduce((a, p) => a + p.amount, 0);
  if (potSum !== b.totalPot()) fail(`seed ${seed}: side pots ${potSum} != pot ${b.totalPot()}`);
  for (const p of pots) {
    for (const seat of p.eligibleSeats) {
      if (b.isFolded(seat)) fail(`seed ${seed}: folded seat ${seat} is eligible for a pot`);
    }
  }
  // a hand won by folds has exactly one non-folded seat
  const wf = b.winnerByFold();
  if (wf !== null && b.isFolded(wf)) fail(`seed ${seed}: fold-winner ${wf} is folded`);

  return { actions: step };
}

function main() {
  const HANDS = 500;
  let totalActions = 0;
  let foldWins = 0;
  for (let i = 0; i < HANDS; i++) {
    const seed = 1000 + i * 7919; // spread seeds; deterministic across runs
    const r = runBettingHand(seed);
    totalActions += r.actions;
  }
  console.log(`betting hands played: ${HANDS}`);
  console.log(`total actions: ${totalActions}`);
  console.log(failures === 0
    ? "STEP 3 (BETTING) CONSERVATION PASS ✅"
    : `STEP 3 CONSERVATION FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
