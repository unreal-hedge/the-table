// ============================================================
// Wire E2E (item 5): CREATE vs JOIN + self-registration.
//   • An admin CREATES a fresh room (start with only themselves) — they become
//     host and take a seat, exactly like the lobby's auto-start.
//   • A brand-new character JOINS the same room with a fresh keyword — it
//     self-registers (no pre-roster needed) and spectates.
//   • The OTHER admin can join a room they never created — closing the item-6
//     deferral — and is recognised as host by identity, not creation order.
//   • A returning character with the WRONG keyword is rejected (Invalid login).
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-create-join.ts
// ============================================================

import type { ServerMessage, ClientMessage, StartingPlayer } from "./shared/protocol";
import type { GameState } from "./shared/engine/types";
import { INVALID_LOGIN } from "./shared/protocol";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const WS = /^(127\.0\.0\.1|localhost)/.test(HOST) ? "ws" : "wss";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

class Bot {
  ws: WebSocket;
  you: { seat: number | null; host: boolean } | null = null;
  latest: GameState | null = null;
  errors: string[] = [];
  private q: ClientMessage[] = [];
  constructor(public id: string, room: string, public kw: string) {
    this.ws = new WebSocket(`${WS}://${HOST}/parties/table-server/${room}`);
    this.ws.addEventListener("open", () => {
      this.ws.send(JSON.stringify({ type: "join", playerId: this.id, keyword: this.kw }));
      for (const m of this.q) this.ws.send(JSON.stringify(m));
      this.q = [];
    });
    this.ws.addEventListener("message", (e) => {
      const m: ServerMessage = JSON.parse(String(e.data));
      if (m.type === "you" && m.playerId) this.you = { seat: m.seat, host: m.host };
      else if (m.type === "error") this.errors.push(m.msg);
      else if (m.type === "state") this.latest = m.state;
    });
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }
  seatedIn(s: GameState | null) {
    return !!s?.seats.find((x) => x.id === this.id && !x.empty);
  }
}

async function main() {
  const room = `createjoin-${Date.now()}`;
  const CONFIG = { smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000, minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30 };

  // ---- CREATE: parth (admin) opens the table with only themselves seated ----
  const parth = new Bot("parth", room, "dosa");
  await wait(700);
  const solo: StartingPlayer[] = [{ id: "parth", name: "parth", buyIn: CONFIG.defaultBuyIn, keyword: "dosa" }];
  parth.send({ type: "host", cmd: { kind: "start", gameMode: "nlhe", config: CONFIG, players: solo, disconnectGraceMs: 3000 } });
  await wait(900);

  check("creator is recognised as host", parth.you?.host === true);
  check("creator took a seat at their own table", parth.seatedIn(parth.latest), `seats=${parth.latest?.seats.filter((x) => !x.empty).map((x) => x.id).join(",")}`);
  check("a solo table waits for a second player (no crash)", parth.latest != null && parth.latest.phase !== "ended");

  // ---- JOIN: a brand-new NON-admin character with a fresh keyword ----
  const arjun = new Bot("arjun", room, "idli");
  await wait(800);
  check("new character self-registered (no rejection)", arjun.errors.length === 0, arjun.errors.join("|"));
  check("new character got a session (you)", arjun.you != null);
  check("non-admin joiner is NOT host", arjun.you?.host === false);
  check("joiner spectates — not auto-seated into a running table", !arjun.seatedIn(arjun.latest));

  // ---- JOIN: the OTHER admin joins a room they never created (item-6 closer) ----
  const kabir = new Bot("kabir", room, "masala");
  await wait(800);
  check("second admin joined an un-created-by-them room (no rejection)", kabir.errors.length === 0, kabir.errors.join("|"));
  check("second admin is host by identity, not creation order", kabir.you?.host === true);

  // ---- JOIN: returning character, WRONG keyword -> Invalid login ----
  const imposter = new Bot("arjun", room, "wrongword");
  await wait(800);
  check("returning character with wrong keyword is rejected", imposter.errors.includes(INVALID_LOGIN), imposter.errors.join("|"));
  check("rejected connection never got a session", imposter.you == null);

  parth.ws.close(); arjun.ws.close(); kabir.ws.close(); imposter.ws.close();
  console.log(failures === 0 ? "\nCREATE/JOIN E2E PASS ✅" : `\nCREATE/JOIN E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
setTimeout(() => { console.error("watchdog"); process.exit(1); }, 30000);
main();
