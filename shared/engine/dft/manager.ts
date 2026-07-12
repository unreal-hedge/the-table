// ============================================================
// DOUBLE FLOP TEX — the variant "referee". Standalone (does NOT reuse
// NLHE's GameManager, by decision — see ROADMAP SessionCore note). Wires
// the seeded deck, the bomb-pot betting engine, the picking phase, and the
// flip/surrender showdown into one hand loop, and keeps the session ledger.
//
// NO UI, NO poker-ts. Phase 1D scope: the engine + its invariant test. The
// co-owned seam (GameState mapping, protocol, filter, server, timers-on-the-
// wire) is Step 6 and is NOT built here. Blind/simultaneous secrecy of
// arrangements + decisions is stored privately here and MUST be enforced by
// the Step 6 filter on the wire.
// ============================================================

import type { Card, GameConfig, LedgerRow, PlayerRecord, SessionSummary } from "../types";
import type { TableEngine } from "../table-engine";
import { nextButtonSeat, clamp, ledgerRows } from "../util";
import { Deck, makeRng } from "./deck";
import { DftBetting, type BetActionType, type LegalBet } from "./betting";
import {
  prepareShowdown, finalizeShowdown, decisionSeatsOf,
  type Arrangement, type Boards, type Decision, type PreparedContest,
} from "./showdown";

export const MAX_DFT_SEATS = 6; // one 52-card deck can't deal 6 hole cards to more
const INCREMENT = 50;
const PICK_DECIDE_SEC = 30;

export type DftPhase = "lobby" | "betting" | "picking" | "decisions" | "handEnded" | "ended";

export interface DftStarter { id: string; name: string; buyIn: number }
export interface DealOverride { hole: Map<number, Card[]>; boards: Boards }

interface Dealt { hole: Map<number, Card[]>; boards: Boards }

export class DoubleFlopManager implements TableEngine {
  private readonly config: GameConfig;
  private readonly rng: () => number;
  private readonly players = new Map<string, PlayerRecord>();
  private phaseVal: DftPhase = "lobby";
  private handNumber = 0;
  private lastButton = -1;

  // per-hand
  private betting: DftBetting | null = null;
  private dealt: Dealt | null = null;
  private eligible: number[] = []; // dealt-in seats this hand
  private showdownSeats: number[] = []; // non-folded at showdown
  private arrangements = new Map<number, Arrangement>();
  private lockedPick = new Set<number>();
  private prepared: PreparedContest[] | null = null;
  private decisions = new Map<string, Decision>();
  private requiredDecisions: { potIndex: number; seat: number }[] = [];
  private lastDelta = new Map<number, number>();
  private phaseDeadline: number | null = null;

  constructor(config: GameConfig, starters: DftStarter[], seed: number) {
    this.config = config;
    this.rng = makeRng(seed);
    starters.slice(0, MAX_DFT_SEATS).forEach((p, i) => {
      const stack = clamp(p.buyIn, config.minBuyIn, config.maxBuyIn);
      this.players.set(p.id, {
        id: p.id, name: p.name, seat: i, stack, buyInTotal: stack,
        sittingOut: false, consecutiveTimeouts: 0, timeBank: config.timeBankSec, pendingAddChips: 0,
      });
    });
  }

  // ---------- TableEngine ----------

  start(): void {
    if (this.phaseVal !== "lobby") return;
    this.dealNextHand();
  }

  handInProgress(): boolean {
    return this.phaseVal === "betting" || this.phaseVal === "picking" || this.phaseVal === "decisions";
  }

  ledger(): LedgerRow[] {
    return ledgerRows(this.players.values());
  }

  stop(): SessionSummary {
    this.phaseVal = "ended";
    return { endedAt: Date.now(), handsPlayed: this.handNumber, rows: this.ledger() };
  }

  // ---------- the hand loop ----------

