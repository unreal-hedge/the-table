// ============================================================
// ONLINE E2E TEST — three headless clients play real hands over
// the real wire against a running server (`npm run party:dev`).
//
// Proves, end to end (not just in-process like test-filter.ts):
//   1. join → host start → hands play → session end, all via messages
//   2. no client ever RECEIVES another player's un-revealed cards
//   3. an out-of-turn "act" is rejected ("Not your turn")
//   4. a non-host "host" command is rejected ("Host only")
//   5. the final ledger arrives and nets to zero
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-online.ts
// ============================================================

import type { GameState, SessionSummary } from "./shared/engine/types";
import type { ClientMessage, ServerMessage } from "./shared/protocol";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const ROOM = `e2e-${Date.now()}`; // fresh room per run — no stale state
const HANDS_TO_PLAY = 10;
const WATCHDOG_MS = 180_000;

function fail(msg: string): never {
  console.error(`ONLINE E2E FAIL: ${msg}`);
  process.exit(1);
}

class Bot {
  ws: WebSocket;
  seat: number | null = null;
  stripChecks = 0;   // opponent-cards-are-null assertions that fired
  ownCardChecks = 0; // own-cards-present assertions that fired
  gotEnded: SessionSummary | null = null;
  ledgerRows = 0;
  rejectionSeen = false; // the expected error for this bot's misbehavior test
  private misbehaved = false;

  constructor(
    public id: string,
    private opts: { isHost?: boolean; misbehave?: "act" | "host" | null }
  ) {
    this.ws = new WebSocket(`ws://${HOST}/parties/table-server/${ROOM}`);
    this.ws.addEventListener("open", () =>
      this.send({ type: "join", playerId: id })
    );
    this.ws.addEventListener("message", (e) => this.onMessage(String(e.data)));
    this.ws.addEventListener("error", () =>
      fail(`${id}: socket error — is the server running? (npm run party:dev)`)
    );
  }

  send(msg: ClientMessage) { this.ws.send(JSON.stringify(msg)); }

  private onMessage(raw: string) {
    const msg: ServerMessage = JSON.parse(raw);
    switch (msg.type) {
      case "state":  this.onState(msg.state); break;
      case "ledger": this.ledgerRows = msg.rows.length; break;
      case "ended":  this.gotEnded = msg.summary; break;
      case "error":
        // only the rejection we deliberately provoked is acceptable
        if (msg.msg === "Not your turn" || msg.msg === "Host only") {
          this.rejectionSeen = true;
        } else fail(`${this.id}: unexpected server error "${msg.msg}"`);
        break;
    }
  }

  private lastRebuyHand = 0;

