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
import { GameManager, fmt } from "../shared/engine/manager";
import { DoubleFlopManager, MAX_DFT_SEATS } from "../shared/engine/dft/manager";
import type { GameConfig, GameState, PlayerRecord, Variant } from "../shared/engine/types";
import { filterStateFor } from "./filter";
import {
  ClientMessage, ServerMessage, HostCommand, ChatEntry, PresenceMember, StartingPlayer,
  CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, INVALID_LOGIN,
} from "../shared/protocol";

/** The active engine — either variant. Both expose the session surface the
 *  server drives (state/act/dealNextHand/stop/ledger/toggleSitOut/
 *  approveAddChips/exportPlayers); variant-specific calls narrow by instanceof. */
type Engine = GameManager | DoubleFlopManager;

/** Cloudflare bindings available to the worker. The Durable Object
 *  namespace name here MUST match the binding in party/wrangler.jsonc. */
export interface Env {
  TableServer: DurableObjectNamespace<TableServer>;
}

// Matches the hot-seat UI's pause between hands (page.tsx uses 4200ms).
const HAND_END_PAUSE_MS = 4200;
// A DFT hand that resolved through flips holds the table longer so the
// sequential flip reveal (DftReveal) can finish before the next deal.
const DFT_REVEAL_BASE_MS = 3000;
const DFT_REVEAL_PER_FLIP_MS = 2400; // matches DftReveal's STEP_MS
const DFT_REVEAL_MAX_MS = 13_000;
// Server-side slack past the action deadline before forcing the auto
// check/fold — covers network latency so a buzzer-beater call isn't
// unfairly beaten by the server's own clock (Step 6, spec 5.3).
const CLOCK_GRACE_MS = 750;
// How long a seated player may be fully disconnected before the server
// sits them out (spec 8.2). Overridable per session for tests.
const DEFAULT_DISCONNECT_GRACE_MS = 120_000;

export class TableServer extends Server<Env> {
  // NOT hibernatable: the GameManager (deck, hidden cards, clocks)
  // lives in memory, and hibernation would wipe it mid-session. A
  // room with open sockets stays awake; an empty room may be evicted,
  // which is acceptable until persistence lands (post-1b).
  static options = { hibernate: false };

  private gm: Engine | null = null;
  /** Current game mode + a queued switch that applies at the next deal
   *  (never mid-hand, spec 7.4). */
  private variant: Variant = "nlhe";
  private pendingVariant: Variant | null = null;
  /** Server-side pause for DFT (NLHE pauses inside its own engine; DFT's
   *  simultaneous phases make an in-engine pause awkward, so the server
   *  owns it — freezes timers + presents phase "paused"). */
  private dftPaused = false;
  /** Seed source for the DFT engine (real time + counter, never Math.random). */
  private seedCounter = 0;
  /** The running session's config, kept for the mid-session engine handoff. */
  private config: GameConfig | null = null;
  /** Server-injected dealer-log lines (mode-switch announcements) merged into
   *  the outgoing GameState.log — variant-agnostic, unlike the engine logs. */
  private systemLog: string[] = [];
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
  /** Disconnect grace (Step 7, spec 8.2): playerId → pending sit-out. */
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disconnectGraceMs = DEFAULT_DISCONNECT_GRACE_MS;
  /** Rathole prevention (Step 8, spec 3.5): playerId → stack they left
   *  the last session with. WITHIN a session ratholing is structurally
   *  impossible (seats + stacks persist in the engine for the session's
   *  life); the only hole is re-entering short after an end→start in
   *  the same room, and this map closes it. */
  private exitStacks = new Map<string, number>();

  // ---------- connection lifecycle ----------

  onConnect(conn: Connection) {
    // No identity yet — everything but "join" is rejected until they join.
    this.send(conn, { type: "you", playerId: "", seat: null, host: false });
  }

