import { GameManager } from "./shared/engine/manager";
import { DEFAULT_CONFIG } from "./shared/engine/types";

const gm = new GameManager(DEFAULT_CONFIG, [
  { id: "a", name: "A", buyIn: 1000 },
  { id: "b", name: "B", buyIn: 1000 },
  { id: "c", name: "C", buyIn: 2000 },
]);
const total0 = 4000;
gm.start();
let steps = 0;
function check(tag: string) {
  const st = gm.state();
  const stacks = st.seats.reduce((a, x) => a + x.stack, 0);
  const bets = st.seats.reduce((a, x) => a + x.betSize, 0);
  const pots = st.pots.reduce((a, p) => a + p.size, 0);
  if (stacks + bets + pots !== total0) {
    console.log(`LEAK [${tag}] phase=${st.phase} round=${st.round} stacks=${stacks} bets=${bets} pots=${pots} sum=${stacks+bets+pots}`);
    console.log("seats:", st.seats.map(s => `${s.name}: stack=${s.stack} bet=${s.betSize} inHand=${s.inHand} folded=${s.folded}`).join(" | "));
    console.log("log tail:", st.log.slice(-8).join(" // "));
    process.exit(1);
  }
}
while (steps++ < 2000) {
  const s = gm.state();
  if (s.phase === "handEnded") { gm.dealNextHand(); check("afterDeal"); continue; }
  if (s.phase !== "inHand" || !s.legalActions) break;
  const la = s.legalActions;
  if (la.includes("raise") && s.betRange && Math.random() < 0.3) gm.act("raise", s.betRange.min);
  else if (la.includes("call") && Math.random() < 0.7) gm.act("call");
  else if (la.includes("check")) gm.act("check");
  else if (la.includes("call")) gm.act("call");
  else gm.act("fold");
  check("afterAct");
}
console.log("no leak in", steps, "steps");
