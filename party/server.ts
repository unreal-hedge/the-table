// ============================================================
// THE TABLE — multiplayer server (PartyServer on Cloudflare).
//
// One instance of this class == one poker room, backed by a
// Cloudflare Durable Object. It is the AUTHORITATIVE game host:
// it owns the single GameManager (deck + hidden cards live here),
// applies actions, and broadcasts a per-player-filtered GameState
// (see filter.ts) so no client ever receives another player's
// un-revealed hole cards.
//
// SECURITY MODEL (Step 3):
//  - Every "act" is verified server-side: connection → playerId →
//    seat must equal the engine's playerToAct. The client's word
//    is never trusted.
//  - "host" commands are only accepted from connections joined as
//    a host id. PROVISIONAL until Step 5 keyword login — see the
//    warning atop ROADMAP.md.
//  - The 30s clock/time bank is still client-display only; the
//    server takes ownership of it in Step 6.
//
// NO UI CODE EVER. Imports from shared/ only.
// ============================================================

import { routePartykitRequest, Server, type Connection } from "partyserver";
import { GameManager } from "../shared/engine/manager";
import type { GameState } from "../shared/engine/types";
import { filterStateFor } from "./filter";
import {
  ClientMessage, ServerMessage, HostCommand, ChatEntry, PresenceMember,
  CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, INVALID_LOGIN,
} from "../shared/protocol";

/** Cloudflare bindings available to the worker. The Durable Object
 *  namespace name here MUST match the binding in party/wrangler.jsonc. */
export interface Env {
  TableServer: DurableObjectNamespace<TableServer>;
}

// Matches the hot-seat UI's pause between hands (page.tsx uses 4200ms).
const HAND_END_PAUSE_MS = 4200;
// Server-side slack past the action deadline before forcing the auto
// check/fold — covers network latency so a buzzer-beater call isn't
// unfairly beaten by the server's own clock (Step 6, spec 5.3).
const CLOCK_GRACE_MS = 750;

export class TableServer extends Server<Env> {
  // NOT hibernatable: the GameManager (deck, hidden cards, clocks)
  // lives in memory, and hibernation would wipe it mid-session. A
  // room with open sockets stays awake; an empty room may be evicted,
  // which is acceptable until persistence lands (post-1b).
  static options = { hibernate: false };

  private gm: GameManager | null = null;
  /** connection.id → playerId. THE identity map — every permission
   *  check goes through this, never through fields in the message. */
  private joined = new Map<string, string>();
  /** The room's login book: playerId → credentials + host flag.
   *  Bootstrap: first join in a fresh room claims it (creator = host);
   *  afterwards only the host's start form adds/updates entries. */
  private roster = new Map<string, { name: string; keyword: string; host: boolean }>();
  private creatorId: string | null = null;
  private chat: ChatEntry[] = [];
  private dealTimer: ReturnType<typeof setTimeout> | null = null;
  /** THE action clock (Step 6): the server owns timeouts now; client
   *  countdowns are display only. Re-armed after every mutation. */
  private clockTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- connection lifecycle ----------

  onConnect(conn: Connection) {
    // No identity yet — everything but "join" is rejected until they join.
    this.send(conn, { type: "you", playerId: "", seat: null, host: false });
  }

  onClose(conn: Connection) {
    // Step 7 adds the 2-min disconnect grace; for now just drop the
    // mapping. Their seat/stack live in the GameManager, so rejoining
    // with the same playerId picks the seat right back up.
    this.joined.delete(conn.id);
    this.broadcastPresence();
  }

  // ---------- message handling ----------

