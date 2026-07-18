// ============================================================
// Wire E2E (item 2): a player busts -> becomes a spectator -> requests an empty
// seat -> an admin re-seats them with a fresh buy-in — all over the real wire.
// (Admin authority is identity-based, so the admin can approve even if they are
// the one who busted — item 6.)
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-seat-request.ts
// ============================================================

import type { ServerMessage, ClientMessage, StartingPlayer } from "./shared/protocol";
import type { GameState } from "./shared/engine/types";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const WS = /^(127\.0\.0\.1|localhost)/.test(HOST) ? "ws" : "wss";
const KW: Record<string, string> = { kabir: "masala", arjun: "idli" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

class Bot {
  ws: WebSocket;
  latest: GameState | null = null;
  seat: number | null = null;
  requested = false;
  everSpectator = false;
  reSeated = false;
  private accepted = new Set<string>();
  private q: ClientMessage[] = [];
  constructor(public id: string, room: string) {
    this.ws = new WebSocket(`${WS}://${HOST}/parties/table-server/${room}`);
    this.ws.addEventListener("open", () => {
      this.ws.send(JSON.stringify({ type: "join", playerId: this.id, keyword: KW[this.id] }));
      for (const m of this.q) this.ws.send(JSON.stringify(m));
      this.q = [];
    });
    this.ws.addEventListener("message", (e) => {
      const m: ServerMessage = JSON.parse(String(e.data));
      if (m.type === "state") this.onState(m.state);
    });
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }

  onState(s: GameState) {
    this.latest = s;
    this.seat = s.seats.find((x) => x.id === this.id && !x.empty)?.seat ?? null;

    // drive all-in so someone busts fast
    if (s.phase === "inHand" && s.playerToAct === this.seat && s.legalActions) {
      const la = s.legalActions;
      if (la.includes("bet") && s.betRange) this.send({ type: "act", action: "bet", amount: s.betRange.max });
      else if (la.includes("raise") && s.betRange) this.send({ type: "act", action: "raise", amount: s.betRange.max });
      else if (la.includes("call")) this.send({ type: "act", action: "call" });
      else if (la.includes("check")) this.send({ type: "act", action: "check" });
    }

    // busted -> spectator -> request an empty seat (once)
    if (this.seat == null && s.phase !== "lobby" && s.phase !== "ended") {
      this.everSpectator = true;
      if (!this.requested) {
        const empty = s.seats.find((x) => x.empty);
        if (empty) { this.send({ type: "requestSeat", seat: empty.seat }); this.requested = true; }
      }
    }
    if (this.everSpectator && this.seat != null) this.reSeated = true;

    // admin resolves pending seat requests (accept)
    if (this.id === "kabir" && s.seatRequests) {
      for (const rq of s.seatRequests) {
        if (!this.accepted.has(rq.playerId)) {
          this.accepted.add(rq.playerId);
          this.send({ type: "host", cmd: { kind: "seatRequest", playerId: rq.playerId, action: "accept" } });
        }
      }
    }
  }
}

async function main() {
  const room = `seatreq-${Date.now()}`;
  const CONFIG = { smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000, minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30 };
  const players: StartingPlayer[] = [
    { id: "kabir", name: "Kabir", buyIn: 2000, keyword: KW.kabir },
    { id: "arjun", name: "Arjun", buyIn: 2000, keyword: KW.arjun },
  ];
  const kabir = new Bot("kabir", room);
  await wait(700);
  kabir.send({ type: "host", cmd: { kind: "start", gameMode: "nlhe", config: CONFIG, players, disconnectGraceMs: 3000 } });
  await wait(700);
  const arjun = new Bot("arjun", room);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await wait(400);
    if (kabir.reSeated || arjun.reSeated) { await wait(1500); break; }
  }

  check("a player busted and became a spectator", kabir.everSpectator || arjun.everSpectator);
  check("the busted spectator was re-seated by the admin (request round-trip)", kabir.reSeated || arjun.reSeated);
  const grid = (kabir.latest ?? arjun.latest)?.seats ?? [];
  check("both original players are seated again after the re-buy",
    grid.filter((x) => !x.empty && (x.id === "kabir" || x.id === "arjun")).length === 2,
    grid.filter((x) => !x.empty).map((x) => x.id).join(","));

  kabir.ws.close(); arjun.ws.close();
  console.log(failures === 0 ? "\nSEAT-REQUEST E2E PASS ✅" : `\nSEAT-REQUEST E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
setTimeout(() => { console.error("watchdog"); process.exit(1); }, 70000);
main();
