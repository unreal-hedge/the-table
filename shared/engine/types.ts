// ============================================================
// SHARED TYPES — the contract between the engine and any UI.
// The 2D UI, the future 3D UI, and the future multiplayer
// server ALL speak in these types. Keep this file UI-free.
// ============================================================

export interface Card {
  rank: "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
  suit: "clubs" | "diamonds" | "hearts" | "spades";
}

export type BettingRound = "preflop" | "flop" | "turn" | "river";

export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise";

export interface GameConfig {
  smallBlind: number;      // Parth spec 4.1 — cash default 100
  bigBlind: number;        // 200
  defaultBuyIn: number;    // 3.2 — 1000
  minBuyIn: number;        // 3.3 — 500
  maxBuyIn: number;        // 3.3 — 50000
  actionTimeSec: number;   // 5.1 — 30
  timeBankSec: number;     // 5.2 — 30, refills +5/hand up to cap
}

export const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 100,
  bigBlind: 200,
  defaultBuyIn: 1000,
  minBuyIn: 500,
  maxBuyIn: 50000,
  actionTimeSec: 30,
  timeBankSec: 30,
};

/** A person at the table, as the engine tracks them across hands. */
export interface PlayerRecord {
  id: string;
  name: string;
  seat: number;            // fixed seat index 0..7
  stack: number;           // current chips (synced from table after each hand)
  buyInTotal: number;      // ledger: everything they've put in (3.6)
  sittingOut: boolean;     // 6.x
  consecutiveTimeouts: number; // 2 in a row => auto sit-out (6.1)
  timeBank: number;        // seconds remaining (5.2)
  pendingAddChips: number; // approved rebuys applied between hands (3.4)
}

/** What the UI needs to draw one seat. */
export interface SeatView {
  seat: number;
  id: string;
  name: string;
  stack: number;
  betSize: number;          // chips in front of them this round
  inHand: boolean;          // dealt in and not folded
  folded: boolean;
  sittingOut: boolean;
  isButton: boolean;
  isTurn: boolean;
  holeCards: Card[] | null; // engine always includes them in hot-seat mode;
                            // in multiplayer (1b) the server strips these per-viewer
                            // (DFT carries 6 here instead of 2)
  revealed: boolean;        // face-up (showdown / voluntary show)
  lastAction: string | null; // "RAISE 600", "FOLD" — the Pokerist-style badge
  timeBank: number;

  // ---- DFT-only (variant === "dft"), SECRET like holeCards ----
  // The seat's locked hand-split order (a permutation of 0..5) and its
  // run/surrender declarations. The full-truth state carries every seat's
  // values; the filter strips OTHER seats' pre-reveal, exactly like holeCards.
  // `null`/absent means "not this variant, or not locked/declared yet".
  arrangement?: number[] | null;
  declarations?: { potIndex: number; decision: DftDecision }[];
}

export type Phase =
  | "lobby"        // configuring, not started
  | "inHand"       // betting in progress
  | "handEnded"    // showing results, waiting for next deal
  | "paused"       // host paused (7.2)
  | "ended";       // session stopped, ledger final (7.3)

/** Which engine produced this snapshot (Step 6 seam discriminator). */
export type Variant = "nlhe" | "dft";

/** DFT run/surrender declaration (mirrors the engine's Decision). */
export type DftDecision = "run" | "surrender";

/** DFT sub-phase inside `phase: "inHand"`. */
export type DftSubPhase = "betting" | "picking" | "decisions";

export interface PotView {
  size: number;
  eligibleSeats: number[];
}

export interface HandResultShare {
  seat: number;
  name: string;
  amountWon: number;
  handName: string | null;  // "Full house" — null when everyone folded
  cards: Card[] | null;     // best five, when known
}

/** DFT public/global view (variant === "dft"). Per-seat secrets
 *  (hole cards, arrangement, declarations) live on SeatView; this
 *  carries only board + phase + WHO-has-locked, all public. */
export interface DftBoardsView {
  a: Card[]; // Board A — REVEALED cards only (flop→turn→river as rounds complete)
  b: Card[]; // Board B — REVEALED cards only
}
export interface DftContestView {
  potIndex: number;
  amount: number;   // chips contested in this pot's flip
  seats: number[];  // who is being asked to run/surrender here (public: who, not what)
  // Which of those seats may actually SURRENDER (R1: banker-only — only a
  // player who already owns a guaranteed share). Everyone else must RUN. The
  // UI offers surrender only to these seats; the engine rejects it from others.
  surrenderSeats: number[];
}
export interface DftView {
  subPhase: DftSubPhase;
  boards: DftBoardsView;
  // picking phase: who's involved + who has locked (both public "who")
  picking: { deadlineAt: number | null; seats: number[]; lockedSeats: number[] } | null;
  // decisions phase: the contests + who has declared (public); the WHAT
  // (each seat's decision) rides SeatView.declarations, stripped per viewer.
  decisions: {
    deadlineAt: number | null;
    contests: DftContestView[];
    lockedSeats: { potIndex: number; seat: number }[];
  } | null;
}

export interface GameState {
  variant: Variant;                 // which engine produced this (Step 6 seam)
  phase: Phase;
  handNumber: number;
  config: GameConfig;
  seats: SeatView[];
  communityCards: Card[];
  pots: PotView[];
  totalPot: number;
  round: BettingRound | null;
  playerToAct: number | null;       // seat index
  legalActions: PlayerAction[] | null;
  betRange: { min: number; max: number } | null;
  callAmount: number;               // chips needed to call for actor
  turnStartedAt: number | null;     // ms epoch — UI runs the visible countdown
  turnDeadlineAt: number | null;    // ms epoch, extends when time bank used
  lastHandResult: HandResultShare[] | null;
  log: string[];                    // dealer log, newest last
  canShowSeat: number | null;       // fold-win: this seat may voluntarily show (9.1)
  dft?: DftView;                    // present iff variant === "dft"
}

/** Ledger rows (3.6). */
export interface LedgerRow {
  id: string;
  name: string;
  buyInTotal: number;
  stack: number;
  net: number;
}

export interface SessionSummary {
  endedAt: number;
  handsPlayed: number;
  rows: LedgerRow[];
}
