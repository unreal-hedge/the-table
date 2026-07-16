// ============================================================
// DFT-over-the-wire E2E (Step 6 C3). Proves the server can host DFT
// hands, strip DFT hole cards per viewer, switch game mode mid-session
// with a conserved ledger, and refuse an 8-player DFT table.
//
// Interactive picking/decisions (submitArrangement/declare) land in C4;
// here bots end hands in the betting round (opener bets, others fold), so
// no 30s showdown window is needed. Full showdown-over-wire is a C4 test.
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
  private q: ClientMessage[] = [];

  constructor(public id: string, room: string) {
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
    // anti-cheat: another seat's un-revealed hole cards must never arrive
    for (const seat of s.seats) {
      if (seat.id !== this.id && !seat.revealed && seat.holeCards !== null) this.stripOk = false;
    }
    // observe own 6 cards + flop-depth boards while a DFT hand is live
    if (s.variant === "dft" && s.dft?.subPhase === "betting") {
      const me = s.seats.find((x) => x.id === this.id);
      if ((me?.holeCards?.length ?? 0) === 6) this.sawOwn6 = true;
      if (s.round === "flop" && s.dft.boards.a.length === 3) this.sawFlopDepth = true;
    }
    // drive betting: opener bets the min; anyone facing a bet folds -> fold-win
    if (s.phase !== "inHand" || s.playerToAct !== this.seat || !s.legalActions) return;
    const la = s.legalActions;
    if (la.includes("bet") && s.betRange) this.send({ type: "act", action: "bet", amount: s.betRange.min });
    else if (la.includes("fold")) this.send({ type: "act", action: "fold" });
    else this.send({ type: "act", action: "check" });
  }
}

/** Host connects + starts (registers the roster), then the other seat joins. */
async function openRoom(room: string, gameMode: "nlhe" | "dft"): Promise<{ host: Bot; other: Bot }> {
  const host = new Bot("kabir", room);
  await wait(500);
  host.hostCmd({ kind: "start", gameMode, config: CONFIG, players: PAIR, disconnectGraceMs: 3000 });
  await wait(500);
  const other = new Bot("arjun", room);
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

  console.log(failures === 0 ? "\nDFT ONLINE E2E PASS ✅" : `\nDFT ONLINE E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

setTimeout(() => fail("watchdog: timed out"), 120_000);
main();
