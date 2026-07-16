// ============================================================
// DFT → GameState mapper tests (Step 6 C1). Proves DoubleFlopManager.state()
// maps onto the shared GameState correctly, and — the anti-cheat foundation —
// NEVER exposes a board card beyond the current reveal depth to anyone.
// The per-viewer stripping of hole cards / arrangements / declarations is the
// filter's job (tested in test-filter.ts); here we assert the FULL-TRUTH state
// carries those secrets so the filter has something to strip.
//
// Run: npx tsx test-dft-view.ts
// ============================================================

import { DoubleFlopManager } from "./shared/engine/dft/manager";
import { strToCard } from "./shared/engine/dft/cards";
import type { Card, GameConfig } from "./shared/engine/types";
import type { Boards } from "./shared/engine/dft/showdown";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const C = (s: string) => strToCard(s);
const H = (...s: string[]): Card[] => s.map(C);

const CONFIG: GameConfig = {
  smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000,
  minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30,
};

// Forced deal: seat0 wins board A outright, seat1 wins board B outright ->
// after picking, a heads-up final flip -> a decisions phase we can inspect.
function twoOutrightWinners(): { hole: Map<number, Card[]>; boards: Boards } {
  return {
    hole: new Map<number, Card[]>([
      [0, H("Ah", "9h", "3h", "4h", "5c", "6c")], // handA wins A; default order
      [1, H("3c", "4d", "As", "9s", "7d", "8d")], // handB wins B
    ]),
    boards: { a: H("Kh", "Qh", "Jh", "Th", "2c"), b: H("Ks", "Qs", "Js", "Ts", "2d") },
  };
}

const EXPECTED_DEPTH: Record<string, number> = { flop: 3, turn: 4, river: 5 };

// ---------- board reveal truncation (the anti-cheat foundation) ----------
{
  const gm = new DoubleFlopManager(CONFIG, [
    { id: "a", name: "A", buyIn: 2000 },
    { id: "b", name: "B", buyIn: 2000 },
  ], 42);
  gm.dealNextHand(twoOutrightWinners());

  let s = gm.state();
  check("variant is dft", s.variant === "dft");
  check("betting maps to phase inHand", s.phase === "inHand" && s.dft?.subPhase === "betting");
  check("6 hole cards present for a dealt-in seat", (s.seats[0].holeCards?.length ?? 0) === 6);
  check("own cards not marked revealed during betting", s.seats[0].revealed === false);

  // walk every betting round; boards must match the reveal depth EXACTLY —
  // never a card deeper than the current street (no future-card leak).
  let depthOk = true, neverOverfull = true, sawTurn = false, sawRiver = false;
  let guard = 0;
  while (s.phase === "inHand" && s.dft?.subPhase === "betting" && guard++ < 50) {
    const want = EXPECTED_DEPTH[s.round ?? "flop"];
    if (s.dft.boards.a.length !== want || s.dft.boards.b.length !== want) depthOk = false;
    if (s.dft.boards.a.length > 5 || s.dft.boards.b.length > 5) neverOverfull = false;
    if (s.round === "turn") sawTurn = true;
    if (s.round === "river") sawRiver = true;
    gm.act("check"); // bomb pot: each round opens checkable (antes are dead money)
    s = gm.state();
  }
  check("board depth == street depth on every betting snapshot", depthOk);
  check("board never exceeds 5 cards mid-hand", neverOverfull);
  check("turn and river streets were actually reached", sawTurn && sawRiver);
}

// ---------- picking sub-state + full-truth arrangement secret ----------
{
  const gm = new DoubleFlopManager(CONFIG, [
    { id: "a", name: "A", buyIn: 2000 },
    { id: "b", name: "B", buyIn: 2000 },
  ], 42);
  gm.dealNextHand(twoOutrightWinners());
  while (gm.state().dft?.subPhase === "betting") gm.act("check");

  let s = gm.state();
  check("post-betting maps to picking", s.phase === "inHand" && s.dft?.subPhase === "picking");
  check("both boards fully revealed at showdown", s.dft?.boards.a.length === 5 && s.dft?.boards.b.length === 5);
  check("picking lists who must pick", (s.dft?.picking?.seats.length ?? 0) === 2);
  check("nobody locked yet", (s.dft?.picking?.lockedSeats.length ?? 0) === 0);
  check("full-truth carries each seat's arrangement order (filter will strip)",
    Array.isArray(s.seats[0].arrangement) && s.seats[0].arrangement!.length === 6);

  gm.submitArrangement(0, [0, 1, 2, 3, 4, 5]); // seat 0 locks the default split
  s = gm.state();
  check("lockedSeats reflects who locked (public 'who')",
    s.dft?.picking?.lockedSeats.includes(0) === true && !s.dft?.picking?.lockedSeats.includes(1));
}