  private onState(s: GameState) {
    this.seat = s.seats.find((x) => x.id === this.id)?.seat ?? null;

    // host tops up busted players between hands (once per hand end) —
    // without this, two bust-outs leave <2 eligible and the game
    // legitimately waits forever
    if (this.opts.isHost && s.phase === "handEnded" && s.handNumber > this.lastRebuyHand) {
      this.lastRebuyHand = s.handNumber;
      for (const seat of s.seats) {
        if (seat.stack === 0 && !seat.inHand) {
          this.send({ type: "host", cmd: { kind: "addChips", playerId: seat.id, amount: 2000 } });
        }
      }
    }

    // ---- THE core assertion: what arrived over the wire ----
    for (const seat of s.seats) {
      if (seat.id === this.id) {
        if (seat.inHand && (seat.holeCards?.length ?? 0) !== 2) {
          fail(`${this.id}: own cards missing while in hand #${s.handNumber}`);
        }
        if (seat.inHand) this.ownCardChecks++;
      } else if (!seat.revealed) {
        if (seat.holeCards !== null) {
          fail(`${this.id} RECEIVED ${seat.id}'s cards over the wire (hand #${s.handNumber}, phase ${s.phase})`);
        }
        this.stripChecks++;
      }
    }

    // ---- deliberate misbehavior (exactly once, after play begins) ----
    if (!this.misbehaved && s.phase === "inHand" && s.handNumber >= 2) {
      if (this.opts.misbehave === "act" && s.playerToAct !== this.seat) {
        this.misbehaved = true;
        this.send({ type: "act", action: "call" }); // not our turn — must bounce
      } else if (this.opts.misbehave === "host") {
        this.misbehaved = true;
        this.send({ type: "host", cmd: { kind: "pause" } }); // not a host — must bounce
      }
    }

    // ---- normal play: act when it's genuinely our turn ----
    // (the server pushes exactly one state per mutation, so "act once
    // per received state" cannot double-fire — no dedupe needed)
    if (s.phase !== "inHand" || s.playerToAct !== this.seat || !s.legalActions) return;

    const la = s.legalActions;
    const r = Math.random();
    if (la.includes("raise") && s.betRange && r < 0.2) {
      this.send({ type: "act", action: "raise", amount: s.betRange.min });
    } else if (la.includes("bet") && s.betRange && r < 0.2) {
      this.send({ type: "act", action: "bet", amount: s.betRange.min });
    } else if (la.includes("call") && r < 0.75) this.send({ type: "act", action: "call" });
    else if (la.includes("check")) this.send({ type: "act", action: "check" });
    else if (la.includes("call")) this.send({ type: "act", action: "call" });
    else this.send({ type: "act", action: "fold" });

    // host wraps up the session once enough hands are in the books
    if (this.opts.isHost && s.handNumber >= HANDS_TO_PLAY) {
      this.send({ type: "host", cmd: { kind: "end" } });
    }
  }
}

// ---- run ----
const kabir = new Bot("kabir", { isHost: true, misbehave: null });
const arjun = new Bot("arjun", { misbehave: "host" }); // will try a host command
const dev = new Bot("dev", { misbehave: "act" });      // will act out of turn
const bots = [kabir, arjun, dev];

setTimeout(() => {
  kabir.send({
    type: "host",
    cmd: {
      kind: "start",
      config: {
        smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000,
        minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30,
      },
      players: [
        { id: "kabir", name: "Kabir", buyIn: 2000 },
        { id: "arjun", name: "Arjun", buyIn: 2000 },
        { id: "dev", name: "Dev", buyIn: 2000 },
      ],
    },
  });
}, 1000);

const watchdog = setTimeout(
  () => fail(`timed out after ${WATCHDOG_MS / 1000}s — game stalled`),
  WATCHDOG_MS
);

const poll = setInterval(() => {
  if (!bots.every((b) => b.gotEnded)) return;
  clearInterval(poll);
  clearTimeout(watchdog);

  // final asserts
  const sum = kabir.gotEnded!;
  const net = sum.rows.reduce((a, r) => a + r.net, 0);
  if (net !== 0) fail(`ledger nets to ${net}, not 0`);
  if (sum.handsPlayed < HANDS_TO_PLAY) fail(`only ${sum.handsPlayed} hands played`);
  for (const b of bots) {
    if (b.stripChecks < 100) fail(`${b.id}: only ${b.stripChecks} strip checks — vacuous`);
    if (b.ownCardChecks < 20) fail(`${b.id}: only ${b.ownCardChecks} own-card checks`);
    if (b.ledgerRows !== 3) fail(`${b.id}: ledger rows ${b.ledgerRows} != 3`);
  }
  if (!dev.rejectionSeen) fail("dev's out-of-turn act was NOT rejected");
  if (!arjun.rejectionSeen) fail("arjun's host command was NOT rejected");

  console.log(`hands: ${sum.handsPlayed} · wire strip checks: ${bots.map((b) => `${b.id}=${b.stripChecks}`).join(" ")}`);
  console.log("out-of-turn act rejected ✅ · non-host command rejected ✅ · ledger nets 0 ✅");
  console.log("ONLINE E2E PASS ✅");
  bots.forEach((b) => b.ws.close());
  process.exit(0);
}, 250);
