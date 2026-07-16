// ============================================================
// CARD-STRIPPING TEST — proves the acceptance criterion for
// Phase 1B Step 3: what the server sends a player must NEVER
// contain another player's un-revealed hole cards.
//
// Drives ~80 random hands through a real GameManager and, after
// EVERY single action, filters the state for every viewer (each
// seat + a spectator) and asserts:
//   1. other seats' cards are stripped unless the engine marked
//      them `revealed` (showdown / voluntary show),
//   2. your own cards always survive filtering,
//   3. at showdown, revealed cards ARE visible to everyone
//      (stripping must not break legitimate reveals).
//
// Run: npx tsx test-filter.ts   (alongside test-engine.ts)
// ============================================================

import { GameManager } from "./shared/engine/manager";
import { DoubleFlopManager } from "./shared/engine/dft/manager";
import { DEFAULT_CONFIG } from "./shared/engine/types";
import type { Card } from "./shared/engine/types";
import { filterStateFor } from "./party/filter";

const gm = new GameManager(DEFAULT_CONFIG, [
  { id: "kabir", name: "Kabir", buyIn: 2000 },
  { id: "parth", name: "Parth", buyIn: 2000 },
  { id: "arjun", name: "Arjun", buyIn: 3000 },
  { id: "dev", name: "Dev", buyIn: 5000 },
]);

let strippedChecks = 0;  // hidden-card assertions that actually fired
let revealChecks = 0;    // showdown-visibility assertions that fired
let ownCardChecks = 0;   // own-cards-PRESENT assertions that fired (not just truth-equality)

function fail(msg: string): never {
  console.error(`FILTER LEAK: ${msg}`);
  process.exit(1);
}

/** The core assertion battery, run at every step for every viewer. */
function checkAllViews() {
  const truth = gm.state();
  const viewers: (number | null)[] = [...truth.seats.map((s) => s.seat), null];

  for (const viewer of viewers) {
    const view = filterStateFor(truth, viewer);
    for (const seat of view.seats) {
      const real = truth.seats.find((r) => r.seat === seat.seat)!;
      if (seat.seat === viewer) {
        // (2) own cards must survive exactly
        if (JSON.stringify(seat.holeCards) !== JSON.stringify(real.holeCards)) {
          fail(`viewer ${viewer} lost their own cards`);
        }
        // (2b) and must actually BE THERE while in a hand — equality with
        // truth is vacuous if both are null (the bug class Kabir hit)
        if (real.inHand) {
          if (!seat.holeCards || seat.holeCards.length !== 2) {
            fail(`viewer ${viewer} is in hand #${truth.handNumber} but their own filtered cards are missing`);
          }
          ownCardChecks++;
        }
      } else if (real.revealed) {
        // (3) legitimate reveals stay visible
        if (JSON.stringify(seat.holeCards) !== JSON.stringify(real.holeCards)) {
          fail(`revealed seat ${seat.seat} hidden from viewer ${viewer}`);
        }
        if (real.holeCards) revealChecks++;
      } else {
        // (1) everyone else is stripped — the whole point
        if (seat.holeCards !== null) {
          fail(
            `viewer ${String(viewer)} can see seat ${seat.seat}'s cards ` +
            `(phase ${truth.phase}, hand #${truth.handNumber})`
          );
        }
        if (real.holeCards) strippedChecks++; // only count real hidden cards
      }
    }
  }
}

// ---- random driver (same shape as test-engine.ts) ----
let hands = 0;
let safety = 0;
gm.start();
checkAllViews();

while (hands < 80 && safety++ < 50000) {
  const s = gm.state();
  if (s.phase === "handEnded") {
    // exercise the voluntary-show path when it's on offer
    if (s.canShowSeat != null && Math.random() < 0.5) {
      gm.voluntaryShow(s.canShowSeat);
      checkAllViews();
    }
    for (const row of gm.ledger()) {
      if (row.stack === 0 && Math.random() < 0.8) gm.approveAddChips(row.id, 2000);
    }
    hands++;
    gm.dealNextHand();
    checkAllViews();
    continue;
  }
  if (s.phase !== "inHand" || !s.legalActions) break;
  for (const seat of s.seats) if (seat.sittingOut) gm.toggleSitOut(seat.id, false);

  const la = s.legalActions;
  const r = Math.random();
  if (la.includes("raise") && s.betRange && r < 0.25) {
    const amt = Math.min(s.betRange.max, Math.max(s.betRange.min, Math.floor(s.betRange.min * (1 + Math.random() * 3))));
    gm.act("raise", amt);
  } else if (la.includes("bet") && s.betRange && r < 0.25) {
    gm.act("bet", Math.max(s.betRange.min, Math.min(s.betRange.max, 400)));
  } else if (la.includes("call") && r < 0.7) gm.act("call");
  else if (la.includes("check")) gm.act("check");
  else if (la.includes("call")) gm.act("call");
  else gm.act("fold");

  checkAllViews(); // after EVERY action
}

