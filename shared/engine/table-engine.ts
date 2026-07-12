// ============================================================
// TableEngine — the session-lifecycle surface shared by every variant
// engine. DoubleFlopManager implements this; NLHE's GameManager conforms
// in spirit and will be retrofitted when SessionCore is extracted (see
// ROADMAP). Variant-specific interaction (betting act, picking, run/
// surrender) lives on the concrete manager, not here.
// ============================================================

import type { LedgerRow, SessionSummary } from "./types";

export interface TableEngine {
  /** Begin the session — deals the first hand. */
  start(): void;
  /** Deal the next hand (between-hands only). */
  dealNextHand(): void;
  /** True while a hand is live (betting / picking / deciding). */
  handInProgress(): boolean;
  /** Current session ledger. */
  ledger(): LedgerRow[];
  /** End the session and return the final summary. */
  stop(): SessionSummary;
}
