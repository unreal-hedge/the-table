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

console.log(failures === 0 ? "\nLIFECYCLE TESTS PASS ✅" : `\nLIFECYCLE TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
