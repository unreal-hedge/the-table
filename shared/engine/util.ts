// ============================================================
// Shared engine helpers — tiny, pure, UI-free. Extracted so the DFT
// engine reuses them without duplicating logic. (NLHE's GameManager
// keeps its own copies for now; deduping it is the deferred SessionCore
// work — see ROADMAP. We do NOT touch GameManager this phase.)
// ============================================================

import type { LedgerRow, PlayerRecord, SeatView } from "./types";

export function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Next button seat, rotating clockwise among the given active seats. */
export function nextButtonSeat(activeSeats: number[], lastButton: number): number {
  const sorted = [...activeSeats].sort((a, b) => a - b);
  return sorted.find((s) => s > lastButton) ?? sorted[0];
}

/** A numbered but unoccupied seat, for the fixed seat grid (item 2). Both
 *  engines emit MAX_SEATS/MAX_DFT_SEATS slots; empty ones use this. */
export function emptySeatView(seat: number): SeatView {
  return {
    seat, empty: true, id: "", name: "", stack: 0, betSize: 0,
    inHand: false, folded: false, sittingOut: false, isButton: false,
    isTurn: false, holeCards: null, revealed: false, lastAction: null, timeBank: 0,
  };
}

/** Ledger rows from player records (net = stack - total bought in). */
export function ledgerRows(players: Iterable<PlayerRecord>): LedgerRow[] {
  return [...players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ id: p.id, name: p.name, buyInTotal: p.buyInTotal, stack: p.stack, net: p.stack - p.buyInTotal }));
}
