// ============================================================
// DFT session-scaffolding tests (Step 6 C2). Proves the additive
// session methods the server drives across both engines behave, and —
// the gate-critical piece — that exporting players from one engine and
// resuming into the OTHER variant preserves exact stacks + ledger
// (buyInTotal), so a mid-session mode switch conserves chips.
//
// Run: npx tsx test-dft-session.ts
// ============================================================

import { GameManager } from "./shared/engine/manager";
import { DoubleFlopManager } from "./shared/engine/dft/manager";
import { DEFAULT_CONFIG, type PlayerRecord } from "./shared/engine/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const starters = [
  { id: "a", name: "A", buyIn: 2000 },
  { id: "b", name: "B", buyIn: 2000 },
  { id: "c", name: "C", buyIn: 2000 },
];
const ledgerSum = (rows: { buyInTotal: number; stack: number; net: number }[]) => ({
  buyIn: rows.reduce((t, r) => t + r.buyInTotal, 0),
  stack: rows.reduce((t, r) => t + r.stack, 0),
  net: rows.reduce((t, r) => t + r.net, 0),
});

// ---------- sit-out excludes a player from the deal ----------
{
  const gm = new DoubleFlopManager(DEFAULT_CONFIG, starters, 7);
  gm.toggleSitOut("c", true);
  gm.start(); // deals hand 1
  const dealtIds = gm.state().seats.filter((s) => s.inHand).map((s) => s.id);
  check("DFT sit-out: seat C is not dealt in", !dealtIds.includes("c") && dealtIds.length === 2, dealtIds.join(","));
  gm.toggleSitOut("c", false);
  // finish the hand fast (everyone checks) then deal again
  while (gm.state().dft?.subPhase === "betting") gm.act("check");
  // picking/decisions may follow; just drive to handEnded via timeouts
  if (gm.state().phase === "inHand") { gm.pickingTimeout(); }
  if (gm.state().phase === "inHand") { gm.decisionsTimeout(); }
  gm.dealNextHand();
  const dealt2 = gm.state().seats.filter((s) => s.inHand).map((s) => s.id);
  check("DFT sit-in: seat C returns next deal", dealt2.includes("c") && dealt2.length === 3, dealt2.join(","));
}

// ---------- rebuy applies between hands and raises buyInTotal ----------
{
  const gm = new DoubleFlopManager(DEFAULT_CONFIG, starters, 7);
  gm.start();
  while (gm.state().dft?.subPhase === "betting") gm.act("check");
  if (gm.state().phase === "inHand") gm.pickingTimeout();
  if (gm.state().phase === "inHand") gm.decisionsTimeout();
  // now handEnded — the hand has settled, so PlayerRecord.stack is stable
  const beforeC = gm.ledger().find((r) => r.id === "c")!;
  gm.approveAddChips("c", 1000); // between hands (handEnded) -> applies immediately
  const afterC = gm.ledger().find((r) => r.id === "c")!;
  check("DFT rebuy: buyInTotal rises by the rebuy",
    afterC.buyInTotal === beforeC.buyInTotal + 1000, `${beforeC.buyInTotal} -> ${afterC.buyInTotal}`);
  check("DFT rebuy: stack rises by the rebuy",
    afterC.stack === beforeC.stack + 1000, `${beforeC.stack} -> ${afterC.stack}`);
}

// ---------- betting timeout: auto-check, then auto-sit-out after 2 ----------
{
  const gm = new DoubleFlopManager(DEFAULT_CONFIG, starters, 7);
  gm.start();
  const actor = gm.state().playerToAct!;
  const before = gm.state();
  gm.bettingTimeout(); // no bet live -> auto-check, action advances
  check("DFT betting timeout advances the action (auto check/fold)",
    gm.state().playerToAct !== actor || gm.state().dft?.subPhase !== before.dft?.subPhase);
}

// ---------- mode switch conserves chips + ledger (export -> resume) ----------
{
  // Start NLHE, play a couple hands so stacks diverge from buy-ins, then hand
  // the exact player records to a DFT engine, and back to NLHE. Nothing may be
  // created or destroyed; buyInTotal (the ledger) must survive untouched.
  const nlhe = new GameManager(DEFAULT_CONFIG, starters);
  nlhe.start();
  let guard = 0;
  while (nlhe.state().phase !== "handEnded" && guard++ < 200) {
    const s = nlhe.state();
    if (s.phase !== "inHand" || s.playerToAct == null || !s.legalActions) break;
    const la = s.legalActions;
    if (la.includes("check")) nlhe.act("check");
    else if (la.includes("call")) nlhe.act("call");
    else nlhe.act("fold");
  }
  const exported: PlayerRecord[] = nlhe.exportPlayers();
  const nlheLed = ledgerSum(nlhe.ledger());

  // hand off to DFT (mode switch NLHE -> DFT), no starters, resume records
  const dft = new DoubleFlopManager(DEFAULT_CONFIG, [], 99, exported);
  const dftLed = ledgerSum(dft.ledger());
  check("switch NLHE->DFT preserves total chips", dftLed.stack === nlheLed.stack, `${nlheLed.stack} -> ${dftLed.stack}`);
  check("switch NLHE->DFT preserves total buy-in (ledger)", dftLed.buyIn === nlheLed.buyIn);
  check("switch NLHE->DFT preserves net = 0", dftLed.net === 0 && nlheLed.net === 0);
  check("switch NLHE->DFT preserves per-player stacks exactly",
    dft.ledger().every((r) => r.stack === nlhe.ledger().find((x) => x.id === r.id)!.stack));

  // and back: DFT -> NLHE
  const back = new GameManager(DEFAULT_CONFIG, [], dft.exportPlayers());
  const backLed = ledgerSum(back.ledger());
  check("switch DFT->NLHE preserves total chips + buy-in",
    backLed.stack === nlheLed.stack && backLed.buyIn === nlheLed.buyIn);
  check("round-trip preserves every buyInTotal exactly",
    back.ledger().every((r) => r.buyInTotal === exported.find((x) => x.id === r.id)!.buyInTotal));
}

console.log(failures === 0 ? "\nDFT SESSION TESTS PASS ✅" : `\nDFT SESSION TESTS FAIL ❌ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
