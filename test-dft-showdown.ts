// ============================================================
// DFT showdown tests — the six correctness points + a conservation
// fuzz on the resolver. Seeded, replayable. Run: npx tsx test-dft-showdown.ts
// ============================================================

import { makeRng, Deck } from "./shared/engine/dft/deck";
import { strToCard } from "./shared/engine/dft/cards";
import type { Card } from "./shared/engine/types";
import type { SidePot } from "./shared/engine/dft/betting";
import {
  planShowdown, prepareShowdown, resolveShowdown,
  type Arrangement, type Boards, type DecisionFor,
} from "./shared/engine/dft/showdown";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const C = (s: string) => strToCard(s);
const arr = (a: string[], b: string[], t: string[]): Arrangement => ({
  handA: [C(a[0]), C(a[1])], handB: [C(b[0]), C(b[1])], tex: [C(t[0]), C(t[1])],
});
const board = (s: string[]): Card[] => s.map(C);
const sum = (d: Map<number, number>) => [...d.values()].reduce((a, b) => a + b, 0);
const RUN: DecisionFor = () => "run";
const THROW: DecisionFor = () => { throw new Error("decisionFor must not be called here"); };

// ---------- #5: win both boards = whole pot, no flip, no decision ----------
{
  const arrangements = new Map<number, Arrangement>([
    [0, arr(["Ah", "9h"], ["As", "9s"], ["4c", "4d"])], // royal on both boards
    [1, arr(["3c", "4d"], ["3h", "4h"], ["7d", "8d"])], // loses both
  ]);
  const boards: Boards = { a: board(["Kh", "Qh", "Jh", "Th", "2c"]), b: board(["Ks", "Qs", "Js", "Ts", "2d"]) };
  const pots: SidePot[] = [{ amount: 1000, eligibleSeats: [0, 1] }];
  const plan = planShowdown(pots, arrangements, boards);
  check("#5 wins both -> whole pot to that player", plan[0].kind === "whole" && (plan[0] as any).winner === 0);
  const d = resolveShowdown(pots, arrangements, boards, THROW, makeRng(1)); // THROW proves no decision asked
  check("#5 whole pot paid entirely to winner", d.get(0) === 1000 && (d.get(1) ?? 0) === 0);
}

// ---------- #1: board winners computed PER POT (own eligible set) ----------
{
  // seat2 has the nut on board A; seat0 the nut on board A among {0,1} only.
  const arrangements = new Map<number, Arrangement>([
    [0, arr(["Ah", "9h"], ["2h", "3h"], ["4c", "5c"])], // royal hearts on A (best among 0,1)
    [1, arr(["3c", "4d"], ["2s", "3s"], ["6c", "7c"])], // junk on A
    [2, arr(["Ad", "Kd"], ["2d", "4s"], ["8c", "9c"])], // will hold the A-royal via board? see below
  ]);
  // board A = hearts royal minus the ace: seat0 (Ah 9h) completes the royal and
  // wins outright whenever eligible. Give seat2 a different, weaker A hand so
  // seat0 wins A in BOTH pots — but eligibility still differs by pot.
  const boards: Boards = { a: board(["Kh", "Qh", "Jh", "Th", "2c"]), b: board(["Ac", "Kc", "Qc", "Jc", "Tc"]) };
  const pots: SidePot[] = [
    { amount: 600, eligibleSeats: [0, 1] },     // pot 0: seat2 NOT eligible
    { amount: 300, eligibleSeats: [0, 1, 2] },  // pot 1: seat2 eligible
  ];
  const plans = planShowdown(pots, arrangements, boards);
  const refersTo = (p: any, seat: number) =>
    JSON.stringify(p).includes(`"outright":${seat}`) ||
    JSON.stringify(p).includes(`${seat}`) && (p.chop?.includes?.(seat) || sideHas(p, seat));
  function sideHas(p: any, seat: number): boolean {
    for (const k of ["sideA", "sideB"]) {
      const s = p[k];
      if (!s) continue;
      if (s.outright === seat) return true;
      if (s.chop?.includes(seat)) return true;
    }
    return p.banker === seat || p.winner === seat || p.chop?.includes?.(seat);
  }
  check("#1 pot with {0,1} never references seat2", !sideHas(plans[0], 2));
  check("#1 pot with {0,1,2} does reference seat2", sideHas(plans[1], 2));
}

