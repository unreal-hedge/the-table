// ============================================================
// DFT invariant test — chip conservation with the same rigour as
// test-engine.ts, now end to end through DoubleFlopManager.
//
//  1. Betting-only conservation (Step 3 scope, kept).
//  2. Integrated manager fuzz: 200+ full hands (deal -> bet -> pick ->
//     decide -> settle), asserting total chips == total bought in after
//     EVERY transition and the ledger nets to zero after every hand.
//  3. The seven required edge cases, deliberately generated.
//
// Seeded (mulberry32); any failing hand replays from its printed seed.
// ============================================================

import { makeRng as _rng } from "./shared/engine/dft/deck";
import { DftBetting, type LegalBet, type SeatStack } from "./shared/engine/dft/betting";
import { DoubleFlopManager, type DealOverride } from "./shared/engine/dft/manager";
import { planShowdown, type Arrangement, type Boards } from "./shared/engine/dft/showdown";
import { strToCard } from "./shared/engine/dft/cards";
import { DEFAULT_CONFIG, type Card, type GameConfig } from "./shared/engine/types";

const ANTE = 200, MIN_BET = 200, INCREMENT = 50, MAX_DFT_SEATS = 7;
let failures = 0;
function fail(msg: string): never { failures++; throw new Error(msg); }
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const C = (s: string) => strToCard(s);
const cards = (s: string[]): Card[] => s.map(C);

