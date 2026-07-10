// ============================================================
// ONLINE E2E TEST — headless clients play real hands over the
// real wire against a running server (`npm run party:dev`).
//
// Proves, end to end (not just in-process like test-filter.ts):
//   1. claim → keyword login → host start → hands → session end
//   2. no client ever RECEIVES another player's un-revealed cards
//   3. an out-of-turn "act" is rejected ("Not your turn")
//   4. a non-host "host" command is rejected ("Host only")
//   5. wrong keyword AND unknown player get the IDENTICAL
//      "Invalid login" (no username probing), and no game data
//   6. correct keyword from a NEW device takes the seat over
//      mid-hand; the old connection is kicked and goes silent
//   7. the final ledger arrives and nets to zero
//   8. the SERVER owns the clock: a bot that goes silent on its turn
//      is auto-acted within actionTimeSec + grace (Step 6)
//   9. timeBank: the actor can extend their deadline; anyone else
//      gets "Not your turn"
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-online.ts
// ============================================================

import type { GameState, SessionSummary } from "./shared/engine/types";
import type { ClientMessage, ServerMessage } from "./shared/protocol";
import { INVALID_LOGIN } from "./shared/protocol";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const ROOM = `e2e-${Date.now()}`; // fresh room per run — no stale state
const HANDS_TO_PLAY = 10;
const TAKEOVER_AT_HAND = 3;
const TIMEBANK_AT_HAND = 4;   // arjun extends his clock once
const GO_SILENT_AT_HAND = 5;  // dev2 skips a turn — server must time him out
const ACTION_TIME_SEC = 5;    // short clock so the timeout test stays fast
const WATCHDOG_MS = 180_000;

let timeoutObserved = false;  // any state's log shows a server-forced action

const KEYWORDS: Record<string, string> = {
  kabir: "masala", arjun: "idli", dev: "dosa",
};

function fail(msg: string): never {
  console.error(`ONLINE E2E FAIL: ${msg}`);
  process.exit(1);
}

function wsUrl() { return `ws://${HOST}/parties/table-server/${ROOM}`; }

class Bot {
  ws: WebSocket;
  seat: number | null = null;
  stripChecks = 0;   // opponent-cards-are-null assertions that fired
  ownCardChecks = 0; // own-cards-present assertions that fired
  gotEnded: SessionSummary | null = null;
  ledgerRows = 0;
  kicked = false;
  statesAfterKick = 0;
  latestHand = 0;
  rejectionSeen = false; // the expected error for this bot's misbehavior test
  private misbehaved = false;
  private lastRebuyHand = 0;

  private usedTimeBank = false;
  private tbDeadlineBefore: number | null = null;
  timeBankExtended = false;
  private wentSilent = false;

  constructor(
    public id: string,
    public label: string, // "dev1"/"dev2" — two bots may share an id
    private opts: {
      isHost?: boolean;
      misbehave?: "act" | "host" | "timebank" | null;
      useTimeBank?: boolean;  // legit +30s on own turn at TIMEBANK_AT_HAND
      goSilent?: boolean;     // skip one turn at GO_SILENT_AT_HAND — server must act
    }
  ) {
    this.ws = new WebSocket(wsUrl());
    this.ws.addEventListener("open", () =>
      this.send({ type: "join", playerId: id, keyword: KEYWORDS[id] })
    );
    this.ws.addEventListener("message", (e) => this.onMessage(String(e.data)));
    this.ws.addEventListener("error", () => {
      if (!this.kicked) fail(`${this.label}: socket error — is the server running?`);
    });
  }

  send(msg: ClientMessage) { this.ws.send(JSON.stringify(msg)); }

  private onMessage(raw: string) {
    const msg: ServerMessage = JSON.parse(raw);
    if (this.kicked) {
      // a kicked connection must go silent — receiving game state here
      // would mean two live connections share one seat
      if (msg.type === "state") this.statesAfterKick++;
      return;
    }
    switch (msg.type) {
      case "state":  this.onState(msg.state); break;
      case "ledger": this.ledgerRows = msg.rows.length; break;
      case "ended":  this.gotEnded = msg.summary; break;
      case "kicked": this.kicked = true; break;
      case "error":
        if (msg.msg === "Not your turn" || msg.msg === "Host only") {
          this.rejectionSeen = true;
        } else fail(`${this.label}: unexpected server error "${msg.msg}"`);
        break;
    }
  }