// The test must not pass vacuously: prove both branches really ran.
if (hands < 80) fail(`only ${hands} hands played — driver stalled`);
if (strippedChecks < 1000) fail(`too few strip checks fired (${strippedChecks})`);
if (revealChecks < 50) fail(`too few showdown reveal checks fired (${revealChecks})`);
if (ownCardChecks < 500) fail(`too few own-cards-present checks fired (${ownCardChecks})`);

console.log(`NLHE — hands: ${hands} · hidden-card strips: ${strippedChecks} · showdown reveals: ${revealChecks} · own cards present: ${ownCardChecks}`);

// ============================================================
// DOUBLE FLOP TEX — the two secrets NLHE doesn't have:
//   arrangement (the hand-split) rides the SAME reveal gate as
//   holeCards; declarations (run/surrender) stay blind through the
//   WHOLE decisions phase and go public only at handEnded.
//
// We craft one hand that forces a heads-up flip contest (board A
// won outright by seat 0, board B by seat 1) so BOTH seats owe a
// run/surrender decision — the only way to exercise the declaration
// gate. Then we inspect the filter at picking / decisions / ended.
// ============================================================

const C = (rank: Card["rank"], suit: Card["suit"]): Card => ({ rank, suit });
// seat 0: AA plays board A (crushes it); 34 plays board B (whiffs); tex = 89.
const HOLE0: Card[] = [C("A", "clubs"), C("A", "diamonds"), C("3", "diamonds"), C("4", "diamonds"), C("8", "diamonds"), C("9", "diamonds")];
// seat 1: 34 whiffs board A; KK trips board B (crushes it); tex = TJ.
const HOLE1: Card[] = [C("3", "clubs"), C("4", "clubs"), C("K", "spades"), C("K", "hearts"), C("T", "diamonds"), C("J", "diamonds")];
const BOARDS = {
  a: [C("2", "clubs"), C("5", "diamonds"), C("9", "spades"), C("J", "hearts"), C("Q", "diamonds")], // AA (seat 0) beats Q-high (seat 1)
  b: [C("6", "spades"), C("7", "diamonds"), C("8", "clubs"), C("T", "hearts"), C("K", "diamonds")], // KKK (seat 1) beats K-high (seat 0)
};

let dftArrStrips = 0;   // "other seat's arrangement is hidden" assertions that fired
let dftArrReveals = 0;  // "revealed arrangement is visible to all" assertions that fired
let dftDeclStrips = 0;  // "other seat's declaration is hidden" assertions that fired
let dftDeclReveals = 0; // "declaration visible to all once hand ends" assertions that fired

const dft = new DoubleFlopManager(
  { ...DEFAULT_CONFIG, bigBlind: 200 },
  [{ id: "a", name: "A", buyIn: 2000 }, { id: "b", name: "B", buyIn: 2000 }],
  1, // fixed seed — no rng consumed before the decisions phase anyway (both boards outright)
);

/** After each declare/submit the LAST seat may finalize the hand, so we
 *  inspect the FILTERED views for every viewer at a chosen moment. */
