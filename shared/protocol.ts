// ============================================================
// WIRE PROTOCOL — the contract between the game server (party/)
// and any client (2D now, 3D later). Small intent messages go up;
// the authoritative, per-player-filtered GameState comes down.
//
// Co-owned with Parth, like engine/types.ts — change only by
// agreement. Plain types only: no UI imports, no server imports.
// ============================================================

import type {
  GameConfig, GameState, LedgerRow, PlayerAction, SessionSummary,
} from "./engine/types";

// ---------- client → server ----------

export type ClientMessage =
  // Login (spec 8.x): playerId + keyword must match the room roster.
  // Bootstrap: the FIRST join in a fresh room claims it — that person
  // becomes host and their keyword is registered as typed.
  | { type: "join"; playerId: string; keyword: string }
  | { type: "act"; action: PlayerAction; amount?: number }
  | { type: "timeBank" }               // +30s, actor only — server-verified (spec 5.2)
  | { type: "show" }                   // voluntary show after a fold-win (spec 9.1)
  | { type: "chat"; text: string }
  | { type: "host"; cmd: HostCommand };

export type HostCommand =
  | {
      kind: "start";
      config: GameConfig;
      players: StartingPlayer[];
      /** Disconnect grace before auto sit-out (spec 8.2). Defaults to
       *  2 minutes; overridable so tests don't wait that long. */
      disconnectGraceMs?: number;
    }
  | { kind: "pause" }     // toggles pause/resume (spec 7.2)
  | { kind: "dealNext" }  // manual deal when auto-deal is waiting (e.g. after rebuys)
  | { kind: "addChips"; playerId: string; amount: number } // rebuy approval (3.4)
  | { kind: "sitOut"; playerId: string; out: boolean }     // (6.x)
  | { kind: "end" };      // finalize session + ledger (7.3)

export interface StartingPlayer {
  id: string;
  name: string;
  buyIn: number;
  keyword?: string; // required by the server for online starts
  host?: boolean;   // co-host flag (the room's creator is always host)
}

// ---------- server → client ----------

export interface ChatEntry { from: string; text: string; at: number }

export type ServerMessage =
  | { type: "you"; playerId: string; seat: number | null; host: boolean }
  // `at` = server clock when sent: clients offset their countdown display
  // by (at - Date.now()) so phone clock skew doesn't lie about the timer.
  | { type: "state"; state: GameState; at: number } // YOUR cards only; others stripped until revealed
  | { type: "noGame" } // join response when no game is running — clears any stale client state
  | { type: "kicked" } // this connection lost its seat to a login from another device (8.2)
  | { type: "presence"; members: PresenceMember[] } // who's connected right now
  | { type: "ledger"; rows: LedgerRow[] } // session ledger (server-computed; engine stays untouched)
  | { type: "chat"; entry: ChatEntry }
  | { type: "chatHistory"; entries: ChatEntry[] } // sent once on join
  | { type: "ended"; summary: SessionSummary }
  | { type: "error"; msg: string }; // "not your turn", "host only", …

/** A live connection in the room (connected ≠ seated: spectators appear too). */
export interface PresenceMember { id: string; name: string }

export const CHAT_HISTORY_LIMIT = 50; // keep the last ~50 messages (roadmap)
export const CHAT_MAX_LENGTH = 200;   // sanity cap per message

/** The one message a failed login ever gets — identical whether the
 *  player id exists or not, so guessers learn nothing. */
export const INVALID_LOGIN = "Invalid login";