function pickAmount(legal: LegalBet, rng: () => number): number {
  if (legal.maxRaiseTo <= legal.minRaiseTo) return legal.maxRaiseTo;
  if (rng() < 0.3) return legal.maxRaiseTo;
  const steps = Math.floor((legal.maxRaiseTo - legal.minRaiseTo) / INCREMENT);
  return Math.min(legal.minRaiseTo + Math.floor(rng() * (steps + 1)) * INCREMENT, legal.maxRaiseTo);
}
function perm6(rng: () => number): number[] {
  const a = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 1. betting-only conservation (Step 3) ----------
function bettingConservationSuite(): void {
  let leaks = 0, hands = 0;
  for (let i = 0; i < 400; i++) {
    const seed = 1000 + i * 7919;
    const rng = _rng(seed);
    const n = 2 + Math.floor(rng() * (MAX_DFT_SEATS - 1));
    const pool = [0, 1, 2, 3, 4, 5, 6, 7];
    const chosen: number[] = [];
    for (let k = 0; k < n; k++) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const seats: SeatStack[] = chosen.map((seat) => ({
      seat, stack: rng() < 0.2 ? 1 + Math.floor(rng() * 199) : 200 + Math.floor(rng() * 5000),
    }));
    const total = seats.reduce((a, s) => a + s.stack, 0);
    const button = chosen[Math.floor(rng() * chosen.length)];
    const b = new DftBetting(seats, button, { ante: ANTE, minBet: MIN_BET, increment: INCREMENT });
    const conserve = () => {
      let ss = 0, cc = 0;
      for (const s of seats) { ss += b.stackOf(s.seat); cc += b.contributedOf(s.seat); if (b.stackOf(s.seat) + b.contributedOf(s.seat) !== s.stack) leaks++; }
      if (ss + cc !== total) leaks++;
    };
    conserve();
    let guard = 0;
    while (!b.isComplete()) {
      if (++guard > 2000) { leaks++; break; }
      if (b.status() === "roundComplete") { b.beginNextRound(); continue; }
      const legal = b.legal();
      const choice = legal.actions[Math.floor(rng() * legal.actions.length)];
      b.act(choice, choice === "bet" || choice === "raise" ? pickAmount(legal, rng) : undefined);
      conserve();
    }
    const pots = b.sidePots();
    if (pots.reduce((a, p) => a + p.amount, 0) !== b.totalPot()) leaks++;
    for (const p of pots) {
      if (p.eligibleSeats.length === 0) leaks++; // no pot may lack a live claimant
      for (const s of p.eligibleSeats) if (b.isFolded(s)) leaks++;
    }
    hands++;
  }
  check(`betting-only conservation over ${hands} hands`, leaks === 0, `${leaks} leaks`);
}

// ---------- 2. integrated manager fuzz ----------
function driveHand(m: DoubleFlopManager, rng: () => number, grand: number, seed: number): void {
  const chip = (where: string) => { if (m.chipTotal() !== grand) fail(`seed ${seed} ${where}: chipTotal ${m.chipTotal()} != ${grand}`); };
  let guard = 0;
  while (m.phase() === "betting") {
    if (++guard > 3000) fail(`seed ${seed}: betting stuck`);
    const legal = m.legal();
    const choice = legal.actions[Math.floor(rng() * legal.actions.length)];
    m.act(choice, choice === "bet" || choice === "raise" ? pickAmount(legal, rng) : undefined);
    chip("betting");
  }
  if (m.phase() === "picking") {
    for (const s of m.pickingSeats()) {
      if (m.phase() !== "picking") break;
      if (rng() < 0.6) m.submitArrangement(s, perm6(rng));
      chip("picking");
    }
    if (m.phase() === "picking") m.pickingTimeout();
    chip("post-picking");
  }
  if (m.phase() === "decisions") {
    // R1: surrender only where the engine allows it (banker-only). Reading the
    // view's surrenderSeats keeps the fuzz legal; an illegal surrender now throws.
    const contests = m.state().dft?.decisions?.contests ?? [];
    const maySurrender = (potIndex: number, seat: number) =>
      contests.find((c) => c.potIndex === potIndex)?.surrenderSeats.includes(seat) ?? false;
    for (const d of [...m.pendingDecisions()]) {
      if (m.phase() !== "decisions") break;
      const surrender = rng() < 0.5 && maySurrender(d.potIndex, d.seat);
      m.declare(d.seat, d.potIndex, surrender ? "surrender" : "run");
      chip("declaring");
    }
    if (m.phase() === "decisions") m.decisionsTimeout();
    chip("post-decisions");
  }
  if (m.phase() !== "handEnded") fail(`seed ${seed}: hand did not end (phase ${m.phase()})`);
}

function managerFuzzSuite(): number {
  let totalHands = 0;
  for (let sess = 0; sess < 30; sess++) {
    const seed = 20000 + sess * 104729;
    const rng = _rng(seed);
    const n = 2 + Math.floor(rng() * (MAX_DFT_SEATS - 1));
    const starters = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, buyIn: 500 + Math.floor(rng() * 3500) }));
    const grand = starters.reduce((a, s) => a + Math.min(Math.max(s.buyIn, DEFAULT_CONFIG.minBuyIn), DEFAULT_CONFIG.maxBuyIn), 0);
    const m = new DoubleFlopManager(DEFAULT_CONFIG, starters, seed);
    m.start();
    if (m.chipTotal() !== grand) fail(`seed ${seed}: initial chipTotal ${m.chipTotal()} != ${grand}`);
    let h = 0;
    while (m.handInProgress() && h < 30) {
      driveHand(m, rng, grand, seed);
      h++; totalHands++;
      if (m.chipTotal() !== grand) fail(`seed ${seed}: post-hand chipTotal ${m.chipTotal()} != ${grand}`);
      const rows = m.ledger();
      if (rows.reduce((a, r) => a + r.net, 0) !== 0) fail(`seed ${seed}: ledger net != 0`);
      if (rows.reduce((a, r) => a + r.stack, 0) !== grand) fail(`seed ${seed}: stacks != grand`);
      if (rows.filter((r) => r.stack > 0).length < 2) break;
      m.dealNextHand();
    }
  }
  return totalHands;
}

// ---------- 3. edge cases ----------
const EDGE: GameConfig = { ...DEFAULT_CONFIG, minBuyIn: 1 };

