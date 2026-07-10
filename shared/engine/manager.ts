// ============================================================
// GAME MANAGER — the "referee". Wraps poker-ts (which handles
// dealing, betting rounds, side pots, showdown) and adds
// everything from Parth's spec: session, ledger, sit-outs,
// time bank, pause, rebuy-between-hands, voluntary show.
//
// NO UI CODE IN HERE. In phase 1b this exact class moves onto
// the multiplayer server unchanged.
// ============================================================

import { Table } from "poker-ts";
import {
  Card, GameConfig, GameState, HandResultShare, LedgerRow, PlayerAction,
  PlayerRecord, Phase, SeatView, SessionSummary, BettingRound,
} from "./types";
import { handName } from "./handNames";

const MAX_SEATS = 8; // Parth 2.1

interface StartPlayer { id: string; name: string; buyIn: number }

export class GameManager {
  private table: InstanceType<typeof Table>;
  private config: GameConfig;
  private players = new Map<string, PlayerRecord>(); // by id
  private phase: Phase = "lobby";
  private handNumber = 0;
  private log: string[] = [];
  private lastHandResult: HandResultShare[] | null = null;
  private canShowSeat: number | null = null;

  // per-hand snapshots (poker-ts forbids reads after a hand ends)
  private holeSnapshot: (Card[] | null)[] = [];
  private boardSnapshot: Card[] = [];
  private stacksBeforeHand: number[] = [];
  private foldedSeats = new Set<number>();
  private lastActionBySeat = new Map<number, string>();
  private revealedSeats = new Set<number>();

  private deadBets = 0; // folded chips this round — poker-ts holds them outside pots() until the round ends
  private turnStartedAt: number | null = null;
  private turnDeadlineAt: number | null = null;
  private pausedRemainingMs: number | null = null;

  constructor(config: GameConfig, starters: StartPlayer[]) {
    this.config = config;
    this.table = new Table(
      { smallBlind: config.smallBlind, bigBlind: config.bigBlind },
      MAX_SEATS
    );
    starters.forEach((p, i) => {
      const buyIn = clamp(p.buyIn, config.minBuyIn, config.maxBuyIn);
      this.players.set(p.id, {
        id: p.id, name: p.name, seat: i, stack: buyIn, buyInTotal: buyIn,
        sittingOut: false, consecutiveTimeouts: 0,
        timeBank: config.timeBankSec, pendingAddChips: 0,
      });
    });
    this.pushLog(`Table created — blinds ${config.smallBlind}/${config.bigBlind}`);
  }

  // ---------- session controls (host, spec §7) ----------

  start() {
    if (this.phase !== "lobby") return;
    this.dealNextHand();
  }

  togglePause() {
    if (this.phase === "inHand") {
      this.phase = "paused";
      this.pausedRemainingMs = this.turnDeadlineAt
        ? Math.max(0, this.turnDeadlineAt - Date.now())
        : null;
      this.pushLog("Game paused by host");
    } else if (this.phase === "paused") {
      this.phase = "inHand";
      if (this.pausedRemainingMs != null) {
        this.turnStartedAt = Date.now();
        this.turnDeadlineAt = Date.now() + this.pausedRemainingMs;
        this.pausedRemainingMs = null;
      }
      this.pushLog("Game resumed");
    }
  }

  /** Stop = end session, finalize ledger (7.3). */
  stop(): SessionSummary {
    this.phase = "ended";
    this.pushLog("Session ended by host");
    return {
      endedAt: Date.now(),
      handsPlayed: this.handNumber,
      rows: this.ledger(),
    };
  }

  /** Host may change blinds/timer mid-session; applies from next hand (7.4). */
  updateConfig(partial: Partial<GameConfig>) {
    this.config = { ...this.config, ...partial };
    this.table.setForcedBets({
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
    });
    this.pushLog(
      `Settings updated — blinds ${this.config.smallBlind}/${this.config.bigBlind}, ` +
      `${this.config.actionTimeSec}s to act (from next hand)`
    );
  }

  // ---------- player management ----------