function dftCheck(momentLabel: string, expect: {
  cardsHidden: boolean;   // picking: hole+arrangement stripped for others
  declsPresent: boolean;  // is there at least one declaration on the books?
}) {
  const truth = dft.state();
  const viewers: (number | null)[] = [0, 1, null];
  for (const viewer of viewers) {
    const view = filterStateFor(truth, viewer);
    for (const seat of view.seats) {
      const real = truth.seats.find((r) => r.seat === seat.seat)!;
      const isOwner = seat.seat === viewer;

      // ---- arrangement (rides the holeCards reveal gate) ----
      if (!isOwner && real.arrangement != null) {
        if (real.revealed) {
          if (JSON.stringify(seat.arrangement) !== JSON.stringify(real.arrangement)) {
            fail(`[${momentLabel}] revealed arrangement of seat ${seat.seat} hidden from viewer ${String(viewer)}`);
          }
          dftArrReveals++;
        } else {
          if (seat.arrangement != null) {
            fail(`[${momentLabel}] viewer ${String(viewer)} can see seat ${seat.seat}'s UN-revealed arrangement`);
          }
          dftArrStrips++;
        }
      }
      if (isOwner && real.arrangement != null && JSON.stringify(seat.arrangement) !== JSON.stringify(real.arrangement)) {
        fail(`[${momentLabel}] viewer ${String(viewer)} lost their OWN arrangement`);
      }

      // ---- declarations (blind through the whole decisions phase) ----
      if (!isOwner && real.declarations && real.declarations.length) {
        if (truth.phase === "handEnded") {
          if (JSON.stringify(seat.declarations) !== JSON.stringify(real.declarations)) {
            fail(`[${momentLabel}] ended-hand declaration of seat ${seat.seat} hidden from viewer ${String(viewer)}`);
          }
          dftDeclReveals++;
        } else {
          if (seat.declarations !== undefined) {
            fail(`[${momentLabel}] viewer ${String(viewer)} can see seat ${seat.seat}'s BLIND declaration`);
          }
          dftDeclStrips++;
        }
      }
      if (isOwner && real.declarations && JSON.stringify(seat.declarations) !== JSON.stringify(real.declarations)) {
        fail(`[${momentLabel}] viewer ${String(viewer)} lost their OWN declaration`);
      }
    }
  }
  // sanity: the moment is the one we think it is
  if (expect.cardsHidden && truth.seats.some((s) => s.revealed)) {
    fail(`[${momentLabel}] expected no reveals yet, but a seat is revealed`);
  }
  const anyDecl = truth.seats.some((s) => s.declarations && s.declarations.length);
  if (expect.declsPresent !== anyDecl) {
    fail(`[${momentLabel}] expected declarations present=${expect.declsPresent}, saw ${anyDecl}`);
  }
}

dft.dealNextHand({ hole: new Map([[0, HOLE0], [1, HOLE1]]), boards: BOARDS });
// drive betting: nobody bets, both check every round → reach picking
let dftSafety = 0;
while (dft.phase() === "betting" && dftSafety++ < 100) {
  const legal = dft.legal();
  dft.act(legal.actions.includes("check") ? "check" : "call");
}
if (dft.phase() !== "picking") fail(`expected picking, got ${dft.phase()}`);

// seat 0 locks a NON-default split (within-pair swaps: same hands, different
// order array) so the strip assertion isn't vacuous; seat 1 stays default.
dft.submitArrangement(0, [1, 0, 3, 2, 5, 4]);
if (dft.phase() !== "picking") fail("picking ended before seat 1 locked");
dftCheck("picking", { cardsHidden: true, declsPresent: false });

dft.submitArrangement(1, [0, 1, 2, 3, 4, 5]);
if (dft.phase() !== "decisions") fail(`expected decisions (forced heads-up), got ${dft.phase()}`);

// seat 0 declares first → still decisions, one BLIND declaration on the books
dft.declare(0, 0, "run");
if (dft.phase() !== "decisions") fail("decisions ended before seat 1 declared");
dftCheck("decisions", { cardsHidden: false, declsPresent: true });

// seat 1 declares → hand finalizes; declarations become public
dft.declare(1, 0, "run");
if (dft.phase() !== "handEnded") fail(`expected handEnded, got ${dft.phase()}`);
dftCheck("handEnded", { cardsHidden: false, declsPresent: true });

if (dftArrStrips < 2) fail(`too few DFT arrangement strips fired (${dftArrStrips})`);
if (dftArrReveals < 2) fail(`too few DFT arrangement reveals fired (${dftArrReveals})`);
if (dftDeclStrips < 2) fail(`too few DFT declaration strips fired (${dftDeclStrips})`);
if (dftDeclReveals < 2) fail(`too few DFT declaration reveals fired (${dftDeclReveals})`);

console.log(`DFT  — arrangement strips: ${dftArrStrips} · reveals: ${dftArrReveals} · declaration strips: ${dftDeclStrips} · reveals: ${dftDeclReveals}`);
console.log("FILTER: NO LEAKS ✅");
