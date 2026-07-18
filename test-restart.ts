// ============================================================
// Wire E2E (item 4): an admin RESTARTS — the current session settles (an ended
// summary is broadcast) and a fresh session begins on the same table with the
// same seated players, WITHOUT anyone re-entering the room. Needs party:dev.
// ============================================================

import type { ServerMessage, ClientMessage, StartingPlayer } from "./shared/protocol";
import type { GameState, LedgerRow } from "./shared/engine/types";

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
  ledger: LedgerRow[] = [];
  seat: number | null = null;
  ended = false;
  sawReset = false;
  maxHand = 0;
  private prevHand = 0;
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
      if (m.type === "ended") { this.ended = true; return; }
      if (m.type === "ledger") { this.ledger = m.rows; return; }
      if (m.type !== "state") return;
      const s = m.state;
      this.latest = s;
      this.maxHand = Math.max(this.maxHand, s.handNumber);
      if (this.prevHand > 1 && s.handNumber === 1) this.sawReset = true; // fresh session
      this.prevHand = s.handNumber;
      this.seat = s.seats.find((x) => x.id === this.id && !x.empty)?.seat ?? null;
      // fold-drive so hands turn over fast (no busting)
      if (s.phase === "inHand" && s.playerToAct === this.seat && s.legalActions) {
        const la = s.legalActions;
        this.send({ type: "act", action: la.includes("fold") ? "fold" : "check" });
      }
    });
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }
}

async function main() {
  const room = `restart-${Date.now()}`;
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

  // let a few hands play (hand number climbs)
  await wait(6000);
  const before = kabir.maxHand;
  check("played multiple hands before restart", before >= 2, `maxHand=${before}`);

  kabir.send({ type: "host", cmd: { kind: "restart" } });
  await wait(3000);

  check("restart broadcast an 'ended' summary (session settled)", kabir.ended && arjun.ended);
  check("a fresh session started (hand # reset to 1)", kabir.sawReset || arjun.sawReset);
  const grid = (kabir.latest ?? arjun.latest)?.seats ?? [];
  check("both players re-seated on the same table", grid.filter((x) => !x.empty && (x.id === "kabir" || x.id === "arjun")).length === 2);
  const total = kabir.ledger.reduce((t, r) => t + r.stack, 0);
  const netZero = kabir.ledger.reduce((t, r) => t + r.net, 0);
  check("fresh buy-ins: ledger totals 4000, net 0", total === 4000 && netZero === 0, `total ${total} net ${netZero}`);

  kabir.ws.close(); arjun.ws.close();
  console.log(failures === 0 ? "\nRESTART E2E PASS ✅" : `\nRESTART E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
setTimeout(() => { console.error("watchdog"); process.exit(1); }, 45000);
main();