  private onState(s: GameState) {
    this.seat = s.seats.find((x) => x.id === this.id)?.seat ?? null;
    this.latestHand = s.handNumber;
    if (s.log.some((l) => l.includes("timed out — auto"))) timeoutObserved = true;

    // host tops up busted players between hands (once per hand end) —
    // without this, two bust-outs leave <2 eligible and the game
    // legitimately waits forever
    if (this.opts.isHost && s.phase === "handEnded" && s.handNumber > this.lastRebuyHand) {
      this.lastRebuyHand = s.handNumber;
      for (const seat of s.seats) {
        if (seat.stack === 0) {
          this.send({ type: "host", cmd: { kind: "addChips", playerId: seat.id, amount: 2000 } });
        }
      }
    }

    // ---- THE core assertion: what arrived over the wire ----
    for (const seat of s.seats) {
      if (seat.id === this.id) {
        if (seat.inHand && (seat.holeCards?.length ?? 0) !== 2) {
          fail(`${this.label}: own cards missing while in hand #${s.handNumber}`);
        }
        if (seat.inHand) this.ownCardChecks++;
      } else if (!seat.revealed) {
        if (seat.holeCards !== null) {
          fail(`${this.label} RECEIVED ${seat.id}'s cards over the wire (hand #${s.handNumber}, phase ${s.phase})`);
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
      } else if (this.opts.misbehave === "timebank" && s.playerToAct !== this.seat) {
        this.misbehaved = true;
        this.send({ type: "timeBank" }); // not our clock — must bounce
      }
    }

    // ---- normal play: act when it's genuinely our turn ----
    // (the server pushes exactly one state per mutation, so "act once
    // per received state" cannot double-fire — no dedupe needed)
    if (s.phase !== "inHand" || s.playerToAct !== this.seat || !s.legalActions) return;

    // timeBank verification: the post-timeBank state must show a later deadline
    if (this.tbDeadlineBefore != null && s.turnDeadlineAt != null) {
      if (s.turnDeadlineAt > this.tbDeadlineBefore) this.timeBankExtended = true;
      this.tbDeadlineBefore = null;
      // fall through and act on the extended clock
    } else if (this.opts.useTimeBank && !this.usedTimeBank && s.handNumber >= TIMEBANK_AT_HAND) {
      this.usedTimeBank = true;
      this.tbDeadlineBefore = s.turnDeadlineAt;
      this.send({ type: "timeBank" }); // legit: it IS our turn
      return; // act on the next state, which must carry the extended deadline
    }

    // go silent once: say nothing and let the SERVER's clock act for us
    if (this.opts.goSilent && !this.wentSilent && s.handNumber >= GO_SILENT_AT_HAND) {
      this.wentSilent = true;
      return;
    }

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

// ---- mallory: login probing (condition 5) ----
// One socket, two bad attempts: wrong keyword for a REAL player, then
// any keyword for a GHOST player. Responses must be identical, and she
// must never receive an ounce of game data.
const malloryErrors: string[] = [];
let malloryLeaked = false;
function runMallory() {
  const ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", playerId: "arjun", keyword: "totally-wrong" }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "join", playerId: "ghost-player", keyword: "whatever" }));
    }, 500);
  });
  ws.addEventListener("message", (e) => {
    const msg: ServerMessage = JSON.parse(String(e.data));
    if (msg.type === "error") malloryErrors.push(msg.msg);
    // the pre-login "you" handshake carries no identity; anything else does
    else if (msg.type !== "you" || msg.playerId !== "") malloryLeaked = true;
  });
}

// ---- run ----
const kabir = new Bot("kabir", "kabir", { isHost: true, misbehave: "timebank" });
const bots: Bot[] = [kabir];
let arjun: Bot, dev1: Bot, dev2: Bot | null = null;

// kabir claims the fresh room first; roster exists only after his start
setTimeout(() => {
  kabir.send({
    type: "host",
    cmd: {
      kind: "start",
      config: {
        smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000,
        minBuyIn: 500, maxBuyIn: 50000,
        actionTimeSec: ACTION_TIME_SEC, timeBankSec: 30,
      },
      players: [
        { id: "kabir", name: "Kabir", buyIn: 2000, keyword: KEYWORDS.kabir },
        { id: "arjun", name: "Arjun", buyIn: 2000, keyword: KEYWORDS.arjun },
        { id: "dev", name: "Dev", buyIn: 2000, keyword: KEYWORDS.dev },
      ],
    },
  });
}, 1000);

