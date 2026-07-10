import { GameManager } from "./shared/engine/manager";
import { DEFAULT_CONFIG } from "./shared/engine/types";

const gm = new GameManager(DEFAULT_CONFIG, [
  { id: "kabir", name: "Kabir", buyIn: 1000 },
  { id: "parth", name: "Parth", buyIn: 1000 },
  { id: "arjun", name: "Arjun", buyIn: 2000 },
  { id: "dev", name: "Dev", buyIn: 5000 },
]);
let total = 9000;
gm.start();
let steps = 0, hands = 0;
function check(tag: string) {
  const st = gm.state();
  const stacks = st.seats.reduce((a, x) => a + x.stack, 0);
  const bets = st.seats.reduce((a, x) => a + x.betSize, 0);
  const pots = st.pots.reduce((a, p) => a + p.size, 0);
  if (stacks + bets + pots !== total) {
    console.log(`LEAK [${tag}] hand=${hands} phase=${st.phase} round=${st.round} stacks=${stacks} bets=${bets} pots=${pots} sum=${stacks+bets+pots} expected=${total}`);
    console.log("seats:", st.seats.map(s => `${s.name}: stack=${s.stack} bet=${s.betSize} inHand=${s.inHand} out=${s.sittingOut}`).join(" | "));
    console.log("log:", st.log.slice(-10).join(" // "));
    process.exit(1);
  }
}
while (steps++ < 20000 && hands < 100) {
  const s = gm.state();
  if (s.phase === "handEnded") {
    for (const row of gm.ledger()) if (row.stack === 0 && Math.random() < 0.8) { gm.approveAddChips(row.id, 1000); total += 1000; check("rebuy"); }
    hands++; gm.dealNextHand(); check("deal"); continue;
  }
  if (s.phase !== "inHand" || !s.legalActions) break;
  if (Math.random() < 0.15) { gm.timeout(); check("timeout"); continue; }
  for (const seat of s.seats) if (seat.sittingOut) { gm.toggleSitOut(seat.id, false); check("sitin"); }
  const la = s.legalActions;
  const r = Math.random();
  if (la.includes("raise") && s.betRange && r < 0.25) gm.act("raise", Math.min(s.betRange.max, s.betRange.min * 2));
  else if (la.includes("bet") && s.betRange && r < 0.25) gm.act("bet", Math.max(s.betRange.min, Math.min(s.betRange.max, 400)));
  else if (la.includes("call") && r < 0.75) gm.act("call");
  else if (la.includes("check")) gm.act("check");
  else if (la.includes("call")) gm.act("call");
  else gm.act("fold");
  check("act");
}
console.log(`OK: ${hands} hands, ${steps} steps, no leak`);