  onMessage(conn: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(
        typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer)
      );
    } catch {
      return this.error(conn, "Malformed message");
    }

    if (msg.type === "join") return this.handleJoin(conn, msg.playerId, msg.keyword);

    // Everything below requires an established identity.
    const playerId = this.joined.get(conn.id);
    if (!playerId) return this.error(conn, "Join first");

    switch (msg.type) {
      case "act":      return this.handleAct(conn, playerId, msg.action, msg.amount);
      case "timeBank": return this.handleTimeBank(conn, playerId);
      case "show":     return this.handleShow(conn, playerId);
      case "chat":     return this.handleChat(conn, playerId, msg.text);
      case "host":     return this.handleHost(conn, playerId, msg.cmd);
      default:         return this.error(conn, "Unknown message type");
    }
  }

  private handleJoin(conn: Connection, playerId: string, keyword: string) {
    const id = String(playerId ?? "").trim().toLowerCase();
    const kw = String(keyword ?? "").trim().toLowerCase();

    // SECURITY: every rejection below is the same message — an attacker
    // must never learn whether the name exists (Kabir's condition 2).
    if (!id || id.length > 40 || !kw || kw.length > 40) {
      return this.error(conn, INVALID_LOGIN);
    }

    if (this.roster.size === 0) {
      // fresh room — the first join claims it and becomes host
      this.roster.set(id, { name: id, keyword: kw, host: true });
      this.creatorId = id;
      this.pushLogQuiet(`room claimed by ${id}`);
    } else {
      const entry = this.roster.get(id);
      if (!entry || entry.keyword !== kw) return this.error(conn, INVALID_LOGIN);
    }

    // Takeover (spec 8.2): a correct login always wins the seat. Any
    // other live connection holding this identity is told why and cut —
    // never two live connections on one seat (Kabir's condition 1).
    for (const other of this.getConnections()) {
      if (other.id !== conn.id && this.joined.get(other.id) === id) {
        this.send(other, { type: "kicked" });
        this.joined.delete(other.id);
        other.close(1000, "logged in elsewhere");
      }
    }

    this.joined.set(conn.id, id);
    this.send(conn, {
      type: "you", playerId: id, seat: this.seatOf(id),
      host: this.roster.get(id)?.host ?? false,
    });
    this.send(conn, { type: "chatHistory", entries: this.chat });
    if (this.gm) {
      this.send(conn, {
        type: "state",
        state: filterStateFor(this.gm.state(), this.seatOf(id)),
        at: Date.now(),
      });
      this.send(conn, { type: "ledger", rows: this.gm.ledger() });
    } else {
      // explicit "nothing running" — without it, a client reconnecting
      // after a server restart would render its stale pre-crash state
      this.send(conn, { type: "noGame" });
    }
    this.broadcastPresence();
  }

  private handleAct(
    conn: Connection, playerId: string, action: string, amount?: number
  ) {
    if (!this.gm) return this.error(conn, "No game running");
    const st = this.gm.state();
    const seat = this.seatOf(playerId);

    // CONDITION 1 (Kabir): the sender must BE the player to act —
    // derived from the connection's identity, not from the message.
    if (seat == null || st.playerToAct !== seat) {
      return this.error(conn, "Not your turn");
    }
    if (!st.legalActions?.includes(action as never)) {
      return this.error(conn, `Illegal action: ${action}`);
    }
    if ((action === "bet" || action === "raise")) {
      const r = st.betRange;
      if (!r || typeof amount !== "number" || amount < r.min || amount > r.max) {
        return this.error(conn, "Bet amount out of range");
      }
    }

    try {
      this.gm.act(action as Parameters<GameManager["act"]>[0], amount);
    } catch (e) {
      // Engine rejected something we didn't pre-validate: log the full
      // error server-side (never swallow), tell the client plainly.
      console.error(`[TableServer] act failed:`, e);
      return this.error(conn, "Action rejected by engine");
    }
    this.afterMutation();
  }

  private handleTimeBank(conn: Connection, playerId: string) {
    if (!this.gm) return this.error(conn, "No game running");
    const seat = this.seatOf(playerId);
    // same rule as act: only the player on the clock can extend it
    if (seat == null || this.gm.state().playerToAct !== seat) {
      return this.error(conn, "Not your turn");
    }
    if (!this.gm.useTimeBank()) return this.error(conn, "No time bank left");
    this.afterMutation(); // broadcasts the new deadline + re-arms the clock
  }

  private handleShow(conn: Connection, playerId: string) {
    if (!this.gm) return this.error(conn, "No game running");
    const seat = this.seatOf(playerId);
    // Same rule as act: only the seat the ENGINE says may show, may show.
    if (seat == null || this.gm.state().canShowSeat !== seat) {
      return this.error(conn, "You can't show right now");
    }
    this.gm.voluntaryShow(seat);
    this.afterMutation();
  }

  private handleChat(conn: Connection, playerId: string, text: string) {
    const clean = String(text ?? "").trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return;
    const entry: ChatEntry = {
      from: this.nameOf(playerId), text: clean, at: Date.now(),
    };
    this.chat.push(entry);
    if (this.chat.length > CHAT_HISTORY_LIMIT) {
      this.chat = this.chat.slice(-CHAT_HISTORY_LIMIT);
    }
    this.broadcastMsg({ type: "chat", entry });
  }

  private handleHost(conn: Connection, playerId: string, cmd: HostCommand) {
    // Host commands only from connections whose ROSTER entry says host —
    // identity from the connection map, authority from the roster.
    if (!this.roster.get(playerId)?.host) {
      return this.error(conn, "Host only");
    }

    switch (cmd.kind) {
      case "start": {
        if (this.gm && this.gm.state().phase !== "ended") {
          return this.error(conn, "A session is already running");
        }
        // Register every player's login before the game exists: upsert
        // roster entries (never delete — spectators keep their logins).
        for (const p of cmd.players) {
          const kw = String(p.keyword ?? "").trim().toLowerCase();
          if (!kw) return this.error(conn, `Player "${p.name}" needs a keyword`);
        }
        for (const p of cmd.players) {
          const kw = String(p.keyword ?? "").trim().toLowerCase();
          const existing = this.roster.get(p.id);
          this.roster.set(p.id, {
            name: p.name,
            keyword: kw,
            host: !!p.host || existing?.host === true,
          });
        }
        // the creator can never lock themselves out of hosting
        if (this.creatorId) {
          const c = this.roster.get(this.creatorId);
          if (c) c.host = true;
        }
        try {
          this.gm = new GameManager(cmd.config, cmd.players);
          this.gm.start();
        } catch (e) {
          console.error(`[TableServer] start failed:`, e);
          this.gm = null;
          return this.error(conn, "Could not start the game");
        }
        // roster (and host flags) may have changed — refresh everyone's "you"
        for (const c of this.getConnections()) {
          const pid = this.joined.get(c.id);
          if (pid === undefined) continue;
          this.send(c, {
            type: "you", playerId: pid, seat: this.seatOf(pid),
            host: this.roster.get(pid)?.host ?? false,
          });
        }
        break;
      }
      case "pause":    this.gm?.togglePause(); break;
      case "dealNext": {
        // engine's dealNextHand() trusts its caller on timing — dealing
        // MID-hand would rebuild the table and destroy the live pot.
        // The hot-seat UI can't misfire this; a remote client could.
        if (this.gm?.state().phase !== "handEnded") {
          return this.error(conn, "Can't deal now");
        }
        this.gm.dealNextHand();
        break;
      }
      case "addChips": this.gm?.approveAddChips(cmd.playerId, cmd.amount); break;
      case "sitOut":   this.gm?.toggleSitOut(cmd.playerId, cmd.out); break;
      case "end": {
        if (!this.gm) return this.error(conn, "No game running");
        const summary = this.gm.stop();
        this.broadcastMsg({ type: "ended", summary });
        break;
      }
      default: return this.error(conn, "Unknown host command");
    }
    this.afterMutation();
  }

  // ---------- broadcast & timers ----------

  /** Call after every engine mutation: pushes fresh filtered state to
   *  everyone, schedules the between-hands auto-deal, and re-arms the
   *  server-owned action clock. */
  private afterMutation() {
    if (!this.gm) return;
    const base = this.gm.state();
    this.broadcastState(base);
    this.broadcastMsg({ type: "ledger", rows: this.gm.ledger() });

    if (this.dealTimer) { clearTimeout(this.dealTimer); this.dealTimer = null; }
    if (base.phase === "handEnded") {
      this.dealTimer = setTimeout(() => {
        this.dealTimer = null;
        if (!this.gm || this.gm.state().phase !== "handEnded") return;
        this.gm.dealNextHand();
        if (this.gm.state().phase === "handEnded") {
          // Still handEnded = fewer than 2 eligible players. Don't loop —
          // the host deals manually via "dealNext" once rebuys/sit-ins land.
          this.broadcastState(this.gm.state());
        } else {
          // through afterMutation so the NEW hand's action clock is armed
          this.afterMutation();
        }
      }, HAND_END_PAUSE_MS);
    }

    // Server-owned action clock (Step 6). One timer for the one player on
    // the clock; pause/resume and hand changes all pass through here, so
    // clearing + re-arming per mutation is always correct.
    if (this.clockTimer) { clearTimeout(this.clockTimer); this.clockTimer = null; }
    if (base.phase === "inHand" && base.turnDeadlineAt != null) {
      const wait = Math.max(0, base.turnDeadlineAt - Date.now()) + CLOCK_GRACE_MS;
      this.clockTimer = setTimeout(() => {
        this.clockTimer = null;
        if (!this.gm) return;
        const s = this.gm.state();
        if (s.phase !== "inHand" || s.turnDeadlineAt == null) return;
        // deadline moved (time bank landed as we fired)? the mutation that
        // moved it already re-armed a fresh timer — stand down
        if (Date.now() < s.turnDeadlineAt) return;
        this.gm.timeout(); // engine applies auto check/fold + sit-out rules
        this.afterMutation();
      }, wait);
    }
  }

  /** One engine snapshot, filtered per receiving connection. */
  private broadcastState(base: GameState) {
    const at = Date.now();
    for (const conn of this.getConnections()) {
      const pid = this.joined.get(conn.id);
      if (pid === undefined) continue; // not joined: receives nothing
      this.send(conn, { type: "state", state: filterStateFor(base, this.seatOf(pid)), at });
    }
  }

  private broadcastMsg(msg: ServerMessage) {
    for (const conn of this.getConnections()) {
      if (this.joined.has(conn.id)) this.send(conn, msg);
    }
  }

  /** Who's connected right now — deduped (a player may briefly hold
   *  two sockets during a device switch). */
  private broadcastPresence() {
    const seen = new Set<string>();
    const members: PresenceMember[] = [];
    for (const id of this.joined.values()) {
      if (seen.has(id)) continue;
      seen.add(id);
      members.push({ id, name: this.nameOf(id) });
    }
    this.broadcastMsg({ type: "presence", members });
  }

  // ---------- helpers ----------

  private seatOf(playerId: string): number | null {
    if (!this.gm) return null;
    return this.gm.state().seats.find((s) => s.id === playerId)?.seat ?? null;
  }

  private nameOf(playerId: string): string {
    if (this.gm) {
      const seat = this.gm.state().seats.find((s) => s.id === playerId);
      if (seat) return seat.name;
    }
    return this.roster.get(playerId)?.name ?? playerId;
  }

  private pushLogQuiet(msg: string) {
    console.log(`[TableServer:${this.name}] ${msg}`);
  }

  private send(conn: Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private error(conn: Connection, msg: string) {
    this.send(conn, { type: "error", msg });
  }
}

// The Worker entry point: route every request to the right room's
// Durable Object. Non-party requests get a plain health-check reply.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("The Table server is running.", { status: 200 })
    );
  },
};
