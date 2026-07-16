// ============================================================
// DFT-over-the-wire E2E. Proves the server can host DFT hands, strip
// DFT secrets per viewer, switch game mode mid-session with a conserved
// ledger, and refuse an 8-player DFT table.
//
// Step 6b adds the anti-cheat core over the real wire: bots check to
// showdown, lock DISTINCT hand-splits, and declare run/surrender, and we
// assert no opponent's arrangement or declaration ever arrives before its
// simultaneous reveal (WHO-locked is public, WHAT-locked is not), plus
// wrong-mode guard rejections.
//
// Join order mirrors reality: the HOST connects + starts first (that
// registers everyone's keyword in the roster), THEN other players join.
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-online-dft.ts
// ============================================================

import type { GameState } from "./shared/engine/types";
import type { ClientMessage, HostCommand, ServerMessage, StartingPlayer } from "./shared/protocol";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const WS_SCHEME = /^(127\.0\.0\.1|localhost)/.test(HOST) ? "ws" : "wss";
const KEYWORDS: Record<string, string> = { kabir: "masala", arjun: "idli" };
const CONFIG = {
  smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000,
  minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30,
};
const PAIR: StartingPlayer[] = [
  { id: "kabir", name: "Kabir", buyIn: 2000, keyword: KEYWORDS.kabir },
  { id: "arjun", name: "Arjun", buyIn: 2000, keyword: KEYWORDS.arjun },
];

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
function fail(msg: string): never { console.error(`DFT E2E FAIL: ${msg}`); process.exit(1); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Bot {
  ws: WebSocket;
  seat: number | null = null;
  latest: GameState | null = null;
  stripOk = true;
  sawOwn6 = false;        // saw own 6 hole cards during a live DFT betting state
  sawFlopDepth = false;   // saw boards truncated to the flop (3 cards) mid-hand
  variantsSeen = new Set<string>();
  ledger: { id: string; buyInTotal: number; stack: number; net: number }[] = [];
  errors: string[] = [];

  // ---- DFT simultaneous-phase anti-cheat observations (Step 6b) ----
  showdown = false;          // behaviour flag: check-to-showdown + lock + declare
  arrStripOk = true;         // no opponent's UN-revealed arrangement ever arrived
  declStripOk = true;        // no opponent's BLIND declaration ever arrived
  sawPicking = false;
  sawDecisions = false;
  sawOwnArrangement = false;  // I can always see my OWN locked split
  sawLockedPublic = false;    // WHO has locked (lockedSeats) is public
  sawArrReveal = false;       // opponents' arrangements ARE visible after the picking reveal
  sawDeclReveal = false;      // declarations ARE visible once the hand ends
  sawStrippedArr = false;     // an opponent LOCKED (public) yet their split stayed hidden — non-vacuous
  sawStrippedDecl = false;    // an opponent DECLARED (public) yet their choice stayed hidden — non-vacuous
  order: number[];
  private arrHand = -1;
  private declared = new Set<string>();
  private q: ClientMessage[] = [];

  constructor(public id: string, room: string, showdown = false) {
    this.showdown = showdown;
    // a distinct (still-valid) permutation per bot so strip checks aren't vacuous
    this.order = id === "kabir" ? [1, 0, 3, 2, 5, 4] : [0, 1, 2, 3, 4, 5];
    this.ws = new WebSocket(`${WS_SCHEME}://${HOST}/parties/table-server/${room}`);
    this.ws.addEventListener("open", () => {
      this.send({ type: "join", playerId: this.id, keyword: KEYWORDS[this.id] ?? "kw" });
      for (const m of this.q) this.ws.send(JSON.stringify(m));
      this.q = [];
    });
    this.ws.addEventListener("message", (e) => this.onMsg(String(e.data)));
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }
  hostCmd(cmd: HostCommand) { this.send({ type: "host", cmd }); }

  private onMsg(raw: string) {
    const m: ServerMessage = JSON.parse(raw);
    if (m.type === "error") { this.errors.push(m.msg); return; }
    if (m.type === "ledger") { this.ledger = m.rows; return; }
    if (m.type !== "state") return;
    const s = m.state;
    this.latest = s;
    this.variantsSeen.add(s.variant);
    this.seat = s.seats.find((x) => x.id === this.id)?.seat ?? null;

    // ---- anti-cheat invariants, checked on EVERY received state ----
    const lockedPick = new Set(s.dft?.picking?.lockedSeats ?? []);
    const lockedDecl = new Set((s.dft?.decisions?.lockedSeats ?? []).map((l) => l.seat));
    for (const seat of s.seats) {
      if (seat.id === this.id) continue;
      // holeCards + arrangement ride the same reveal gate
      if (!seat.revealed && seat.holeCards !== null) this.stripOk = false;
      if (!seat.revealed && seat.arrangement != null) this.arrStripOk = false;
      if (seat.revealed && seat.arrangement != null) this.sawArrReveal = true;
      if (lockedPick.has(seat.seat) && !seat.revealed && seat.arrangement == null) this.sawStrippedArr = true;
      // declarations stay blind through the WHOLE decisions phase
      if (s.phase !== "handEnded" && seat.declarations !== undefined) this.declStripOk = false;
      if (s.phase === "handEnded" && seat.declarations !== undefined) this.sawDeclReveal = true;
      if (lockedDecl.has(seat.seat) && s.phase !== "handEnded" && seat.declarations === undefined) this.sawStrippedDecl = true;
    }

    // observe own 6 cards + flop-depth boards while a DFT hand is live
    if (s.variant === "dft" && s.dft?.subPhase === "betting") {
      const me = s.seats.find((x) => x.id === this.id);
      if ((me?.holeCards?.length ?? 0) === 6) this.sawOwn6 = true;
      if (s.round === "flop" && s.dft.boards.a.length === 3) this.sawFlopDepth = true;
    }

    if (this.showdown) this.driveShowdown(s);
    else this.driveFoldWin(s);
  }

  /** Default betting driver: opener bets the min, anyone facing a bet folds. */
  private driveFoldWin(s: GameState) {
    if (s.phase !== "inHand" || s.playerToAct !== this.seat || !s.legalActions) return;
    const la = s.legalActions;
    if (la.includes("bet") && s.betRange) this.send({ type: "act", action: "bet", amount: s.betRange.min });
    else if (la.includes("fold")) this.send({ type: "act", action: "fold" });
    else this.send({ type: "act", action: "check" });
  }

  /** DFT showdown driver: nobody bets (check to showdown), then lock a split
   *  and declare "run" — exercising the simultaneous phases over the wire. */
  private driveShowdown(s: GameState) {
    if (this.seat == null || s.variant !== "dft" || !s.dft) return;
    const seat = this.seat;
    if (s.dft.subPhase === "betting") {
      if (s.playerToAct !== seat || !s.legalActions) return;
      const la = s.legalActions;
      if (la.includes("check")) this.send({ type: "act", action: "check" });
      else if (la.includes("call")) this.send({ type: "act", action: "call" });
      else this.send({ type: "act", action: "fold" });
      return;
    }
    if (s.dft.subPhase === "picking" && s.dft.picking) {
      this.sawPicking = true;
      const pk = s.dft.picking;
      if (pk.lockedSeats.length > 0) this.sawLockedPublic = true;
      const me = s.seats.find((x) => x.seat === seat);
      if ((me?.arrangement?.length ?? 0) === 6) this.sawOwnArrangement = true;
      if (pk.seats.includes(seat) && !pk.lockedSeats.includes(seat) && this.arrHand !== s.handNumber) {
        this.arrHand = s.handNumber;
        this.send({ type: "submitArrangement", order: this.order });
      }
      return;
    }
    if (s.dft.subPhase === "decisions" && s.dft.decisions) {
      this.sawDecisions = true;
      for (const c of s.dft.decisions.contests) {
        if (!c.seats.includes(seat)) continue;
        const key = `${s.handNumber}:${c.potIndex}`;
        if (this.declared.has(key)) continue;
        this.declared.add(key);
        this.send({ type: "declare", potIndex: c.potIndex, decision: "run" });
      }
    }
  }
}

/** Host connects + starts (registers the roster), then the other seat joins. */
async function openRoom(
  room: string, gameMode: "nlhe" | "dft", showdown = false
): Promise<{ host: Bot; other: Bot }> {
  const host = new Bot("kabir", room, showdown);
  await wait(500);
  host.hostCmd({ kind: "start", gameMode, config: CONFIG, players: PAIR, disconnectGraceMs: 3000 });
  await wait(500);
  const other = new Bot("arjun", room, showdown);
  await wait(1200);
  return { host, other };
}

async function main() {
  const stamp = Date.now();

  // ---------- 1. DFT hands over the wire: variant, boards, stripping ----------
  {
    const { host, other } = await openRoom(`dfte2e-a-${stamp}`, "dft");
    check("DFT start: both clients see variant dft",
      host.variantsSeen.has("dft") && other.variantsSeen.has("dft"),
      `host=${[...host.variantsSeen]} other=${[...other.variantsSeen]}`);
    check("DFT state carries two boards", !!host.latest?.dft);
    await wait(12000); // several fold-win hands
    check("own seat sees its 6 hole cards during a live DFT hand", host.sawOwn6 && other.sawOwn6);
    check("boards start at flop depth (3 cards), not the full board", host.sawFlopDepth || other.sawFlopDepth);
    check("DFT hole cards stripped per viewer (no opponent cards on the wire)", host.stripOk && other.stripOk);
    const total = host.ledger.reduce((t, r) => t + r.stack, 0);
    check("DFT ledger conserves chips across hands", total === 4000, `stacks total ${total}`);
    host.ws.close(); other.ws.close();
  }

  // ---------- 2. mode switch NLHE -> DFT -> NLHE, ledger conserved ----------
  {
    const { host } = await openRoom(`dfte2e-b-${stamp}`, "nlhe");
    check("session starts in NLHE", host.latest?.variant === "nlhe");

    host.hostCmd({ kind: "setGameMode", mode: "dft" });
    await wait(9000); // past the current hand + auto-deal into the switched hand
    check("mode switch NLHE->DFT takes effect next hand", host.latest?.variant === "dft",
      `variant=${host.latest?.variant}`);

    host.hostCmd({ kind: "setGameMode", mode: "nlhe" });
    await wait(9000);
    check("mode switch DFT->NLHE takes effect next hand", host.latest?.variant === "nlhe",
      `variant=${host.latest?.variant}`);

    const total = host.ledger.reduce((t, r) => t + r.stack, 0);
    const net = host.ledger.reduce((t, r) => t + r.net, 0);
    check("ledger conserved across two mode switches", total === 4000 && net === 0, `total ${total} net ${net}`);
    host.ws.close();
  }

  // ---------- 3. 7-max refusal ----------
  {
    const host = new Bot("kabir", `dfte2e-c-${stamp}`);
    await wait(500);
    const eight: StartingPlayer[] = Array.from({ length: 8 }, (_, i) => ({
      id: i === 0 ? "kabir" : `p${i}`, name: i === 0 ? "Kabir" : `P${i}`,
      buyIn: 2000, keyword: i === 0 ? KEYWORDS.kabir : "kw",
    }));
    host.hostCmd({ kind: "start", gameMode: "dft", config: CONFIG, players: eight });
    await wait(1200);
    check("8-player DFT start refused with a 7-max message",
      host.errors.some((e) => e.includes("7 max")), host.errors.join(" | ") || "no error");
    host.ws.close();
  }

  // ---------- 4. simultaneous phases over the wire: the anti-cheat core ----------
  // Both bots check to showdown, lock DISTINCT splits, then declare "run".
  // We play hands until one reaches a 2-owed (heads-up) decisions phase, which
  // is the moment that proves the blind-declaration strip non-vacuously.
  {
    const { host, other } = await openRoom(`dfte2e-d-${stamp}`, "dft", true);
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await wait(500);
      if (host.sawStrippedDecl || other.sawStrippedDecl) { await wait(6000); break; } // let that hand end + reveal
    }
    check("reached the picking phase over the wire", host.sawPicking && other.sawPicking);
    check("each player sees their OWN locked split", host.sawOwnArrangement && other.sawOwnArrangement);
    check("WHO has locked a split is public (lockedSeats)", host.sawLockedPublic && other.sawLockedPublic);
    check("no opponent's split leaks before the reveal", host.arrStripOk && other.arrStripOk);
    check("an opponent locked yet their split stayed hidden (non-vacuous)", host.sawStrippedArr || other.sawStrippedArr);
    check("splits become visible to all after the picking reveal", host.sawArrReveal && other.sawArrReveal);
    check("reached the decisions phase over the wire", host.sawDecisions || other.sawDecisions);
    check("no opponent's run/surrender leaks while blind", host.declStripOk && other.declStripOk);
    check("an opponent declared yet their choice stayed hidden (non-vacuous)", host.sawStrippedDecl || other.sawStrippedDecl);
    check("declarations become visible to all once the hand ends", host.sawDeclReveal || other.sawDeclReveal);
    check("hole cards stay stripped through the whole showdown", host.stripOk && other.stripOk);
    const total = host.ledger.reduce((t, r) => t + r.stack, 0);
    check("ledger conserved across showdown hands", total === 4000, `stacks total ${total}`);
    host.ws.close(); other.ws.close();
  }

  // ---------- 5. wrong-mode guards: DFT-only messages refused in NLHE ----------
  {
    const { host, other } = await openRoom(`dfte2e-e-${stamp}`, "nlhe");
    host.errors = [];
    host.send({ type: "submitArrangement", order: [0, 1, 2, 3, 4, 5] });
    host.send({ type: "declare", potIndex: 0, decision: "run" });
    await wait(1000);
    const notAvail = host.errors.filter((e) => /not available/i.test(e)).length;
    check("submitArrangement + declare both refused in NLHE mode", notAvail >= 2, host.errors.join(" | ") || "no error");
    host.ws.close(); other.ws.close();
  }

  console.log(failures === 0 ? "\nDFT ONLINE E2E PASS ✅" : `\nDFT ONLINE E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

setTimeout(() => fail("watchdog: timed out"), 200_000);
main();
