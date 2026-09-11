// ============================================================
// Session-lifecycle + presentation contract tests (headless, both engines).
// Started in the readability/1E pass; grows with every engine change made for
// the UI so each rule has a fast, deterministic check:
//   - parked-table log-once (KABIR-TODO #3)
// Run: npx tsx test-lifecycle.ts
// ============================================================

import { GameManager } from "./shared/engine/manager";
import { DoubleFlopManager } from "./shared/engine/dft/manager";
import { DEFAULT_CONFIG } from "./shared/engine/types";
import { TIMING, handEndHoldMs } from "./shared/engine/timing";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

// ---------- KABIR-TODO #3: "Waiting for…" is logged once, on change ----------
{
  // NLHE: a lone player can't be dealt; repeated deal attempts must not spam
  const gm = new GameManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 1000 }]);
  gm.start();
  gm.dealNextHand(); gm.dealNextHand(); gm.dealNextHand();
  const lines = gm.state().log.filter((l) => l.startsWith("Waiting for"));
  check("NLHE: parked table logs the waiting reason exactly once", lines.length === 1, `${lines.length} lines`);
  check("NLHE: waitingReason still set while parked", gm.state().waitingReason !== null);
  // a second player arrives -> deal succeeds -> reason clears; park again -> logged again (on change)
  gm.seatPlayer("b", "B", 1, 1000);
  gm.dealNextHand();
  check("NLHE: deal succeeds once 2 players have chips", gm.state().phase === "inHand" && gm.state().waitingReason === null);
}
{
  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 1000 }], 7);
  dft.start();
  dft.dealNextHand(); dft.dealNextHand(); dft.dealNextHand();
  const lines = dft.state().log.filter((l) => l.startsWith("Waiting for"));
  check("DFT: parked table logs the waiting reason exactly once", lines.length === 1, `${lines.length} lines`);
  dft.seatPlayer("b", "B", 1, 1000);
  dft.dealNextHand();
  check("DFT: deal succeeds once 2 players have chips", dft.state().phase === "inHand" && dft.state().waitingReason === null);
}