// ---------- #6 + #2: guaranteed-50% ----------
function guaranteed(eligible: number[]): { arrangements: Map<number, Arrangement>; boards: Boards; pots: SidePot[] } {
  // board A: seat0 wins outright (royal hearts via Ah 9h). board B: clubs royal
  // on the board -> everyone plays it -> chop among all eligible (incl seat0).
  const base = new Map<number, Arrangement>([
    [0, arr(["Ah", "9h"], ["2h", "3h"], ["4c", "5d"])],
    [1, arr(["3c", "4d"], ["2s", "3s"], ["6h", "7d"])],
    [2, arr(["5c", "6d"], ["2d", "4s"], ["8h", "9d"])],
  ]);
  const arrangements = new Map([...base].filter(([s]) => eligible.includes(s)));
  const boards: Boards = { a: board(["Kh", "Qh", "Jh", "Th", "2c"]), b: board(["Ac", "Kc", "Qc", "Jc", "Tc"]) };
  return { arrangements, boards, pots: [{ amount: 1000, eligibleSeats: eligible }] };
}
{
  // heads-up guaranteed: banker=0, chop=[0,1]. banked=500, contested=500.
  const g = guaranteed([0, 1]);
  const plan = planShowdown(g.pots, g.arrangements, g.boards)[0];
  check("#6 heads-up classified as guaranteed", plan.kind === "guaranteed" && (plan as any).banker === 0);

  // surrender: banker 0 surrenders -> banked 500 + 30% of 500 = 650; other 350.
  const surr: DecisionFor = (_p, seat) => (seat === 0 ? "surrender" : "run");
  const d1 = resolveShowdown(g.pots, g.arrangements, g.boards, surr, makeRng(7));
  check("#6 banker surrender -> banked + 30% contested", d1.get(0) === 650 && d1.get(1) === 350, `${d1.get(0)}/${d1.get(1)}`);

  // run, across many seeds: banker ALWAYS keeps the banked 50%, pot conserved.
  let bankerAlwaysHalf = true, alwaysConserved = true;
  for (let s = 0; s < 60; s++) {
    const d = resolveShowdown(g.pots, g.arrangements, g.boards, RUN, makeRng(100 + s));
    if ((d.get(0) ?? 0) < 500) bankerAlwaysHalf = false;
    if (sum(d) !== 1000) alwaysConserved = false;
  }
  check("#6 banked 50% is irrevocable across 60 seeds", bankerAlwaysHalf);
  check("#6 pot always fully distributed", alwaysConserved);
}
{
  // #2: 3+ representation flip -> surrender UNAVAILABLE (decisionFor never called).
  const g = guaranteed([0, 1, 2]);
  const plan = planShowdown(g.pots, g.arrangements, g.boards)[0];
  check("#2 three-way classified as guaranteed w/ 3 choppers",
    plan.kind === "guaranteed" && (plan as any).chop.length === 3);
  let ok = true;
  for (let s = 0; s < 40; s++) {
    try {
      const d = resolveShowdown(g.pots, g.arrangements, g.boards, THROW, makeRng(200 + s));
      if ((d.get(0) ?? 0) < 500 || sum(d) !== 1000) ok = false;
    } catch {
      ok = false; // decisionFor was called -> surrender wrongly offered
    }
  }
  check("#2 no surrender offered in a 3+ rep flip; banker still banks 50%", ok);
}

