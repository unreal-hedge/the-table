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
import { DEFAULT_CONFIG } from "./shared/engine/types";
import { filterStateFor } from "./party/filter";

const gm = new GameManager(DEFAULT_CONFIG, [
  { id: "kabir", name: "Kabir", buyIn: 2000 },
  { id: "parth", name: "Parth", buyIn: 2000 },
  { id: "arjun", name: "Arjun", buyIn: 3000 },
  { id: "dev", name: "Dev", buyIn: 5000 },
]);

let strippedChecks = 0;  // hidden-card assertions that actually fired
let revealChecks = 0;    // showdown-visibility assertions that fired

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

console.log(`hands: ${hands} · hidden-card strips verified: ${strippedChecks} · showdown reveals verified: ${revealChecks}`);
console.log("FILTER: NO LEAKS ✅");
