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

console.log(failures === 0 ? "\nLIFECYCLE TESTS PASS ✅" : `\nLIFECYCLE TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
