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
  ClientMessage, ServerMessage, HostCommand, ChatEntry,
  PROVISIONAL_HOST_IDS, CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH,
} from "../shared/protocol";

/** Cloudflare bindings available to the worker. The Durable Object
 *  namespace name here MUST match the binding in party/wrangler.jsonc. */
export interface Env {
  TableServer: DurableObjectNamespace<TableServer>;
}

// Matches the hot-seat UI's pause between hands (page.tsx uses 4200ms).
const HAND_END_PAUSE_MS = 4200;

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
  private chat: ChatEntry[] = [];
  private dealTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- connection lifecycle ----------

  onConnect(conn: Connection) {
    // No identity yet — everything but "join" is rejected until they join.
    this.send(conn, { type: "you", playerId: "", seat: null });
  }

  onClose(conn: Connection) {
    // Step 7 adds the 2-min disconnect grace; for now just drop the
    // mapping. Their seat/stack live in the GameManager, so rejoining
    // with the same playerId picks the seat right back up.
    this.joined.delete(conn.id);
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

    if (msg.type === "join") return this.handleJoin(conn, msg.playerId);

    // Everything below requires an established identity.
    const playerId = this.joined.get(conn.id);
    if (!playerId) return this.error(conn, "Join first");

    switch (msg.type) {
      case "act":  return this.handleAct(conn, playerId, msg.action, msg.amount);
      case "show": return this.handleShow(conn, playerId);
      case "chat": return this.handleChat(conn, playerId, msg.text);
      case "host": return this.handleHost(conn, playerId, msg.cmd);
      default:     return this.error(conn, "Unknown message type");
    }
  }

  private handleJoin(conn: Connection, playerId: string) {
    const id = String(playerId ?? "").trim().toLowerCase();
    if (!id || id.length > 40) return this.error(conn, "Invalid player id");
    this.joined.set(conn.id, id);
    this.send(conn, { type: "you", playerId: id, seat: this.seatOf(id) });
    this.send(conn, { type: "chatHistory", entries: this.chat });
    if (this.gm) {
      this.send(conn, {
        type: "state",
        state: filterStateFor(this.gm.state(), this.seatOf(id)),
      });
    }
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
    // CONDITION 1 (Kabir): host commands only from host connections.
    // PROVISIONAL identity until Step 5 — see ROADMAP warning.
    if (!PROVISIONAL_HOST_IDS.includes(playerId)) {
      return this.error(conn, "Host only");
    }

    switch (cmd.kind) {
      case "start": {
        if (this.gm && this.gm.state().phase !== "ended") {
          return this.error(conn, "A session is already running");
        }
        try {
          this.gm = new GameManager(cmd.config, cmd.players);
          this.gm.start();
        } catch (e) {
          console.error(`[TableServer] start failed:`, e);
          this.gm = null;
          return this.error(conn, "Could not start the game");
        }
        break;
      }
      case "pause":    this.gm?.togglePause(); break;
      case "dealNext": this.gm?.dealNextHand(); break;
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
   *  everyone and schedules the between-hands auto-deal. */
  private afterMutation() {
    if (!this.gm) return;
    const base = this.gm.state();
    this.broadcastState(base);

    if (this.dealTimer) { clearTimeout(this.dealTimer); this.dealTimer = null; }
    if (base.phase === "handEnded") {
      this.dealTimer = setTimeout(() => {
        this.dealTimer = null;
        if (!this.gm || this.gm.state().phase !== "handEnded") return;
        this.gm.dealNextHand();
        // If still handEnded (fewer than 2 eligible players), don't loop —
        // the host deals manually via "dealNext" once rebuys/sit-ins land.
        this.broadcastState(this.gm.state());
      }, HAND_END_PAUSE_MS);
    }
  }

  /** One engine snapshot, filtered per receiving connection. */
  private broadcastState(base: GameState) {
    for (const conn of this.getConnections()) {
      const pid = this.joined.get(conn.id);
      if (pid === undefined) continue; // not joined: receives nothing
      this.send(conn, { type: "state", state: filterStateFor(base, this.seatOf(pid)) });
    }
  }

  private broadcastMsg(msg: ServerMessage) {
    for (const conn of this.getConnections()) {
      if (this.joined.has(conn.id)) this.send(conn, msg);
    }
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
    return playerId; // spectators chat under their id
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
