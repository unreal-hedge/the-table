// ============================================================
// Wire E2E (item 3): a SEATED player asks an admin for a rebuy; the admin
// approves; the chips land (between hands). Needs `npm run party:dev`.
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
  ledger: LedgerRow[] = [];
  seat: number | null = null;
  private approved = new Set<string>();
  private q: ClientMessage[] = [];
  constructor(public id: string, room: string, public admin = false) {
    this.ws = new WebSocket(`${WS}://${HOST}/parties/table-server/${room}`);
    this.ws.addEventListener("open", () => {
      this.ws.send(JSON.stringify({ type: "join", playerId: this.id, keyword: KW[this.id] }));
      for (const m of this.q) this.ws.send(JSON.stringify(m));
      this.q = [];
    });
    this.ws.addEventListener("message", (e) => {
      const m: ServerMessage = JSON.parse(String(e.data));
      if (m.type === "ledger") { this.ledger = m.rows; return; }
      if (m.type !== "state") return;
      const s: GameState = m.state;
      this.seat = s.seats.find((x) => x.id === this.id && !x.empty)?.seat ?? null;
      // keep hands short so pending rebuys apply: on my turn, check or fold
      if (s.phase === "inHand" && s.playerToAct === this.seat && s.legalActions) {
        const la = s.legalActions;
        this.send({ type: "act", action: la.includes("check") ? "check" : "fold" });
      }
      // admin approves any rebuy request
      if (this.admin && s.chipRequests) {
        for (const rq of s.chipRequests) if (!this.approved.has(rq.playerId)) {
          this.approved.add(rq.playerId);
          this.send({ type: "host", cmd: { kind: "chipRequest", playerId: rq.playerId, action: "approve" } });
        }
      }
    });
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }
}

async function main() {
  const room = `chipreq-${Date.now()}`;
  const CONFIG = { smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000, minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30 };
  const players: StartingPlayer[] = [
    { id: "kabir", name: "Kabir", buyIn: 2000, keyword: KW.kabir },
    { id: "arjun", name: "Arjun", buyIn: 2000, keyword: KW.arjun },
  ];
  const kabir = new Bot("kabir", room, true);
  await wait(700);
  kabir.send({ type: "host", cmd: { kind: "start", gameMode: "nlhe", config: CONFIG, players, disconnectGraceMs: 3000 } });
  await wait(900);
  const arjun = new Bot("arjun", room);
  await wait(900);

  const before = arjun.ledger.find((r) => r.id === "arjun")?.buyInTotal ?? 0;
  arjun.send({ type: "requestChips", amount: 1000 });
  await wait(6000); // admin approves; a hand ends; the pending rebuy applies

  const after = arjun.ledger.find((r) => r.id === "arjun")?.buyInTotal ?? 0;
  check("rebuy request approved -> buyInTotal +1000", after === before + 1000, `before ${before} after ${after}`);
  const total = kabir.ledger.reduce((t, r) => t + r.stack, 0);
  check("ledger stacks reflect the rebuy (2000+2000+1000 = 5000)", total === 5000, `total ${total}`);

  kabir.ws.close(); arjun.ws.close();
  console.log(failures === 0 ? "\nCHIP-REQUEST E2E PASS ✅" : `\nCHIP-REQUEST E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
setTimeout(() => { console.error("watchdog"); process.exit(1); }, 45000);
main();