  dealNextHand(override?: DealOverride): void {
    if (this.phaseVal === "ended") return;
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    const eligibleSeats = override
      ? [...override.hole.keys()].sort((a, b) => a - b)
      : [...this.players.values()].filter((p) => p.stack > 0).map((p) => p.seat).sort((a, b) => a - b);
    if (eligibleSeats.some((s) => (bySeat.get(s)?.stack ?? 0) <= 0)) {
      throw new Error("dealt an override seat with no chips");
    }
    if (eligibleSeats.length < 2) {
      this.phaseVal = "handEnded";
      return;
    }

    this.eligible = eligibleSeats;
    this.dealt = override
      ? { hole: override.hole, boards: override.boards }
      : this.dealFromDeck(eligibleSeats);

    const button = nextButtonSeat(eligibleSeats, this.lastButton);
    this.lastButton = button;
    const ante = this.config.bigBlind;
    this.betting = new DftBetting(
      eligibleSeats.map((s) => ({ seat: s, stack: bySeat.get(s)!.stack })),
      button,
      { ante, minBet: ante, increment: INCREMENT }
    );

    this.arrangements = new Map();
    this.lockedPick = new Set();
    this.prepared = null;
    this.decisions = new Map();
    this.requiredDecisions = [];
    this.lastDelta = new Map();
    this.handNumber += 1;
    this.phaseVal = "betting";
    this.pumpBetting();
  }

  private dealFromDeck(order: number[]): Dealt {
    const deck = new Deck(this.rng);
    const hole = new Map<number, Card[]>(order.map((s) => [s, []]));
    for (let r = 0; r < 6; r++) for (const s of order) hole.get(s)!.push(deck.draw(1)[0]);
    deck.burn();
    const flopA = deck.draw(3);
    const flopB = deck.draw(3);
    deck.burn(); const turnA = deck.draw(1)[0];
    deck.burn(); const turnB = deck.draw(1)[0];
    deck.burn(); const riverA = deck.draw(1)[0];
    deck.burn(); const riverB = deck.draw(1)[0];
    return { hole, boards: { a: [...flopA, turnA, riverA], b: [...flopB, turnB, riverB] } };
  }

  // ----- betting phase (turn-based) -----

  currentActor(): number | null {
    return this.phaseVal === "betting" ? this.betting!.currentActor() : null;
  }
  legal(): LegalBet {
    if (this.phaseVal !== "betting") return { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };
    return this.betting!.legal();
  }
  act(action: BetActionType, amount?: number): void {
    if (this.phaseVal !== "betting") throw new Error("not in a betting phase");
    this.betting!.act(action, amount);
    this.pumpBetting();
  }

  private pumpBetting(): void {
    const b = this.betting!;
    while (b.status() === "roundComplete") b.beginNextRound(); // all cards pre-dealt; just advance
    if (b.isComplete()) this.postBetting();
    else this.phaseVal = "betting";
  }

  private postBetting(): void {
    const b = this.betting!;
    const wf = b.winnerByFold();
    if (wf !== null) {
      const pot = b.totalPot();
      this.settle(new Map([[wf, pot]]));
      return;
    }
    this.showdownSeats = b.seats().filter((s) => !b.isFolded(s));
    for (const s of this.showdownSeats) {
      const h = this.dealt!.hole.get(s)!;
      this.arrangements.set(s, defaultArrangement(h)); // pre-filled, always playable
    }
    this.phaseVal = "picking";
    this.phaseDeadline = Date.now() + PICK_DECIDE_SEC * 1000;
  }

  // ----- picking phase (simultaneous) -----

  pickingSeats(): number[] {
    return [...this.showdownSeats];
  }
  lockedPickSeats(): number[] {
    return [...this.lockedPick]; // "who has locked", never "what" — safe to expose
  }
  submitArrangement(seat: number, order: number[]): void {
    if (this.phaseVal !== "picking") throw new Error("not in the picking phase");
    if (!this.showdownSeats.includes(seat)) throw new Error("seat not in this showdown");
    if (this.lockedPick.has(seat)) throw new Error("arrangement already locked");
    if (!isPermutation6(order)) throw new Error("arrangement must be a permutation of 0..5");
    this.arrangements.set(seat, arrangementFromOrder(this.dealt!.hole.get(seat)!, order));
    this.lockedPick.add(seat);
    if (this.showdownSeats.every((s) => this.lockedPick.has(s))) this.finishPicking();
  }
  /** Timer fired: lock every un-submitted seat at its current (default) layout. */
  pickingTimeout(): void {
    if (this.phaseVal !== "picking") return;
    for (const s of this.showdownSeats) this.lockedPick.add(s);
    this.finishPicking();
  }

