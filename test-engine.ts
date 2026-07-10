import { GameManager } from "./shared/engine/manager";
import { DEFAULT_CONFIG } from "./shared/engine/types";

const gm = new GameManager(DEFAULT_CONFIG, [
  { id: "kabir", name: "Kabir", buyIn: 1000 },
  { id: "parth", name: "Parth", buyIn: 1000 },
  { id: "arjun", name: "Arjun", buyIn: 2000 },
  { id: "dev", name: "Dev", buyIn: 5000 },
]);
let totalBoughtIn = 1000 + 1000 + 2000 + 5000;

gm.start();
let hands = 0;
let safety = 0;
while (hands < 200 && safety++ < 100000) {
  const s = gm.state();
  if (s.phase === "handEnded") {
    // random rebuys for busted players (host-approved, between hands)
    for (const row of gm.ledger()) {
      if (row.stack === 0 && Math.random() < 0.8) {
        gm.approveAddChips(row.id, 1000);
        totalBoughtIn += 1000;
      }
    }
    hands++;
    gm.dealNextHand();
    continue;
  }
  if (s.phase !== "inHand" || !s.legalActions) break;

  // occasionally simulate a timeout instead of acting
  if (Math.random() < 0.05) { gm.timeout(); continue; }
  // un-sit-out anyone who got auto-sat-out so the game keeps going
  for (const seat of s.seats) if (seat.sittingOut) gm.toggleSitOut(seat.id, false);

  const la = s.legalActions;
  const r = Math.random();
  if (la.includes("raise") && s.betRange && r < 0.25) {
    const amt = Math.min(
      s.betRange.max,
      Math.max(s.betRange.min, Math.floor(s.betRange.min * (1 + Math.random() * 3)))
    );
    gm.act("raise", amt);
  } else if (la.includes("bet") && s.betRange && r < 0.25) {
    gm.act("bet", Math.max(s.betRange.min, Math.min(s.betRange.max, 400)));
  } else if (la.includes("call") && r < 0.75) gm.act("call");
  else if (la.includes("check")) gm.act("check");
  else if (la.includes("call")) gm.act("call");
  else gm.act("fold");

  // INVARIANT: chips on table + stacks == total bought in, every step
  const st = gm.state();
  const stacks = st.seats.reduce((a, x) => a + x.stack, 0);
  const total = stacks + st.totalPot; // totalPot = pots + live bets + dead (folded) bets
  if (total !== totalBoughtIn) {
    console.error(`CHIP LEAK at hand ${hands}: ${total} != ${totalBoughtIn}`);
    process.exit(1);
  }
}

const ledger = gm.ledger();
const netSum = ledger.reduce((a, r) => a + r.net, 0);
const stackSum = ledger.reduce((a, r) => a + r.stack, 0);
console.log(`hands played: ${hands}`);
console.log(`ledger:`, ledger.map(r => `${r.name}: in ${r.buyInTotal} stack ${r.stack} net ${r.net}`).join(" | "));
console.log(`net sum (must be 0): ${netSum}`);
console.log(`stacks (must equal ${totalBoughtIn}): ${stackSum}`);
if (netSum !== 0 || stackSum !== totalBoughtIn) { console.error("LEDGER DRIFT"); process.exit(1); }
console.log("ALL INVARIANTS PASS ✅");