// ---------- #4: two outright winners -> heads-up final flip ----------
{
  const arrangements = new Map<number, Arrangement>([
    [0, arr(["Ah", "9h"], ["3h", "4h"], ["5c", "6c"])], // wins A, loses B
    [1, arr(["3c", "4d"], ["As", "9s"], ["7d", "8d"])], // loses A, wins B
  ]);
  const boards: Boards = { a: board(["Kh", "Qh", "Jh", "Th", "2c"]), b: board(["Ks", "Qs", "Js", "Ts", "2d"]) };
  const pots: SidePot[] = [{ amount: 1000, eligibleSeats: [0, 1] }];
  const plan = planShowdown(pots, arrangements, boards)[0];
  check("#4 two outright winners -> final flip", plan.kind === "final");

  // run/surrender exact: 0 runs, 1 surrenders -> 700/300.
  const d1 = resolveShowdown(pots, arrangements, boards, (_p, s) => (s === 0 ? "run" : "surrender"), makeRng(3));
  check("#4 run vs surrender -> 70/30", d1.get(0) === 700 && d1.get(1) === 300, `${d1.get(0)}/${d1.get(1)}`);
  // both surrender -> 50/50
  const d2 = resolveShowdown(pots, arrangements, boards, () => "surrender", makeRng(3));
  check("#4 both surrender -> 50/50", d2.get(0) === 500 && d2.get(1) === 500);
  // both run -> flip for 100%, always exactly 2 participants, pot conserved
  let headsUpOk = true;
  for (let s = 0; s < 40; s++) {
    const d = resolveShowdown(pots, arrangements, boards, RUN, makeRng(300 + s));
    const winners = [...d.entries()].filter(([, v]) => v > 0).map(([k]) => k);
    if (sum(d) !== 1000) headsUpOk = false;
    if (!winners.every((w) => w === 0 || w === 1)) headsUpOk = false;
  }
  check("#4 final flip is heads-up and pot-conserving", headsUpOk);
}

// ---------- #7: TIE RESOLUTION (Kabir's ruling) — even split, no re-run, no seat fallback ----------
{
  // 7a. FINAL heads-up flip that ties -> exact 50/50 of the stake. Two outright
  // board winners both RUN; whenever the final flip ties, the pot splits evenly.
  // (A win-take-all-on-tie or seat bias would fail the exact-500/500 assert.)
  const arrangements = new Map<number, Arrangement>([
    [0, arr(["Ah", "9h"], ["3h", "4h"], ["4c", "6d"])], // wins board A outright; junk tex
    [1, arr(["3c", "4d"], ["As", "9s"], ["5c", "7d"])], // wins board B outright; junk tex
  ]);
  const boards: Boards = { a: board(["Kh", "Qh", "Jh", "Th", "2c"]), b: board(["Ks", "Qs", "Js", "Ts", "2d"]) };
  const pots: SidePot[] = [{ amount: 1000, eligibleSeats: [0, 1] }];
  let ties = 0, evenSplitOk = true, conserved = true;
  for (let s = 1; s <= 2500; s++) {
    const d = resolveShowdown(pots, arrangements, boards, RUN, makeRng(s));
    if (sum(d) !== 1000) conserved = false;
    const a = d.get(0) ?? 0, b = d.get(1) ?? 0;
    if (a > 0 && b > 0) { ties++; if (!(a === 500 && b === 500)) evenSplitOk = false; } // both paid == flip tied
  }
  check("#7a final-flip tie splits stake exactly 50/50 (no seat bias)", ties > 0 && evenSplitOk, `${ties} ties`);
  check("#7a stake always fully distributed", conserved);
}
{
  // 7b. gtdMulti (3-way representation flip for the contested 50%): a tie splits
  // the contested half among the tied winners in ONE flip. Banker always keeps
  // the banked 50% (a re-run collapsing the tie must never cost the banker).
  const g = guaranteed([0, 1, 2]); // banker 0, chop [0,1,2], banked 500 / contested 500
  let multiWinTies = 0, bankerAlwaysBanks = true, conserved = true;
  for (let s = 1; s <= 1500; s++) {
    const d = resolveShowdown(g.pots, g.arrangements, g.boards, RUN, makeRng(s));
    if (sum(d) !== 1000) conserved = false;
    if ((d.get(0) ?? 0) < 500) bankerAlwaysBanks = false; // banker below banked half
    // seats sharing the contested half: banker>500 means banker also took a slice
    const sharers = [0, 1, 2].filter((k) => (d.get(k) ?? 0) > (k === 0 ? 500 : 0));
    if (sharers.length > 1) multiWinTies++;
  }
  check("#7b gtdMulti tie splits contested among >1 tied winner (no re-run to one)", multiWinTies > 0, `${multiWinTies} tie splits`);
  check("#7b banker keeps banked 50% through every tie", bankerAlwaysBanks);
  check("#7b pot always fully distributed", conserved);
}
{
  // 7c. REPRESENTATION flip tie -> boardSplit. Board A is chopped by {0,1};
  // board B is won outright by seat 2. When {0,1}'s representation flip ties,
  // NO champion is crowned and NO final flip runs: board A's half (500) splits
  // 250/250 between {0,1}, board B's half (500) goes to seat 2 -> 250/250/500.
  // The OLD min-seat fallback would instead crown seat 0 and send it to a final
  // flip for 100% (outcomes 1000/0 or 0/1000) — impossible under this assert.
  const arrangements = new Map<number, Arrangement>([
    [0, arr(["Ah", "Ac"], ["7d", "9h"], ["6c", "4c"])], // ties seat1 on board A (KK+AA); junk tex
    [1, arr(["As", "Ad"], ["7h", "9d"], ["6d", "4h"])], // ties seat0 on board A; junk tex
    [2, arr(["Tc", "Jd"], ["Ks", "Kc"], ["2c", "3c"])], // loses A, wins B outright (KK+QQ)
  ]);
  const boards: Boards = { a: board(["Kh", "Kd", "7c", "2s", "3d"]), b: board(["Qs", "Qh", "8c", "4d", "5s"]) };
  const pots: SidePot[] = [{ amount: 1000, eligibleSeats: [0, 1, 2] }];
  check("#7c setup is board-A-chop vs board-B-outright", planShowdown(pots, arrangements, boards)[0].kind === "final");
  let boardSplits = 0, exactSplitOk = true, collapsed = false, conserved = true;
  for (let s = 1; s <= 2500; s++) {
    const prep = prepareShowdown(pots, arrangements, boards, makeRng(s))[0];
    if (prep.kind !== "boardSplit") continue; // rep flip had a clean winner -> normal headsup
    boardSplits++;
    const d = resolveShowdown(pots, arrangements, boards, RUN, makeRng(s));
    if (sum(d) !== 1000) conserved = false;
    if (!((d.get(0) ?? 0) === 250 && (d.get(1) ?? 0) === 250 && (d.get(2) ?? 0) === 500)) exactSplitOk = false;
    if ((d.get(0) ?? 0) === 1000 || (d.get(1) ?? 0) === 1000) collapsed = true; // a fallback-to-one champion
  }
  check("#7c representation-flip tie -> boardSplit 250/250/500 (both choppers paid)", boardSplits > 0 && exactSplitOk, `${boardSplits} boardSplits`);
  check("#7c no seat-fallback: a tie never collapses to one champion", !collapsed);
  check("#7c pot always fully distributed", conserved);
}