// ---------- decisions sub-state + full-truth declaration secret ----------
{
  const gm = new DoubleFlopManager(CONFIG, [
    { id: "a", name: "A", buyIn: 2000 },
    { id: "b", name: "B", buyIn: 2000 },
  ], 42);
  gm.dealNextHand(twoOutrightWinners());
  while (gm.state().dft?.subPhase === "betting") gm.act("check");
  gm.submitArrangement(0, [0, 1, 2, 3, 4, 5]);
  gm.submitArrangement(1, [0, 1, 2, 3, 4, 5]); // both lock -> finishPicking -> decisions

  let s = gm.state();
  check("two outright winners -> decisions phase", s.dft?.subPhase === "decisions");
  const contest = s.dft?.decisions?.contests[0];
  check("a contest is listed with its stake + who must decide",
    !!contest && contest.amount > 0 && contest.seats.length === 2,
    contest ? `pot ${contest.potIndex} amount ${contest.amount}` : "none");
  check("nobody declared yet", (s.dft?.decisions?.lockedSeats.length ?? 0) === 0);

  // R1: a plain heads-up flip has no banker, so surrender is offered to nobody
  // and the engine rejects an attempt (must RUN).
  check("heads-up flip is surrender-eligible for nobody (R1: banker-only)",
    (contest?.surrenderSeats.length ?? -1) === 0);
  let illegalSurrenderRejected = false;
  try { gm.declare(0, contest!.potIndex, "surrender"); } catch { illegalSurrenderRejected = true; }
  check("engine rejects an illegal heads-up surrender", illegalSurrenderRejected);
  check("rejected surrender did not lock the seat", (gm.state().dft?.decisions?.lockedSeats.length ?? 0) === 0);

  gm.declare(0, contest!.potIndex, "run"); // seat 0 declares RUN (secret WHAT)
  s = gm.state();
  check("decisions lockedSeats reflects WHO declared (never the WHAT)",
    s.dft?.decisions?.lockedSeats.some((l) => l.seat === 0) === true);
  const seat0decls = s.seats.find((x) => x.seat === 0)?.declarations ?? [];
  check("full-truth carries the declaration value (filter will strip it)",
    seat0decls.length === 1 && seat0decls[0].decision === "run");
  check("flips stay hidden through the blind decisions phase", (s.dft?.flips?.length ?? -1) === 0);

  gm.declare(1, contest!.potIndex, "run"); // both declared -> finalize
  s = gm.state();
  check("after both declare, hand ends", s.phase === "handEnded");
  check("handEnded reports a positive-delta winner", (s.lastHandResult?.length ?? 0) >= 1);
  const flips = s.dft?.flips ?? [];
  check("handEnded exposes exactly one final heads-up flip for the reveal",
    flips.length === 1 && flips[0].stage === "final" && flips[0].boardTag === null);
  check("the final flip carries a fresh 5-card runout + both tex hands + a winner",
    flips[0]?.runout.length === 5 && flips[0]?.hands.length === 2 && (flips[0]?.winners.length ?? 0) >= 1);
}

// ---------- guaranteed banker: surrender IS allowed for the sole banker ----------
{
  const gm = new DoubleFlopManager(CONFIG, [
    { id: "a", name: "A", buyIn: 2000 },
    { id: "b", name: "B", buyIn: 2000 },
  ], 42);
  // seat0 wins board A outright AND ties board B (a board-royal both play) ->
  // seat0 banks 50% and is the banker of a heads-up guaranteed contest.
  gm.dealNextHand({
    hole: new Map<number, Card[]>([
      [0, H("Ah", "9h", "2h", "3h", "4c", "5d")],
      [1, H("3c", "4d", "2s", "3s", "6h", "7d")],
    ]),
    boards: { a: H("Kh", "Qh", "Jh", "Th", "2c"), b: H("Ac", "Kc", "Qc", "Jc", "Tc") },
  });
  while (gm.state().dft?.subPhase === "betting") gm.act("check");
  gm.submitArrangement(0, [0, 1, 2, 3, 4, 5]);
  gm.submitArrangement(1, [0, 1, 2, 3, 4, 5]);

  const s = gm.state();
  check("guaranteed banker -> decisions phase", s.dft?.subPhase === "decisions");
  const contest = s.dft?.decisions?.contests[0];
  check("only the banker is asked to decide", contest?.seats.length === 1 && contest?.seats[0] === 0);
  check("banker is the sole surrender-eligible seat",
    contest?.surrenderSeats.length === 1 && contest?.surrenderSeats[0] === 0);
  let bankerSurrenderOk = true;
  try { gm.declare(0, contest!.potIndex, "surrender"); } catch { bankerSurrenderOk = false; }
  check("engine allows the banker to surrender -> hand ends", bankerSurrenderOk && gm.state().phase === "handEnded");
}

// ---------- both boards chopped: representation flips are logged for the reveal ----------
{
  const gm = new DoubleFlopManager(CONFIG, [
    { id: "a", name: "A", buyIn: 2000 },
    { id: "b", name: "B", buyIn: 2000 },
  ], 7);
  // both boards are royals ON the board -> every hand just plays the board ->
  // both boards chop [0,1] -> two representation flips resolve at showdown.
  gm.dealNextHand({
    hole: new Map<number, Card[]>([
      [0, H("2h", "3h", "2d", "3d", "4h", "5h")],
      [1, H("6h", "7h", "8h", "9h", "4d", "5d")],
    ]),
    boards: { a: H("Ac", "Kc", "Qc", "Jc", "Tc"), b: H("As", "Ks", "Qs", "Js", "Ts") },
  });
  while (gm.state().dft?.subPhase === "betting") gm.act("check");
  gm.pickingTimeout(); // lock both at default -> finishPicking runs the rep flips (blind)

  if (gm.phase() === "decisions") {
    check("rep flips stay hidden while decisions are still blind", (gm.state().dft?.flips?.length ?? -1) === 0);
    for (const d of gm.pendingDecisions()) gm.declare(d.seat, d.potIndex, "run");
  }
  const s = gm.state();
  check("both-chopped hand ends after its flips resolve", s.phase === "handEnded");
  const reps = (s.dft?.flips ?? []).filter((f) => f.stage === "representation");
  check("both boards' representation flips are logged (A and B) for the reveal",
    reps.length >= 2 && reps.some((f) => f.boardTag === "A") && reps.some((f) => f.boardTag === "B"));
  check("each representation flip carries a fresh 5-card runout + the chop's tex hands",
    reps.every((f) => f.runout.length === 5 && f.hands.length === 2));
}

console.log(failures === 0 ? "\nDFT VIEW TESTS PASS ✅" : `\nDFT VIEW TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