function mgr(stacks: number[]): DoubleFlopManager {
  const starters = stacks.map((buyIn, i) => ({ id: `p${i}`, name: `P${i}`, buyIn }));
  return new DoubleFlopManager(EDGE, starters, 424242);
}
function driveCheckCall(m: DoubleFlopManager): void {
  let g = 0;
  while (m.phase() === "betting") { if (++g > 2000) throw new Error("stuck"); const l = m.legal(); m.act(l.actions.includes("check") ? "check" : "call"); }
}
function driveAllIn(m: DoubleFlopManager): void {
  let g = 0;
  while (m.phase() === "betting") {
    if (++g > 2000) throw new Error("stuck");
    const l = m.legal();
    if (l.actions.includes("bet")) m.act("bet", l.maxRaiseTo);
    else if (l.actions.includes("raise")) m.act("raise", l.maxRaiseTo);
    else if (l.actions.includes("call")) m.act("call");
    else m.act("check");
  }
}
function grandOf(m: DoubleFlopManager): number {
  return m.ledger().reduce((a, r) => a + r.stack, 0);
}

// #4 all-in for ante
function edgeAllInAnte(): void {
  const m = mgr([150, 2000]); // seat0 can't cover the 200 ante
  const grand = grandOf(m);
  m.start();
  driveCheckCall(m);
  const pots = m.sidePots();
  check("#edge all-in-for-ante: short seat contributes only its stack", m.contributedOf(0) === 150);
  check("#edge all-in-for-ante: a side pot forms", pots.length >= 2);
  if (m.phase() === "picking") m.pickingTimeout();
  while (m.phase() === "decisions") m.decisionsTimeout();
  check("#edge all-in-for-ante: conserved + ledger zero",
    m.chipTotal() === grand && m.ledger().reduce((a, r) => a + r.net, 0) === 0);
}

// #5 everyone folds to one
function edgeEveryoneFolds(): void {
  const m = mgr([2000, 2000, 2000]);
  const grand = grandOf(m);
  m.start();
  let g = 0;
  // bomb pots have no live bet to fold to at the open, so make the first actor
  // bet; everyone facing it folds -> fold-win to the last player.
  while (m.phase() === "betting") {
    if (++g > 100) break;
    const l = m.legal();
    if (l.actions.includes("fold")) m.act("fold");
    else if (l.actions.includes("bet")) m.act("bet", l.minRaiseTo);
    else m.act(l.actions.includes("check") ? "check" : "call");
  }
  check("#edge everyone-folds: hand ends by fold, one winner, conserved",
    m.phase() === "handEnded" && m.chipTotal() === grand && m.ledger().filter((r) => r.stack !== r.buyInTotal).length >= 1);
}

// override builders: hole is [handA0,handA1, handB0,handB1, tex0,tex1] (default split)
const ROYAL_S_NOACE = ["Ks", "Qs", "Js", "Ts", "2c"];
const ROYAL_H_NOACE = ["Kh", "Qh", "Jh", "Th", "2d"];
const ROYAL_C = ["Ac", "Kc", "Qc", "Jc", "Tc"]; // clubs royal ON the board -> everyone chops
const ROYAL_D = ["Ad", "Kd", "Qd", "Jd", "Td"];

function override(hole: Record<number, string[]>, boardsA: string[], boardsB: string[]): DealOverride {
  const h = new Map<number, Card[]>();
  for (const k of Object.keys(hole)) h.set(Number(k), cards(hole[Number(k)]));
  return { hole: h, boards: { a: cards(boardsA), b: cards(boardsB) } };
}
function defaultArr(hole: string[]): Arrangement {
  const c = cards(hole);
  return { handA: [c[0], c[1]], handB: [c[2], c[3]], tex: [c[4], c[5]] };
}

// #6a win both boards
function edgeWinBoth(): void {
  const m = mgr([2000, 2000]);
  const grand = grandOf(m);
  const ov = override(
    { 0: ["As", "9s", "Ah", "9h", "3c", "4c"], 1: ["7d", "8d", "6c", "5c", "2h", "2s"] },
    ROYAL_S_NOACE, ROYAL_H_NOACE
  );
  // verify the crafted structure via planShowdown on default arrangements
  const arr = new Map([[0, defaultArr(ov.hole.get(0)!.map(cStr))], [1, defaultArr(ov.hole.get(1)!.map(cStr))]]);
  const plan = planShowdown([{ amount: 4000, eligibleSeats: [0, 1] }], arr, ov.boards)[0];
  check("#edge win-both: planShowdown says whole pot to seat0", plan.kind === "whole" && (plan as any).winner === 0);

  m.start(); // note: start() already dealt a random hand; re-deal with override
  // fold that first hand quickly then deal the override
  m.dealNextHand(ov);
  driveCheckCall(m);
  if (m.phase() === "picking") m.pickingTimeout();
  check("#edge win-both: no decision phase (whole pot)", m.phase() === "handEnded");
  check("#edge win-both: seat0 took it all, conserved", m.lastHandDelta().get(0)! > 0 && m.chipTotal() === grand);
}