// ---------- Readability 2.4: live rearranging (drafts) + what handEnded exposes ----------
{
  const CFG = { ...DEFAULT_CONFIG, defaultBuyIn: 2000 };
  const dft = new DoubleFlopManager(CFG, [
    { id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }, { id: "c", name: "C", buyIn: 2000 },
  ], 11);
  dft.start();
  let s = dft.state();
  check("DFT: every dealt-in seat carries a default working split from the deal",
    s.seats.filter((x) => !x.empty).every((x) => JSON.stringify(x.arrangement) === JSON.stringify([0, 1, 2, 3, 4, 5])));

  // seat 1 rearranges during betting; seat 0 does not
  dft.draftArrangement(1, [2, 3, 0, 1, 5, 4]);
  s = dft.state();
  check("DFT: a betting-phase draft is stored for that seat only",
    JSON.stringify(s.seats[1].arrangement) === JSON.stringify([2, 3, 0, 1, 5, 4]) &&
    JSON.stringify(s.seats[0].arrangement) === JSON.stringify([0, 1, 2, 3, 4, 5]));
  let bad = false;
  try { dft.draftArrangement(1, [0, 0, 1, 2, 3, 4]); } catch { bad = true; }
  check("DFT: a non-permutation draft is rejected", bad);

  // first to act bets the minimum (a bomb pot opens checkable, so a fold needs a
  // bet to fold to); the next player folds
  const bettor = dft.currentActor()!;
  dft.act("bet", 200);
  const first = dft.currentActor()!; // the folder
  dft.act("fold");
  s = dft.state();
  check("DFT: the bettor's badge reads BET 200", s.seats[bettor].lastAction === "BET 200");
  check("DFT: the folder's badge reads FOLD", s.seats[first].lastAction === "FOLD");
  check("DFT: a folded seat carries no working split", s.seats[first].arrangement === null);
  bad = false;
  try { dft.draftArrangement(first, [5, 4, 3, 2, 1, 0]); } catch { bad = true; }
  check("DFT: a folded seat cannot draft", bad);
  check("DFT: the dealer log records the actions", s.log.some((l) => l.endsWith(": fold")) && s.log.some((l) => l.endsWith(": bet 200")));

  // remaining two go to showdown; the survivor with a draft keeps it into picking
  const survivors = [0, 1, 2].filter((x) => x !== first);
  const locker = survivors[0];
  const drafter = survivors[1];
  dft.draftArrangement(drafter, [4, 5, 2, 3, 0, 1]);
  let guard = 0;
  while (dft.phase() === "betting" && guard++ < 50) dft.act(dft.legal().actions.includes("check") ? "check" : "call");
  check("DFT: reached picking", dft.phase() === "picking");
  s = dft.state();
  check("DFT: picking opens on the seat's working split", JSON.stringify(s.seats[drafter].arrangement) === JSON.stringify([4, 5, 2, 3, 0, 1]));
  check("DFT: every seat still shows CHECK/CALL badges through picking", s.seats.filter((x) => !x.empty && !x.folded).every((x) => x.lastAction === "CHECK" || (x.lastAction ?? "").startsWith("CALL")));

  // a draft during picking is allowed until the lock; the TIMEOUT locks the on-screen split
  dft.draftArrangement(drafter, [1, 0, 3, 2, 5, 4]);
  dft.submitArrangement(locker, [0, 1, 2, 3, 4, 5]);
  bad = false;
  try { dft.draftArrangement(locker, [5, 4, 3, 2, 1, 0]); } catch { bad = true; }
  check("DFT: a locked seat cannot draft any more (lock is irreversible)", bad);
  dft.pickingTimeout();
  s = dft.state();
  check("DFT: the timeout locked the drafter's on-screen split",
    JSON.stringify(s.seats[drafter].arrangement) === JSON.stringify([1, 0, 3, 2, 5, 4]));
  check("DFT: after picking the hand moved on (decisions or handEnded)", dft.phase() === "decisions" || dft.phase() === "handEnded");
  if (dft.phase() === "decisions") dft.decisionsTimeout();
  s = dft.state();
  check("DFT: handEnded keeps the showdown seats' cards + splits on the table",
    s.phase === "handEnded" && (s.seats[locker].holeCards?.length ?? 0) === 6 && s.seats[locker].revealed &&
    (s.seats[drafter].holeCards?.length ?? 0) === 6 && Array.isArray(s.seats[drafter].arrangement));
  check("DFT: handEnded keeps who folded (dimmed seat), never marks them revealed",
    s.seats[first].folded === true && s.seats[first].revealed === false);
  check("DFT: handEnded lists the pots with eligibility", s.pots.length >= 1 && s.pots[0].eligibleSeats.length === 2);
  check("DFT: both boards fully shown at a showdown", s.dft?.boards.a.length === 5 && s.dft?.boards.b.length === 5);
  bad = false;
  try { dft.draftArrangement(locker, [5, 4, 3, 2, 1, 0]); } catch { bad = true; }
  check("DFT: no drafting once the hand is over", bad);

  // next hand: a fold-win on the flop keeps the boards at flop depth (no rabbit hunt)
  dft.dealNextHand();
  s = dft.state();
  check("DFT: new hand clears badges + splits reset to default",
    s.seats.filter((x) => !x.empty).every((x) => x.lastAction === null && JSON.stringify(x.arrangement) === JSON.stringify([0, 1, 2, 3, 4, 5])));
  guard = 0;
  while (dft.phase() === "betting" && guard++ < 10) dft.act(dft.legal().actions.includes("fold") ? "fold" : "bet", 200);
  s = dft.state();
  check("DFT: fold-win ends the hand", s.phase === "handEnded");
  check("DFT: fold-win keeps the boards at the depth reached (3 cards, no rabbit hunt)",
    s.dft?.boards.a.length === 3 && s.dft?.boards.b.length === 3);
  check("DFT: chips conserved through all of it", dft.chipTotal() === 6000);
}

// ---------- DFT time bank (parity with NLHE) ----------
{
  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }], 5);
  dft.start();
  const before = dft.state().turnDeadlineAt!;
  check("DFT: time bank extends the current deadline", dft.useTimeBank() && dft.state().turnDeadlineAt! > before);
  const actor = dft.currentActor()!;
  check("DFT: the actor's bank went down by 30", dft.state().seats[actor].timeBank === DEFAULT_CONFIG.timeBankSec - 30);
}