  private finishPicking(): void {
    const pots = this.betting!.sidePots();
    this.prepared = prepareShowdown(pots, this.arrangements, this.dealt!.boards, this.rng);
    this.requiredDecisions = [];
    for (const c of this.prepared) {
      for (const seat of decisionSeatsOf(c)) this.requiredDecisions.push({ potIndex: c.potIndex, seat });
    }
    if (this.requiredDecisions.length === 0) {
      this.finalizeShowdown();
    } else {
      this.decisions = new Map();
      this.phaseVal = "decisions";
      this.phaseDeadline = Date.now() + PICK_DECIDE_SEC * 1000;
    }
  }

  // ----- decision phase (simultaneous, blind run/surrender) -----

  /** Which (pot, seat) run/surrender decisions are still owed. Exposes only
   *  the request, never any submitted value. */
  pendingDecisions(): { potIndex: number; seat: number }[] {
    return this.requiredDecisions.filter((d) => !this.decisions.has(`${d.potIndex}:${d.seat}`));
  }
  declare(seat: number, potIndex: number, decision: Decision): void {
    if (this.phaseVal !== "decisions") throw new Error("not in the decision phase");
    const key = `${potIndex}:${seat}`;
    if (!this.requiredDecisions.some((d) => d.potIndex === potIndex && d.seat === seat)) {
      throw new Error(`seat ${seat} has no decision to make in pot ${potIndex}`);
    }
    if (this.decisions.has(key)) throw new Error("decision already made");
    this.decisions.set(key, decision);
    if (this.pendingDecisions().length === 0) this.finalizeShowdown();
  }
  /** Timer fired: everyone who didn't declare defaults to RUN (play it out). */
  decisionsTimeout(): void {
    if (this.phaseVal !== "decisions") return;
    this.finalizeShowdown(); // finalizeShowdown() treats any missing decision as "run"
  }

  private finalizeShowdown(): void {
    const delta = finalizeShowdown(this.prepared!, this.decisions, this.arrangements, this.rng);
    this.settle(delta);
  }

  private settle(delta: Map<number, number>): void {
    const b = this.betting!;
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    for (const s of this.eligible) {
      bySeat.get(s)!.stack = b.stackOf(s) + (delta.get(s) ?? 0);
    }
    this.lastDelta = delta;
    this.phaseVal = "handEnded";
    this.phaseDeadline = null;
  }

  // ---------- inspection (tests / future view mapping) ----------

  phase(): DftPhase {
    return this.phaseVal;
  }
  stackOf(seat: number): number {
    return [...this.players.values()].find((p) => p.seat === seat)?.stack ?? 0;
  }
  potTotal(): number {
    return this.betting?.totalPot() ?? 0;
  }
  sidePots() {
    return this.betting?.sidePots() ?? [];
  }
  contributedOf(seat: number): number {
    return this.betting?.contributedOf(seat) ?? 0;
  }
  boards(): Boards | null {
    return this.dealt?.boards ?? null;
  }
  holeOf(seat: number): Card[] | null {
    return this.dealt?.hole.get(seat) ?? null;
  }
  lastHandDelta(): Map<number, number> {
    return new Map(this.lastDelta);
  }

  /** Total chips in play right now — invariant: always equals total bought in.
   *  Mid-hand the truth lives in the betting engine; between hands, in stacks. */
  chipTotal(): number {
    const live = this.betting && this.handInProgress();
    const dealtIn = live ? new Set(this.betting!.seats()) : new Set<number>();
    let t = 0;
    for (const p of this.players.values()) {
      t += live && dealtIn.has(p.seat) ? this.betting!.stackOf(p.seat) : p.stack;
    }
    if (live) t += this.betting!.totalPot();
    return t;
  }
}

// ---------- arrangement helpers ----------

/** Default split: cards 1-2 / 3-4 / 5-6. Always valid and playable. */
function defaultArrangement(hole: Card[]): Arrangement {
  return { handA: [hole[0], hole[1]], handB: [hole[2], hole[3]], tex: [hole[4], hole[5]] };
}

function arrangementFromOrder(hole: Card[], order: number[]): Arrangement {
  return {
    handA: [hole[order[0]], hole[order[1]]],
    handB: [hole[order[2]], hole[order[3]]],
    tex: [hole[order[4]], hole[order[5]]],
  };
}

function isPermutation6(order: number[]): boolean {
  if (order.length !== 6) return false;
  const seen = new Set(order);
  return seen.size === 6 && [0, 1, 2, 3, 4, 5].every((i) => seen.has(i));
}
