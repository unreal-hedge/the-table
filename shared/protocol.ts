// ============================================================
// WIRE PROTOCOL — the contract between the game server (party/)
// and any client (2D now, 3D later). Small intent messages go up;
// the authoritative, per-player-filtered GameState comes down.
//
// Co-owned with Parth, like engine/types.ts — change only by
// agreement. Plain types only: no UI imports, no server imports.
// ============================================================

import type {
  GameConfig, GameState, PlayerAction, SessionSummary,
} from "./engine/types";

// ---------- client → server ----------

export type ClientMessage =
  | { type: "join"; playerId: string } // PROVISIONAL until Step 5 keyword login
  | { type: "act"; action: PlayerAction; amount?: number }
  | { type: "show" }                   // voluntary show after a fold-win (spec 9.1)
  | { type: "chat"; text: string }
  | { type: "host"; cmd: HostCommand };

export type HostCommand =
  | { kind: "start"; config: GameConfig; players: StartingPlayer[] }
  | { kind: "pause" }     // toggles pause/resume (spec 7.2)
  | { kind: "dealNext" }  // manual deal when auto-deal is waiting (e.g. after rebuys)
  | { kind: "addChips"; playerId: string; amount: number } // rebuy approval (3.4)
  | { kind: "sitOut"; playerId: string; out: boolean }     // (6.x)
  | { kind: "end" };      // finalize session + ledger (7.3)

export interface StartingPlayer { id: string; name: string; buyIn: number }

// ---------- server → client ----------

export interface ChatEntry { from: string; text: string; at: number }

export type ServerMessage =
  | { type: "you"; playerId: string; seat: number | null } // seat null until seated
  | { type: "state"; state: GameState } // YOUR cards only; others stripped until revealed
  | { type: "chat"; entry: ChatEntry }
  | { type: "chatHistory"; entries: ChatEntry[] } // sent once on join
  | { type: "ended"; summary: SessionSummary }
  | { type: "error"; msg: string }; // "not your turn", "host only", …

// ---------- provisional identity (REPLACED in Step 5) ----------

/** INSECURE placeholder: these playerIds carry host powers until
 *  keyword login lands in Step 5. See the warning atop ROADMAP.md. */
export const PROVISIONAL_HOST_IDS: readonly string[] = ["kabir", "parth"];

export const CHAT_HISTORY_LIMIT = 50; // keep the last ~50 messages (roadmap)
export const CHAT_MAX_LENGTH = 200;   // sanity cap per message