// ---------- conservation fuzz on real deals ----------
{
  let ok = true;
  const HANDS = 400;
  for (let i = 0; i < HANDS; i++) {
    const seed = 5000 + i * 613;
    const rng = makeRng(seed);
    const n = 2 + Math.floor(rng() * 5); // 2..6
    const seats = [0, 1, 2, 3, 4, 5].slice(0, n);
    const deck = new Deck(rng);
    const arrangements = new Map<number, Arrangement>();
    for (const s of seats) {
      const c = deck.draw(6);
      arrangements.set(s, { handA: [c[0], c[1]], handB: [c[2], c[3]], tex: [c[4], c[5]] });
    }
    const boards: Boards = { a: deck.draw(5), b: deck.draw(5) };
    // 1..3 random pots over random non-empty eligible subsets
    const pots: SidePot[] = [];
    const potCount = 1 + Math.floor(rng() * 3);
    for (let p = 0; p < potCount; p++) {
      const elig = seats.filter(() => rng() < 0.6);
      const eligibleSeats = elig.length ? elig : [seats[Math.floor(rng() * seats.length)]];
      pots.push({ amount: 100 + Math.floor(rng() * 5000), eligibleSeats });
    }
    const decide: DecisionFor = () => (rng() < 0.5 ? "run" : "surrender");
    const d = resolveShowdown(pots, arrangements, boards, decide, rng);
    const potTotal = pots.reduce((a, x) => a + x.amount, 0);
    if (sum(d) !== potTotal) { ok = false; console.log(`  seed ${seed}: delta ${sum(d)} != pots ${potTotal}`); break; }
    for (const v of d.values()) if (v < 0) { ok = false; break; }
  }
  check(`conservation fuzz: ${HANDS} deals, sum(deltas)==sum(pots)`, ok);
}

console.log(failures === 0 ? "\nDFT SHOWDOWN TESTS PASS ✅" : `\nDFT SHOWDOWN TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