// ---------- Part 3: hand-end holds follow the choreography (shared timing) ----------
{
  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }], 3);
  dft.start();
  let guard = 0;
  while (dft.phase() === "betting" && guard++ < 50) dft.act(dft.legal().actions.includes("check") ? "check" : "call");
  dft.pickingTimeout();
  if (dft.phase() === "decisions") dft.decisionsTimeout();
  const s = dft.state();
  check("DFT: handEnded lists how each pot resolved (contests)", (s.dft?.contests?.length ?? 0) >= 1 && ["whole", "headsup", "gtdHeadsUp", "gtdMulti", "boardSplit"].includes(s.dft!.contests![0].kind));
  const hold = handEndHoldMs(s);
  check("DFT: a showdown holds at least two board steps + the pot move", hold >= TIMING.boardHoldMs * 2 + TIMING.potMoveMs, `${hold}ms`);
  const flips = s.dft?.flips.length ?? 0;
  check("DFT: each flip adds its own beat to the hold", hold >= TIMING.boardHoldMs * 2 + flips * TIMING.flipMs, `flips=${flips} hold=${hold}`);
  check("DFT: hold is capped", hold <= TIMING.maxHoldMs);

  const nl = new GameManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 1000 }, { id: "b", name: "B", buyIn: 1000 }]);
  nl.start();
  // shove preflop: an all-in call ends betting with 0 board cards seen -> 5-card runout
  let st = nl.state();
  guard = 0;
  while (st.phase === "inHand" && guard++ < 20) {
    if (st.legalActions?.includes("raise") && st.betRange) nl.act("raise", st.betRange.max);
    else if (st.legalActions?.includes("call")) nl.act("call");
    else nl.act("check");
    st = nl.state();
  }
  check("NLHE: preflop all-in reports a 5-card runout at handEnded", st.phase === "handEnded" && st.runoutCards === 5, `runout=${st.runoutCards}`);
  check("NLHE: showdown hold covers the runout beats + reveal + pot move",
    handEndHoldMs(st) === Math.min(TIMING.maxHoldMs, 5 * TIMING.runoutCardMs + TIMING.nlheRevealMs + TIMING.potMoveMs), `${handEndHoldMs(st)}ms`);
  const fold = new GameManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 1000 }, { id: "b", name: "B", buyIn: 1000 }]);
  fold.start();
  fold.act("fold");
  check("NLHE: a fold-win holds briefly (no runout, no reveal)", handEndHoldMs(fold.state()) === TIMING.foldWinMs + TIMING.potMoveMs);
}