  onClose(conn: Connection) {
    const playerId = this.joined.get(conn.id);
    this.joined.delete(conn.id);
    this.broadcastPresence();
    if (playerId === undefined) return;

    // Disconnect grace (spec 8.2): only when that was the player's LAST
    // live connection (a takeover kick leaves the new device connected),
    // and only for someone actually playing right now.
    for (const id of this.joined.values()) {
      if (id === playerId) return; // still connected elsewhere
    }
    if (!this.gm) return;
    const st = this.gm.state();
    if (st.phase === "ended") return;
    const seated = st.seats.find((s) => s.id === playerId);
    if (!seated || seated.sittingOut) return;

    this.clearGrace(playerId);
    this.pushLogQuiet(`${playerId} disconnected — ${this.disconnectGraceMs / 1000}s grace`);
    this.graceTimers.set(playerId, setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (!this.gm || this.gm.state().phase === "ended") return;
      // still gone after the grace: the engine sits them out (takes
      // effect next deal; the action clock covers their current hand)
      this.gm.toggleSitOut(playerId, true);
      this.afterMutation();
    }, this.disconnectGraceMs));
  }

  private clearGrace(playerId: string) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
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
      case "act":               return this.handleAct(conn, playerId, msg.action, msg.amount);
      case "timeBank":          return this.handleTimeBank(conn, playerId);
      case "show":              return this.handleShow(conn, playerId);
      case "chat":              return this.handleChat(conn, playerId, msg.text);
      case "submitArrangement": return this.handleSubmitArrangement(conn, playerId, msg.order);
      case "declare":           return this.handleDeclare(conn, playerId, msg.potIndex, msg.decision);
      case "host":              return this.handleHost(conn, playerId, msg.cmd);
      default:                  return this.error(conn, "Unknown message type");
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

    // back within the grace window — the pending sit-out is off (8.2)
    this.clearGrace(id);

    this.joined.set(conn.id, id);
    this.send(conn, {
      type: "you", playerId: id, seat: this.seatOf(id),
      host: this.roster.get(id)?.host ?? false,
    });
    this.send(conn, { type: "chatHistory", entries: this.chat });
    if (this.gm) {
      this.send(conn, {
        type: "state",
        state: filterStateFor(this.presentState(this.gm.state()), this.seatOf(id)),
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
    if (this.isPaused()) return this.error(conn, "Game is paused");
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
    const g = this.gm;
    if (!g) return this.error(conn, "No game running");
    if (!(g instanceof GameManager)) return this.error(conn, "No time bank in this mode");
    const seat = this.seatOf(playerId);
    // same rule as act: only the player on the clock can extend it
    if (seat == null || g.state().playerToAct !== seat) return this.error(conn, "Not your turn");
    if (!g.useTimeBank()) return this.error(conn, "No time bank left");
    this.afterMutation(); // broadcasts the new deadline + re-arms the clock
  }

  private handleShow(conn: Connection, playerId: string) {
    const g = this.gm;
    if (!g) return this.error(conn, "No game running");
    if (!(g instanceof GameManager)) return this.error(conn, "Not available in this mode");
    const seat = this.seatOf(playerId);
    // Same rule as act: only the seat the ENGINE says may show, may show.
    if (seat == null || g.state().canShowSeat !== seat) return this.error(conn, "You can't show right now");
    g.voluntaryShow(seat);
    this.afterMutation();
  }

  /** DFT picking: lock this player's hand-split. The seat is derived from the
   *  connection's identity — the message carries ONLY the order, so a player
   *  can never lock an arrangement for anyone but themselves. The engine
   *  enforces phase + showdown-membership + permutation-validity and throws. */
  private handleSubmitArrangement(conn: Connection, playerId: string, order: number[]) {
    const g = this.gm;
    if (!g) return this.error(conn, "No game running");
    if (!(g instanceof DoubleFlopManager)) return this.error(conn, "Not available in this mode");
    if (this.isPaused()) return this.error(conn, "Game is paused");
    const seat = this.seatOf(playerId);
    if (seat == null) return this.error(conn, "You're not seated");
    if (!Array.isArray(order) || order.length !== 6 || !order.every((n) => Number.isInteger(n))) {
      return this.error(conn, "Bad arrangement");
    }
    try {
      g.submitArrangement(seat, order);
    } catch (e) {
      console.error(`[TableServer] submitArrangement failed:`, e);
      return this.error(conn, "Arrangement rejected");
    }
    this.afterMutation();
  }

  /** DFT decisions: this player's blind run/surrender for one pot. Same rule —
   *  seat from identity, payload from the message. The engine enforces that the
   *  seat actually owes THIS pot's decision and hasn't already answered. */
  private handleDeclare(conn: Connection, playerId: string, potIndex: number, decision: string) {
    const g = this.gm;
    if (!g) return this.error(conn, "No game running");
    if (!(g instanceof DoubleFlopManager)) return this.error(conn, "Not available in this mode");
    if (this.isPaused()) return this.error(conn, "Game is paused");
    const seat = this.seatOf(playerId);
    if (seat == null) return this.error(conn, "You're not seated");
    if (decision !== "run" && decision !== "surrender") return this.error(conn, "Bad decision");
    if (!Number.isInteger(potIndex) || potIndex < 0) return this.error(conn, "Bad pot index");
    try {
      g.declare(seat, potIndex, decision);
    } catch (e) {
      console.error(`[TableServer] declare failed:`, e);
      return this.error(conn, "Declaration rejected");
    }
    this.afterMutation();
  }

  private handleChat(conn: Connection, playerId: string, text: string) {
    const clean = String(text ?? "").trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return;
    const entry: ChatEntry = {
      from: this.nameOf(playerId), fromId: playerId, text: clean, at: Date.now(),
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
        // The submitting host must be IN the game. Without this, a host
        // whose login doesn't match any player row becomes a silent
        // spectator of their own game — seated under a name that isn't
        // their identity, own cards stripped like everyone else's.
        if (!cmd.players.some((p) => p.id === playerId)) {
          return this.error(
            conn,
            `You're not in the player list — your row must be named "${playerId}"`
          );
        }
        // Register every player's login before the game exists: upsert
        // roster entries (never delete — spectators keep their logins).
        for (const p of cmd.players) {
          const kw = String(p.keyword ?? "").trim().toLowerCase();
          if (!kw) return this.error(conn, `Player "${p.name}" needs a keyword`);
        }
        // Rathole rule (spec 3.5): whoever cashed out of the last session
        // in this room must re-enter with at least that stack, capped at
        // the new game's max buy-in. Refuse loudly rather than silently
        // adjusting anyone's money.
        for (const p of cmd.players) {
          const exit = this.exitStacks.get(p.id);
          if (exit === undefined) continue;
          const floor = Math.min(exit, cmd.config.maxBuyIn);
          if (p.buyIn < floor) {
            return this.error(
              conn,
              `Rathole rule (3.5): ${p.name} left with ${fmt(exit)} and must re-enter with at least ${fmt(floor)}`
            );
          }
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
        this.disconnectGraceMs = cmd.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
        const mode: Variant = cmd.gameMode ?? "nlhe";
        if (mode === "dft" && cmd.players.length > MAX_DFT_SEATS) {
          return this.error(conn, `Double Flop Tex seats ${MAX_DFT_SEATS} max — remove a player`);
        }
        try {
          this.variant = mode;
          this.pendingVariant = null;
          this.dftPaused = false;
          this.config = cmd.config;
          this.systemLog = [];
          this.gm = this.makeEngine(mode, cmd.config, cmd.players);
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
      case "pause":
        if (this.gm instanceof GameManager) this.gm.togglePause(); // NLHE: in-engine
        else if (this.gm) this.dftPaused = !this.dftPaused;        // DFT: server-side
        break;
      case "setGameMode": {
        if (!this.gm) return this.error(conn, "No game running");
        const target = cmd.mode;
        if (target === this.variant && !this.pendingVariant) {
          return this.error(conn, `Already playing ${modeLabel(target)}`);
        }
        // 7-max guard for a switch TO dft — refuse loudly, never auto-sit anyone
        if (target === "dft") {
          const dealtIn = this.gm.state().seats.filter((s) => !s.sittingOut).length;
          if (dealtIn > MAX_DFT_SEATS) {
            return this.error(conn, `Double Flop Tex seats ${MAX_DFT_SEATS} max — sit someone out first`);
          }
        }
        this.pendingVariant = target; // applies at the next deal (7.4)
        this.announce(`Next hand: ${modeLabel(target)}`);
        break;
      }
      case "dealNext": {
        // dealing MID-hand would destroy the live pot; only between hands.
        if (this.gm?.state().phase !== "handEnded") {
          return this.error(conn, "Can't deal now");
        }
        this.dealHand();
        break;
      }
      case "addChips": this.gm?.approveAddChips(cmd.playerId, cmd.amount); break;
      case "sitOut":   this.gm?.toggleSitOut(cmd.playerId, cmd.out); break;
      case "end": {
        if (!this.gm) return this.error(conn, "No game running");
        for (const id of [...this.graceTimers.keys()]) this.clearGrace(id);
        const summary = this.gm.stop();
        // remember what everyone cashed out with — the rathole floor for
        // any future session in this room (3.5)
        for (const row of summary.rows) this.exitStacks.set(row.id, row.stack);
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
        this.dealHand(); // applies a queued mode switch (7.4), else deals next
        if (this.gm.state().phase === "handEnded") {
          // Still handEnded = fewer than 2 eligible players. Don't loop —
          // the host deals manually via "dealNext" once rebuys/sit-ins land.
          this.broadcastState(this.gm.state());
        } else {
          // through afterMutation so the NEW hand's action clock is armed
          this.afterMutation();
        }
      }, this.handEndPauseMs(base));
    }

    // Server-owned clocks (Step 6): the per-turn betting clock AND DFT's
    // shared picking/decisions window both surface as turnDeadlineAt. On
    // expiry fireTimeout() dispatches the right engine timeout by variant +
    // sub-phase. DFT's server-side pause freezes the clock entirely.
    if (this.clockTimer) { clearTimeout(this.clockTimer); this.clockTimer = null; }
    const paused = this.variant === "dft" && this.dftPaused;
    if (base.phase === "inHand" && base.turnDeadlineAt != null && !paused) {
      const wait = Math.max(0, base.turnDeadlineAt - Date.now()) + CLOCK_GRACE_MS;
      this.clockTimer = setTimeout(() => {
        this.clockTimer = null;
        if (!this.gm) return;
        const s = this.gm.state();
        if (s.phase !== "inHand" || s.turnDeadlineAt == null) return;
        // deadline moved (time bank landed as we fired)? stand down
        if (Date.now() < s.turnDeadlineAt) return;
        this.fireTimeout(); // NLHE timeout / DFT betting|picking|decisions timeout
        this.afterMutation();
      }, wait);
    }
  }

  // ---------- engine construction, mode switch, timers ----------

  private nextSeed(): number {
    return Date.now() + this.seedCounter++;
  }

  private makeEngine(mode: Variant, config: GameConfig, starters: StartingPlayer[], resume?: PlayerRecord[]): Engine {
    const players = starters.map((p) => ({ id: p.id, name: p.name, buyIn: p.buyIn }));
    return mode === "dft"
      ? new DoubleFlopManager(config, players, this.nextSeed(), resume)
      : new GameManager(config, players, resume);
  }

  /** Deal the next hand, first applying any queued mode switch (7.4). The
   *  switch hands the EXACT player records to a fresh engine of the new
   *  variant, so stacks + ledger are conserved. */
  private dealHand(): void {
    if (!this.gm) return;
    if (this.pendingVariant && this.pendingVariant !== this.variant && this.config) {
      const target = this.pendingVariant;
      const records = this.gm.exportPlayers();
      // re-check 7-max at deal time — players may have joined since the queue
      if (target === "dft" && records.filter((r) => !r.sittingOut).length > MAX_DFT_SEATS) {
        this.pendingVariant = null;
        this.announce(`Mode switch cancelled — Double Flop Tex seats ${MAX_DFT_SEATS} max`);
        this.gm.dealNextHand();
        return;
      }
      this.variant = target;
      this.pendingVariant = null;
      this.dftPaused = false;
      this.gm = this.makeEngine(target, this.config, [], records);
      this.gm.start();
      this.announce(`Now playing: ${modeLabel(target)}`);
      return;
    }
    this.gm.dealNextHand();
  }

  private fireTimeout(): void {
    const g = this.gm;
    if (!g) return;
    if (g instanceof GameManager) { g.timeout(); return; }
    // DFT: dispatch by sub-phase (betting per-turn, picking/decisions window)
    const sub = g.phase();
    if (sub === "betting") g.bettingTimeout();
    else if (sub === "picking") g.pickingTimeout();
    else if (sub === "decisions") g.decisionsTimeout();
  }

  private isPaused(): boolean {
    if (this.variant === "dft") return this.dftPaused;
    return this.gm?.state().phase === "paused";
  }

  /** How long to hold a finished hand before the next deal. A DFT hand that
   *  resolved through flips gets extra time so the reveal can play out. */
  private handEndPauseMs(base: GameState): number {
    const flips = base.variant === "dft" ? (base.dft?.flips.length ?? 0) : 0;
    if (flips > 0) return Math.min(DFT_REVEAL_MAX_MS, DFT_REVEAL_BASE_MS + flips * DFT_REVEAL_PER_FLIP_MS);
    return HAND_END_PAUSE_MS;
  }

  private announce(msg: string): void {
    this.systemLog.push(msg);
    if (this.systemLog.length > 15) this.systemLog = this.systemLog.slice(-15);
  }

  /** Apply server-owned presentation the engines don't know about: DFT's
   *  server-side pause, and the merged mode-switch announcements. */
  private presentState(base: GameState): GameState {
    let s = base;
    if (this.variant === "dft" && this.dftPaused && s.phase === "inHand") {
      s = { ...s, phase: "paused", playerToAct: null, legalActions: null };
    }
    if (this.systemLog.length) s = { ...s, log: [...s.log, ...this.systemLog] };
    return s;
  }

  /** One engine snapshot, filtered per receiving connection. */
  private broadcastState(base: GameState) {
    const at = Date.now();
    const presented = this.presentState(base);
    for (const conn of this.getConnections()) {
      const pid = this.joined.get(conn.id);
      if (pid === undefined) continue; // not joined: receives nothing
      this.send(conn, { type: "state", state: filterStateFor(presented, this.seatOf(pid)), at });
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

function modeLabel(v: Variant): string {
  return v === "dft" ? "Double Flop Tex" : "No-Limit Hold'em";
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