setTimeout(() => {
  // arjun: tries a host command (bounce) + later a LEGIT time bank (extend)
  arjun = new Bot("arjun", "arjun", { misbehave: "host", useTimeBank: true });
  dev1 = new Bot("dev", "dev1", { misbehave: "act" }); // acts out of turn
  bots.push(arjun, dev1);
}, 2000);

setTimeout(runMallory, 4000);

// mid-hand seat takeover (condition 6): once dev1 has seen hand 3 begin,
// a "second device" logs in with dev's correct keyword — the server must
// kick dev1 and hand the seat to dev2
const takeoverTrigger = setInterval(() => {
  if (dev2 || !dev1) return;
  if (dev1.latestHand >= TAKEOVER_AT_HAND) {
    clearInterval(takeoverTrigger);
    // dev2 also runs the server-clock test: goes silent on one turn later
    dev2 = new Bot("dev", "dev2", { misbehave: null, goSilent: true });
    bots.push(dev2);
  }
}, 300);

const watchdog = setTimeout(
  () => fail(`timed out after ${WATCHDOG_MS / 1000}s — game stalled`),
  WATCHDOG_MS
);

const poll = setInterval(() => {
  // done when: session ended for all LIVE actors, dev1 kicked, mallory rejected twice
  if (!dev2 || !kabir.gotEnded || !arjun.gotEnded || !dev2.gotEnded) return;
  if (!dev1.kicked) return;
  if (malloryErrors.length < 2) return;
  clearInterval(poll);
  clearTimeout(watchdog);

  // final asserts
  const sum = kabir.gotEnded!;
  const net = sum.rows.reduce((a, r) => a + r.net, 0);
  if (net !== 0) fail(`ledger nets to ${net}, not 0`);
  if (sum.handsPlayed < HANDS_TO_PLAY) fail(`only ${sum.handsPlayed} hands played`);
  for (const b of [kabir, arjun, dev2]) {
    if (b.stripChecks < 100) fail(`${b.label}: only ${b.stripChecks} strip checks — vacuous`);
    if (b.ownCardChecks < 10) fail(`${b.label}: only ${b.ownCardChecks} own-card checks`);
    if (b.ledgerRows !== 3) fail(`${b.label}: ledger rows ${b.ledgerRows} != 3`);
  }
  if (!dev1.rejectionSeen) fail("dev1's out-of-turn act was NOT rejected");
  if (!arjun.rejectionSeen) fail("arjun's host command was NOT rejected");

  // Step 6: server-owned clock + time bank
  if (!timeoutObserved) fail("dev2 went silent but the server never timed him out");
  if (!arjun.timeBankExtended) fail("arjun's time bank did not extend his deadline");
  if (!kabir.rejectionSeen) fail("kabir's out-of-turn timeBank was NOT rejected");

  // condition 6: takeover — old connection silent after kick
  if (dev1.statesAfterKick > 0) {
    fail(`dev1 received ${dev1.statesAfterKick} states AFTER being kicked — two live connections on one seat`);
  }
  if (dev2!.stripChecks === 0 || dev2!.ownCardChecks === 0) {
    fail("dev2 (takeover device) never actually played");
  }

  // condition 5: identical, unrevealing login failures
  if (malloryErrors.length !== 2) fail(`mallory got ${malloryErrors.length} errors, expected 2`);
  if (malloryErrors[0] !== INVALID_LOGIN || malloryErrors[1] !== INVALID_LOGIN) {
    fail(`login failures differ or leak info: ${JSON.stringify(malloryErrors)}`);
  }
  if (malloryLeaked) fail("mallory received game data without logging in");

  console.log(`hands: ${sum.handsPlayed} · strips: kabir=${kabir.stripChecks} arjun=${arjun.stripChecks} dev2=${dev2!.stripChecks}`);
  console.log("out-of-turn rejected ✅ · non-host rejected ✅ · identical invalid logins ✅");
  console.log(`takeover: dev1 kicked at hand ≥${TAKEOVER_AT_HAND}, silent after (${dev1.statesAfterKick} leaks) · dev2 played on ✅`);
  console.log("server clock timed out a silent player ✅ · time bank extended deadline ✅ · out-of-turn timeBank rejected ✅");
  console.log("ledger nets 0 ✅");
  console.log("ONLINE E2E PASS ✅");
  [...bots].forEach((b) => b.ws.close());
  process.exit(0);
}, 250);