// ---------- 1E.1: sit out only after two WHOLE hands of inactivity; any action resets ----------
{
  const gm = new GameManager({ ...DEFAULT_CONFIG, actionTimeSec: 5 }, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }]);
  gm.start();
  const seatOf = (id: string) => gm.state().seats.find((x) => x.id === id)!;
  const play = (idleId: string) => { // idleId times out every turn; the other checks/calls
    let guard = 0;
    while (gm.state().phase === "inHand" && guard++ < 40) {
      const st = gm.state();
      const actor = st.seats.find((x) => x.seat === st.playerToAct);
      if (actor?.id === idleId) gm.timeout();
      else gm.act(st.legalActions!.includes("check") ? "check" : st.legalActions!.includes("call") ? "call" : "fold");
    }
  };
  play("b");
  check("NLHE: one idle hand does NOT sit a player out", seatOf("b").sittingOut === false && (gm.state().log.filter((l) => l.includes("timed out")).length >= 1));
  gm.dealNextHand(); play("b");
  check("NLHE: two whole idle hands sit the player out (from the next deal)", seatOf("b").sittingOut === true);
  check("NLHE: the sit-out is logged", gm.state().log.some((l) => l.includes("no action for two hands")));
  // the player comes back on their own
  gm.toggleSitOut("b", false);
  check("NLHE: toggleSitOut(false) clears the flag + counter", seatOf("b").sittingOut === false);
  gm.dealNextHand(); play("b"); // idle one hand again
  gm.dealNextHand();
  // this hand b uses the TIME BANK once — that is activity
  let guard = 0;
  while (gm.state().phase === "inHand" && guard++ < 40) {
    const st = gm.state();
    const actor = st.seats.find((x) => x.seat === st.playerToAct);
    if (actor?.id === "b") { gm.useTimeBank(); gm.timeout(); }
    else gm.act(st.legalActions!.includes("check") ? "check" : st.legalActions!.includes("call") ? "call" : "fold");
  }
  check("NLHE: time-bank use counts as activity — no sit-out after idle + bank hand", seatOf("b").sittingOut === false);

  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }], 9);
  dft.start();
  const dPlay = (idleSeat: number) => {
    let guard = 0;
    while (dft.phase() === "betting" && guard++ < 40) {
      if (dft.currentActor() === idleSeat) dft.bettingTimeout();
      else dft.act(dft.legal().actions.includes("check") ? "check" : "call");
    }
    if (dft.phase() === "picking") dft.pickingTimeout();
    if (dft.phase() === "decisions") dft.decisionsTimeout();
  };
  dPlay(1);
  check("DFT: one idle hand does NOT sit a player out", dft.state().seats[1].sittingOut === false);
  dft.dealNextHand(); dPlay(1);
  check("DFT: two whole idle hands sit the player out", dft.state().seats[1].sittingOut === true);
  // a LOCK counts as activity: seat 0 idles the betting but locks its split
  const dft2 = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }], 21);
  dft2.start();
  for (let h = 0; h < 2; h++) {
    if (h > 0) dft2.dealNextHand();
    let g = 0;
    while (dft2.phase() === "betting" && g++ < 40) {
      if (dft2.currentActor() === 0) dft2.bettingTimeout();
      else dft2.act(dft2.legal().actions.includes("check") ? "check" : "call");
    }
    if (dft2.phase() === "picking") { dft2.submitArrangement(0, [0, 1, 2, 3, 4, 5]); dft2.pickingTimeout(); }
    if (dft2.phase() === "decisions") dft2.decisionsTimeout();
  }
  check("DFT: locking a split counts as activity — no sit-out", dft2.state().seats[0].sittingOut === false);
}

// ---------- 1E.7: SHOW HANDS once the hand is over ----------
{
  const gm = new GameManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }]);
  gm.start();
  const st0 = gm.state();
  const folder = st0.playerToAct!;
  gm.act("fold");
  const st = gm.state();
  check("NLHE: after a fold-win both dealt-in seats may show (winner + folder)",
    st.phase === "handEnded" && (st.showableSeats?.length ?? 0) === 2 && st.showableSeats!.includes(folder));
  check("NLHE: nobody is face-up yet", st.seats.every((v) => v.empty || !v.revealed));
  gm.voluntaryShow(folder);
  const st2 = gm.state();
  check("NLHE: a folded player can show — cards go public, seat leaves showableSeats",
    st2.seats[folder].revealed === true && !st2.showableSeats!.includes(folder));
  check("NLHE: a second show by the same seat is a no-op", (gm.voluntaryShow(folder), gm.state().showableSeats!.length === 1));

  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }, { id: "c", name: "C", buyIn: 2000 }], 4);
  dft.start();
  dft.act("bet", 200);
  const dFolder = dft.currentActor()!;
  dft.act("fold");
  let guard = 0;
  while (dft.phase() === "betting" && guard++ < 40) dft.act(dft.legal().actions.includes("check") ? "check" : "call");
  if (dft.phase() === "picking") dft.pickingTimeout();
  if (dft.phase() === "decisions") dft.decisionsTimeout();
  const ds = dft.state();
  check("DFT: after a showdown only the folded seat may show", ds.phase === "handEnded" && JSON.stringify(ds.showableSeats) === JSON.stringify([dFolder]));
  check("DFT: the folder can't show mid-hand (rejected silently)", !dft.canShow(dFolder) === false); // handEnded now → allowed
  dft.voluntaryShow(dFolder);
  const ds2 = dft.state();
  check("DFT: the folded seat's six cards are face-up after showing", ds2.seats[dFolder].revealed === true && (ds2.seats[dFolder].holeCards?.length ?? 0) === 6 && ds2.seats[dFolder].arrangement === null);
}

console.log(failures === 0 ? "\nLIFECYCLE TESTS PASS ✅" : `\nLIFECYCLE TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
