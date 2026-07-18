// ============================================================
// Host authority is IDENTITY-based (item 6): the two permanent admins,
// Parth and Kabir, each hold every host power — regardless of who created
// the room or who joined first — and nobody else ever does.
//
// Usage:  npm run party:dev   (in another terminal)
//         npx tsx test-host-identity.ts
// ============================================================

import type { ServerMessage, ClientMessage, HostCommand, StartingPlayer } from "./shared/protocol";

const HOST = process.env.PARTY_HOST ?? "127.0.0.1:8787";
const WS = /^(127\.0\.0\.1|localhost)/.test(HOST) ? "ws" : "wss";
const KW: Record<string, string> = { kabir: "masala", arjun: "idli", parth: "dosa" };

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Bot {
  ws: WebSocket;
  host: boolean | null = null;
  errors: string[] = [];
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
      if (m.type === "you") this.host = m.host;
      else if (m.type === "error") this.errors.push(m.msg);
    });
  }
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.CONNECTING) this.q.push(m);
    else this.ws.send(JSON.stringify(m));
  }
  hostCmd(cmd: HostCommand) { this.send({ type: "host", cmd }); }
}

async function main() {
  const room = `hostid-${Date.now()}`;
  const CONFIG = {
    smallBlind: 100, bigBlind: 200, defaultBuyIn: 2000,
    minBuyIn: 500, maxBuyIn: 50000, actionTimeSec: 30, timeBankSec: 30,
  };
  const players: StartingPlayer[] = [
    { id: "kabir", name: "Kabir", buyIn: 2000, keyword: KW.kabir },
    { id: "arjun", name: "Arjun", buyIn: 2000, keyword: KW.arjun },
    { id: "parth", name: "Parth", buyIn: 2000, keyword: KW.parth },
  ];

  // Kabir (an admin) creates the room + registers everyone, THEN the others join.
  const kabir = new Bot("kabir", room);
  await wait(700);
  kabir.hostCmd({ kind: "start", gameMode: "nlhe", config: CONFIG, players });
  await wait(700);
  const arjun = new Bot("arjun", room);
  const parth = new Bot("parth", room);
  await wait(1500);

  check("Kabir (admin) is host", kabir.host === true, `host=${kabir.host}`);
  check("Parth (admin) is host despite NOT creating the room and joining last",
    parth.host === true, `host=${parth.host}`);
  check("Arjun (non-admin, registered) is NOT host", arjun.host === false, `host=${arjun.host}`);

  // independent authority: a non-admin's host command bounces; either admin's lands.
  arjun.errors = []; parth.errors = [];
  arjun.hostCmd({ kind: "pause" });
  parth.hostCmd({ kind: "pause" });
  await wait(700);
  check("non-admin host command refused (Host only)",
    arjun.errors.some((e) => /host only/i.test(e)), arjun.errors.join(" | ") || "no error");
  check("admin (Parth) host command accepted (no Host-only bounce)",
    !parth.errors.some((e) => /host only/i.test(e)), parth.errors.join(" | ") || "clean");

  kabir.ws.close(); arjun.ws.close(); parth.ws.close();
  console.log(failures === 0 ? "\nHOST IDENTITY E2E PASS ✅" : `\nHOST IDENTITY E2E FAIL ❌ (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

setTimeout(() => { console.error("watchdog timeout"); process.exit(1); }, 60_000);
main();