  toggleSitOut(playerId: string, out: boolean) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.sittingOut = out;
    if (!out) p.consecutiveTimeouts = 0;
    this.pushLog(`${p.name} ${out ? "sits out" : "is back in"}`);
    // takes effect at next deal; current hand is unaffected (6.2)
  }

  /** Rebuy: host-approved, applied only between hands (3.4). */
  approveAddChips(playerId: string, amount: number) {
    const p = this.players.get(playerId);
    if (!p || amount <= 0) return;
    const room = this.config.maxBuyIn - (p.stack + p.pendingAddChips);
    const add = Math.max(0, Math.min(amount, room));
    if (add === 0) return;
    p.pendingAddChips += add;
    this.pushLog(`${p.name} approved for +${fmt(add)} chips (next hand)`);
    if (this.phase === "handEnded" || this.phase === "lobby") this.applyPendingChips();
  }

  /** Fold-win only: the winner may voluntarily show (9.1). */
  voluntaryShow(seat: number) {
    if (this.canShowSeat !== seat || !this.lastHandResult) return;
    const cards = this.holeSnapshot[seat];
    if (!cards) return;
    this.revealedSeats.add(seat);
    const r = this.lastHandResult.find((x) => x.seat === seat);
    if (r) r.cards = cards;
    this.pushLog(`${this.nameAt(seat)} shows ${cards.map(cardStr).join(" ")}`);
    this.canShowSeat = null;
  }

  // ---------- the hand loop ----------

  dealNextHand() {
    if (this.phase === "ended") return;
    this.applyPendingChips();

    // rebuild seating: fresh Table each hand, seats stay fixed per player.
    // (poker-ts nulls busted seats and its button drifts with stand-ups; a
    // rebuild with our own button rotation is simpler and drift-proof.)
    this.table = new Table(
      { smallBlind: this.config.smallBlind, bigBlind: this.config.bigBlind },
      MAX_SEATS
    );
    const eligible = [...this.players.values()].filter(
      (p) => !p.sittingOut && p.stack > 0
    );
    if (eligible.length < 2) {
      this.phase = "handEnded";
      this.pushLog("Waiting for at least 2 active players…");
      return;
    }
    for (const p of eligible) this.table.sitDown(p.seat, p.stack);

    this.handNumber += 1;
    this.deadBets = 0;
    this.foldedSeats.clear();
    this.revealedSeats.clear();
    this.lastActionBySeat.clear();
    this.lastHandResult = null;
    this.canShowSeat = null;

    this.table.startHand(this.nextButtonSeat(eligible.map((p) => p.seat)));
    this.stacksBeforeHand = this.table
      .seats()
      .map((s: SeatShape | null) => (s ? s.totalChips : 0));
    this.holeSnapshot = this.table.holeCards().map((h: Card[] | null) => h);
    this.boardSnapshot = [];
    this.phase = "inHand";
    this.pushLog(`— Hand #${this.handNumber} —`);
    this.armTurnClock();
  }

  /** The single entry point for a player acting. */
  act(action: PlayerAction, amount?: number) {
    if (this.phase !== "inHand") return;
    const seat = this.table.playerToAct();
    const p = this.playerAtSeat(seat);
    if (p) p.consecutiveTimeouts = 0; // a real action resets the streak (6.1)
    this.applyAction(seat, action, amount);
  }

  /** Called by the shell when the visible clock hits zero (5.3). */
  timeout() {
    if (this.phase !== "inHand") return;
    const seat = this.table.playerToAct();
    const legal: PlayerAction[] = this.table.legalActions().actions;
    const auto: PlayerAction = legal.includes("check") ? "check" : "fold";
    const p = this.playerAtSeat(seat);
    if (p) {
      p.consecutiveTimeouts += 1;
      if (p.consecutiveTimeouts >= 2 && !p.sittingOut) {
        p.sittingOut = true; // auto sit-out (6.1)
        this.pushLog(`${p.name} auto sat out (2 timeouts in a row)`);
      }
    }
    this.pushLog(`${this.nameAt(seat)} timed out — auto ${auto}`);
    this.applyAction(seat, auto, undefined);
  }

  /** +30s once via time bank (5.2). Returns true if applied. */
  useTimeBank(): boolean {
    if (this.phase !== "inHand" || this.turnDeadlineAt == null) return false;
    const p = this.playerAtSeat(this.table.playerToAct());
    if (!p || p.timeBank <= 0) return false;
    const grant = Math.min(p.timeBank, 30);
    p.timeBank -= grant;
    this.turnDeadlineAt += grant * 1000;
    this.pushLog(`${p.name} uses time bank (+${grant}s)`);
    return true;
  }

  private applyAction(seat: number, action: PlayerAction, amount?: number) {
    const label =
      action === "fold" ? "FOLD"
      : action === "check" ? "CHECK"
      : action === "call" ? `CALL ${fmt(this.callAmountFor(seat))}`
      : `${action.toUpperCase()} ${fmt(amount ?? 0)}`;

    // poker-ts view quirk: a PREFLOP folder's dead bet stays visible in
    // seats().betSize (stale copy), but a POSTFLOP folder's betSize zeroes
    // instantly while the chips sit in an internal folded-bets bucket until
    // the round ends. Measure what actually disappears from the view.
    let foldBetBefore = 0;
    if (action === "fold") {
      const seatsArr = this.table.seats() as (SeatShape | null)[];
      foldBetBefore = seatsArr[seat]?.betSize ?? 0;
    }
    this.table.actionTaken(action, amount);
    if (action === "fold") {
      const seatsArr = this.table.seats() as (SeatShape | null)[];
      const after = seatsArr[seat]?.betSize ?? 0;
      this.deadBets += Math.max(0, foldBetBefore - after);
    }
    this.lastActionBySeat.set(seat, label);
    if (action === "fold") this.foldedSeats.add(seat);
    this.pushLog(`${this.nameAt(seat)}: ${label.toLowerCase()}`);

    if (!this.table.isBettingRoundInProgress()) {
      this.table.endBettingRound();
      this.deadBets = 0; // poker-ts just swept dead bets into the pots
      if (this.table.areBettingRoundsCompleted()) {
        // snapshot BEFORE showdown — poker-ts forbids reads after
        this.boardSnapshot = this.table.communityCards().slice();
        this.finishByShowdown();
        return;
      }
      if (!this.table.isHandInProgress()) {
        this.finishByFolds();
        return;
      }
      this.boardSnapshot = this.table.communityCards().slice();
    }
    if (this.table.isHandInProgress() && this.table.isBettingRoundInProgress()) {
      this.armTurnClock();
    }
  }

  private finishByShowdown() {
    this.table.showdown();
    const winners = this.table.winners() as WinnerPot[];
    const stacksAfter = this.table
      .seats()
      .map((s: SeatShape | null) => (s ? s.totalChips : 0));
    const results: HandResultShare[] = [];
    for (const pot of winners) {
      for (const [seat, hand] of pot) {
        this.revealedSeats.add(seat);
        const won = Math.max(0, stacksAfter[seat] - this.stacksBeforeHand[seat]);
        const existing = results.find((r) => r.seat === seat);
        if (existing) continue; // one row per player; amount is total delta
        results.push({
          seat, name: this.nameAt(seat), amountWon: won,
          handName: handName(hand.ranking), cards: hand.cards,
        });
        this.pushLog(
          `${this.nameAt(seat)} wins ${fmt(won)} with ${handName(hand.ranking)}`
        );
      }
    }
    // everyone still in at showdown reveals (9.1)
    for (let s = 0; s < MAX_SEATS; s++) {
      if (this.holeSnapshot[s] && !this.foldedSeats.has(s)) this.revealedSeats.add(s);
    }
    this.endHand(stacksAfter, results);
  }

  private finishByFolds() {
    const stacksAfter = this.table
      .seats()
      .map((s: SeatShape | null) => (s ? s.totalChips : 0));
    const results: HandResultShare[] = [];
    for (let s = 0; s < MAX_SEATS; s++) {
      const delta = stacksAfter[s] - (this.stacksBeforeHand[s] ?? 0);
      if (delta > 0) {
        results.push({ seat: s, name: this.nameAt(s), amountWon: delta, handName: null, cards: null });
        this.pushLog(`${this.nameAt(s)} takes the pot (${fmt(delta)}) — everyone folded`);
        this.canShowSeat = s; // may voluntarily show (9.1)
      }
    }
    this.endHand(stacksAfter, results);
  }

  private endHand(stacksAfter: number[], results: HandResultShare[]) {
    // sync canonical stacks (ledger stays true even across rebuilds)
    for (const p of this.players.values()) {
      const s = stacksAfter[p.seat];
      if (this.stacksBeforeHand[p.seat] !== undefined && this.wasDealtIn(p.seat)) {
        p.stack = s;
      }
      // time bank refill: +5s per hand played, capped (5.2)
      if (this.wasDealtIn(p.seat)) {
        p.timeBank = Math.min(this.config.timeBankSec, p.timeBank + 5);
      }
    }
    this.lastHandResult = results;
    this.phase = "handEnded";
    this.turnStartedAt = null;
    this.turnDeadlineAt = null;
    this.applyPendingChips();
  }

  // ---------- state snapshot for the UI ----------

  state(): GameState {
    const inHand = this.phase === "inHand" || this.phase === "paused";
    const tableSeats = inHand || this.phase === "handEnded"
      ? (this.table.seats() as (SeatShape | null)[])
      : [];
    const toAct = inHand && this.table.isHandInProgress()
      ? this.table.playerToAct() : null;
    const legal = toAct != null ? this.table.legalActions() : null;

    const seats: SeatView[] = [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => {
        const ts = tableSeats[p.seat] ?? null;
        const dealtIn = inHand && this.wasDealtIn(p.seat);
        return {
          seat: p.seat, id: p.id, name: p.name,
          stack: ts && dealtIn ? ts.stack : p.stack,
          betSize: ts && dealtIn ? ts.betSize : 0,
          inHand: dealtIn && !this.foldedSeats.has(p.seat),
          folded: this.foldedSeats.has(p.seat),
          sittingOut: p.sittingOut,
          isButton: inHand ? this.table.button() === p.seat : this.lastButton === p.seat,
          isTurn: toAct === p.seat,
          holeCards: this.holeSnapshot[p.seat] ?? null,
          revealed: this.revealedSeats.has(p.seat),
          lastAction: this.lastActionBySeat.get(p.seat) ?? null,
          timeBank: p.timeBank,
        };
      });

    const pots = inHand && this.table.isHandInProgress()
      ? (this.table.pots() as { size: number; eligiblePlayers: number[] }[])
          .map((p) => ({ size: p.size, eligibleSeats: p.eligiblePlayers }))
      : [];
    const betsOnTable = seats.reduce((a, s) => a + s.betSize, 0);

    return {
      phase: this.phase,
      handNumber: this.handNumber,
      config: this.config,
      seats,
      communityCards: this.boardSnapshot,
      pots,
      totalPot: pots.reduce((a, p) => a + p.size, 0) + betsOnTable + this.deadBets,
      round: inHand && this.table.isHandInProgress()
        ? (this.table.roundOfBetting() as BettingRound) : null,
      playerToAct: toAct,
      legalActions: legal ? (legal.actions as PlayerAction[]) : null,
      betRange: legal?.chipRange
        ? { min: legal.chipRange.min, max: legal.chipRange.max } : null,
      callAmount: toAct != null ? this.callAmountFor(toAct) : 0,
      turnStartedAt: this.turnStartedAt,
      turnDeadlineAt: this.turnDeadlineAt,
      lastHandResult: this.lastHandResult,
      log: this.log.slice(-60),
      canShowSeat: this.canShowSeat,
    };
  }

  ledger(): LedgerRow[] {
    return [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id, name: p.name, buyInTotal: p.buyInTotal,
        stack: p.stack, net: p.stack - p.buyInTotal,
      }));
  }

  // ---------- internals ----------

  private lastButton = -1;

  private nextButtonSeat(activeSeats: number[]): number {
    // rotate clockwise among currently-dealt-in seats (2.2)
    const sorted = [...activeSeats].sort((a, b) => a - b);
    const next = sorted.find((s) => s > this.lastButton) ?? sorted[0];
    this.lastButton = next;
    return next;
  }

  private armTurnClock() {
    this.turnStartedAt = Date.now();
    this.turnDeadlineAt = Date.now() + this.config.actionTimeSec * 1000;
  }

  private applyPendingChips() {
    for (const p of this.players.values()) {
      if (p.pendingAddChips > 0) {
        p.stack += p.pendingAddChips;
        p.buyInTotal += p.pendingAddChips;
        this.pushLog(`${p.name} added ${fmt(p.pendingAddChips)} chips`);
        p.pendingAddChips = 0;
      }
    }
  }

  private wasDealtIn(seat: number): boolean {
    return this.holeSnapshot[seat] != null;
  }

  private callAmountFor(seat: number): number {
    const seatsArr = this.table.seats() as (SeatShape | null)[];
    const maxBet = Math.max(0, ...seatsArr.map((s) => (s ? s.betSize : 0)));
    const mine = seatsArr[seat]?.betSize ?? 0;
    const stack = seatsArr[seat]?.stack ?? 0;
    return Math.min(maxBet - mine, stack);
  }

  private playerAtSeat(seat: number): PlayerRecord | undefined {
    return [...this.players.values()].find((p) => p.seat === seat);
  }

  private nameAt(seat: number): string {
    return this.playerAtSeat(seat)?.name ?? `Seat ${seat + 1}`;
  }

  private pushLog(msg: string) {
    this.log.push(msg);
  }
}

// poker-ts seat shape (verified by test): { totalChips, stack, betSize }
interface SeatShape { totalChips: number; stack: number; betSize: number }
// winners(): per pot, array of [seatIndex, { cards, ranking, strength }, holeCards]
type WinnerPot = [number, { cards: Card[]; ranking: number; strength: number }, Card[]][];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
export function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
function cardStr(c: Card): string {
  const suits = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
  return `${c.rank}${suits[c.suit]}`;
}