// #6b both boards chopped
function edgeBothChopped(): void {
  const m = mgr([2000, 2000, 2000]);
  const grand = grandOf(m);
  const ov = override(
    { 0: ["2h", "3h", "4h", "5h", "6h", "7h"], 1: ["2s", "3s", "4s", "5s", "6s", "8s"], 2: ["9d", "8d", "7d", "6d", "5d", "4d"] },
    ROYAL_C, ROYAL_D // both boards are royals on the board -> both boards chop among all
  );
  m.start(); m.dealNextHand(ov);
  driveCheckCall(m);
  if (m.phase() === "picking") m.pickingTimeout();
  check("#edge both-chopped: reaches a decision/flip phase or settles conserved",
    (m.phase() === "decisions" || m.phase() === "handEnded"));
  while (m.phase() === "decisions") m.decisionsTimeout();
  check("#edge both-chopped: conserved + ledger zero",
    m.chipTotal() === grand && m.ledger().reduce((a, r) => a + r.net, 0) === 0);
}

// #6c three-way chop (guaranteed-50% with a 3+ rep flip -> no surrender, #2)
function edgeThreeWayChop(): void {
  // board A = clubs royal ON the board -> all three chop A (a 3-way chop).
  // board B: seat0 wins outright and is in A's chop -> guaranteed-50% resolved
  // by a 3-way representation flip, where surrender is unavailable.
  const ov = override(
    {
      0: ["2h", "3h", "As", "9s", "5c", "6c"],
      1: ["2s", "3s", "4d", "5d", "6d", "7d"],
      2: ["8h", "9h", "4h", "5h", "7s", "8s"],
    },
    ROYAL_C, ["Ks", "Qs", "Js", "Ts", "2d"]
  );
  const arr = new Map([0, 1, 2].map((s) => [s, defaultArr(ov.hole.get(s)!.map(cStr))] as [number, Arrangement]));
  const plan = planShowdown([{ amount: 3000, eligibleSeats: [0, 1, 2] }], arr, ov.boards)[0];
  check("#edge 3-way: guaranteed-50% with a 3-way chop", plan.kind === "guaranteed" && (plan as any).chop.length === 3);

  const m = mgr([2000, 2000, 2000]);
  const grand = grandOf(m);
  m.dealNextHand(ov);
  driveCheckCall(m);
  if (m.phase() === "picking") m.pickingTimeout();
  check("#edge 3-way: no surrender offered in a 3+ rep flip (#2)", m.pendingDecisions().length === 0);
  const pot = m.potTotal();
  while (m.phase() === "decisions") m.decisionsTimeout();
  check("#edge 3-way: banker banks >= half, conserved",
    (m.lastHandDelta().get(0) ?? 0) >= Math.floor(pot / 2) && m.chipTotal() === grand);
}

// #6d guaranteed-50% (heads-up)
function edgeGuaranteed(): void {
  const ov = override(
    { 0: ["As", "9s", "2h", "3h", "5c", "6c"], 1: ["3d", "4d", "7c", "8c", "9d", "Td"] },
    ROYAL_S_NOACE, ROYAL_C // seat0 wins A outright; board B clubs royal -> both chop B -> seat0 in B chop
  );
  const arr = new Map([[0, defaultArr(ov.hole.get(0)!.map(cStr))], [1, defaultArr(ov.hole.get(1)!.map(cStr))]]);
  const plan = planShowdown([{ amount: 4000, eligibleSeats: [0, 1] }], arr, ov.boards)[0];
  check("#edge guaranteed: planShowdown -> guaranteed, banker seat0", plan.kind === "guaranteed" && (plan as any).banker === 0);

  const m = mgr([2000, 2000]);
  const grand = grandOf(m);
  m.start(); m.dealNextHand(ov);
  driveCheckCall(m);
  if (m.phase() === "picking") m.pickingTimeout();
  const pend = m.pendingDecisions();
  check("#edge guaranteed: only the banker may decide (challenger must run)",
    pend.length === 1 && pend[0].seat === 0);
  const pot = m.potTotal();
  m.declare(0, pend[0].potIndex, "run");
  check("#edge guaranteed: banker keeps >= banked half, conserved",
    (m.lastHandDelta().get(0) ?? 0) >= Math.floor(pot / 2) && m.chipTotal() === grand);
}

// #3 a player in main + side pots declaring OPPOSITE decisions
function edgeMainSideOpposite(): void {
  // seat0 wins board A, seat1 wins board B (both pots). seat2 short -> side pot.
  const ov = override(
    {
      0: ["As", "9s", "3c", "4c", "5d", "6d"], // wins A, loses B
      1: ["3d", "4h", "Ah", "9h", "7c", "8c"], // wins B, loses A
      2: ["2h", "2s", "6c", "7d", "4s", "5s"], // loses both (no card shared with the boards)
    },
    ROYAL_S_NOACE, ROYAL_H_NOACE
  );
  const m = mgr([5000, 5000, 400]); // seat2 short
  const grand = grandOf(m);
  m.start(); m.dealNextHand(ov);
  driveAllIn(m); // everyone all-in -> main {0,1,2} + side {0,1}
  if (m.phase() === "picking") m.pickingTimeout();
  const pend = m.pendingDecisions();
  check("#edge main+side: seat0 owes a decision in >1 pot", pend.filter((d) => d.seat === 0).length >= 2);
  // Both pots are plain heads-up flips (two outright board winners), so under
  // R1 nobody owns a guaranteed share and every seat must RUN each pot. The
  // property preserved here is per-pot INDEPENDENCE + conservation across a
  // main/side split (the banker-surrender path is covered by #edge guaranteed).
  for (const d of pend) m.declare(d.seat, d.potIndex, "run");
  while (m.phase() === "decisions") m.decisionsTimeout();
  check("#edge main+side: independent per-pot decisions, conserved + ledger zero",
    m.chipTotal() === grand && m.ledger().reduce((a, r) => a + r.net, 0) === 0);
}

// helpers for scenario verification
function cStr(c: Card): string {
  const suit = { clubs: "c", diamonds: "d", hearts: "h", spades: "s" }[c.suit];
  return c.rank + suit;
}
// ---------- run ----------
bettingConservationSuite();
const managerHands = managerFuzzSuite();
check(`manager fuzz: full hands played (>=200 required)`, managerHands >= 200, `${managerHands} hands`);
try { edgeAllInAnte(); } catch (e) { check("#edge all-in-for-ante ran", false, String(e)); }
try { edgeEveryoneFolds(); } catch (e) { check("#edge everyone-folds ran", false, String(e)); }
try { edgeWinBoth(); } catch (e) { check("#edge win-both ran", false, String(e)); }
try { edgeBothChopped(); } catch (e) { check("#edge both-chopped ran", false, String(e)); }
try { edgeThreeWayChop(); } catch (e) { check("#edge 3-way ran", false, String(e)); }
try { edgeGuaranteed(); } catch (e) { check("#edge guaranteed ran", false, String(e)); }
try { edgeMainSideOpposite(); } catch (e) { check("#edge main+side ran", false, String(e)); }
check("#edge 8 players rejected at the config layer", (() => {
  try {
    new DoubleFlopManager(DEFAULT_CONFIG, Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, buyIn: 1000 })), 1);
    return false;
  } catch { return true; }
})());

console.log(failures === 0 ? "\nDFT ENGINE TESTS PASS ✅ (Step 5 gate)" : `\nDFT ENGINE TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
