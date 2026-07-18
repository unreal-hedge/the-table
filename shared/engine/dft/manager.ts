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

import type {
  BettingRound, Card, DftDecision, DftFlipView, DftView, GameConfig, GameState, HandResultShare,
  LedgerRow, Phase, PlayerAction, PlayerRecord, SeatView, SessionSummary,
} from "../types";
import type { TableEngine } from "../table-engine";
import { nextButtonSeat, clamp, ledgerRows, fmt, emptySeatView } from "../util";
import { Deck, makeRng } from "./deck";
import { DftBetting, type BetActionType, type LegalBet } from "./betting";
import {
  prepareShowdown, finalizeShowdown, decisionSeatsOf, surrenderSeatsOf,
  type Arrangement, type Boards, type Decision, type PreparedContest,
} from "./showdown";

export const MAX_DFT_SEATS = 7; // 7×6 hole + two 5-card boards = 52 exactly (no burns); 8 is impossible
const INCREMENT = 50;
const PICK_DECIDE_SEC = 30;
// DFT's 3 betting rounds reuse NLHE's shared `round` tag for display (no preflop).
const ROUND_TAG: BettingRound[] = ["flop", "turn", "river"];

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
  private log: string[] = []; // DFT dealer log — so the table isn't silent (item 1)
  private waitingReason: string | null = null;

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
  // showdown flips in reveal order (rep flips from prepare, then the final flip
  // from finalize). Exposed only at handEnded — never while decisions are blind.
  private flipLog: DftFlipView[] = [];
  private lastDelta = new Map<number, number>();
  private phaseDeadline: number | null = null;
  // per-betting-turn action clock (mirrors NLHE; the server owns enforcement,
  // this just surfaces turnStartedAt/turnDeadlineAt in the GameState snapshot)
  private turnStartedAt: number | null = null;
  private turnDeadlineAt: number | null = null;
  // the submitted hand-split ORDER per seat (a permutation of 0..5), so a
  // viewer can see their own lock; defaults to 0..5 (the pre-filled split)
  private arrangementOrder = new Map<number, number[]>();

  constructor(config: GameConfig, starters: DftStarter[], seed: number, resume?: PlayerRecord[]) {
    this.config = config;
    this.rng = makeRng(seed);
    if (resume) {
      // mid-session engine handoff (mode switch): adopt the exact player
      // records — stacks, buyInTotal (the ledger), sit-out — NO clamping,
      // NO buyInTotal reset. Chips must be conserved across the switch.
      if (resume.length > MAX_DFT_SEATS) {
        throw new Error(`Double Flop Tex is ${MAX_DFT_SEATS}-max; got ${resume.length} players`);
      }
      for (const p of resume) this.players.set(p.id, { ...p });
      return;
    }
    if (starters.length > MAX_DFT_SEATS) {
      throw new Error(`Double Flop Tex is ${MAX_DFT_SEATS}-max; got ${starters.length} players`);
    }
    starters.forEach((p, i) => {
      const stack = clamp(p.buyIn, config.minBuyIn, config.maxBuyIn);
      this.players.set(p.id, {
        id: p.id, name: p.name, seat: i, stack, buyInTotal: stack,
        sittingOut: false, consecutiveTimeouts: 0, timeBank: config.timeBankSec,
        pendingAddChips: 0, spectating: false,
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
    this.applyPendingChips(); // approved rebuys land between hands (3.4)
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    const eligibleSeats = override
      ? [...override.hole.keys()].sort((a, b) => a - b)
      : [...this.players.values()]
          .filter((p) => !p.sittingOut && p.stack > 0) // sit-outs skip the deal (6.x)
          .map((p) => p.seat).sort((a, b) => a - b);
    if (eligibleSeats.some((s) => (bySeat.get(s)?.stack ?? 0) <= 0)) {
      throw new Error("dealt an override seat with no chips");
    }
    if (eligibleSeats.length < 2) {
      this.phaseVal = "handEnded";
      this.waitingReason = "Waiting for at least 2 players with chips";
      this.pushLog(this.waitingReason);
      return;
    }
    this.waitingReason = null;

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
    this.arrangementOrder = new Map();
    this.lockedPick = new Set();
    this.prepared = null;
    this.decisions = new Map();
    this.requiredDecisions = [];
    this.flipLog = [];
    this.lastDelta = new Map();
    this.handNumber += 1;
    this.pushLog(`— Hand #${this.handNumber} — antes in, two boards dealt`);
    this.phaseVal = "betting";
    this.pumpBetting();
  }

  private dealFromDeck(order: number[]): Dealt {
    const deck = new Deck(this.rng);
    const hole = new Map<number, Card[]>(order.map((s) => [s, []]));
    for (let r = 0; r < 6; r++) for (const s of order) hole.get(s)!.push(deck.draw(1)[0]);
    // No burns: 7 × 6 hole + two 5-card boards = 52 exactly. Burns are a
    // physical-casino anti-marking ritual, meaningless under a seeded shuffle.
    const flopA = deck.draw(3);
    const flopB = deck.draw(3);
    const turnA = deck.draw(1)[0];
    const turnB = deck.draw(1)[0];
    const riverA = deck.draw(1)[0];
    const riverB = deck.draw(1)[0];
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
    const actor = this.betting!.currentActor();
    const p = actor != null ? this.playerAtSeat(actor) : undefined;
    if (p) p.consecutiveTimeouts = 0; // a real action resets the timeout streak (6.1)
    this.betting!.act(action, amount);
    this.pumpBetting();
  }

  /** Betting-clock expiry (server-owned): auto check/fold the current actor,
   *  and auto sit-out after two straight timeouts — mirrors NLHE (6.1). */
  bettingTimeout(): void {
    if (this.phaseVal !== "betting") return;
    const seat = this.betting!.currentActor();
    if (seat == null) return;
    const legal = this.betting!.legal();
    const auto: BetActionType = legal.actions.includes("check") ? "check" : "fold";
    const p = this.playerAtSeat(seat);
    if (p) {
      p.consecutiveTimeouts += 1;
      if (p.consecutiveTimeouts >= 2 && !p.sittingOut) p.sittingOut = true;
    }
    this.betting!.act(auto);
    this.pumpBetting();
  }

  // ---------- session controls (mirror NLHE; pre-SessionCore duplication) ----------

  toggleSitOut(playerId: string, out: boolean): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.sittingOut = out;
    if (!out) p.consecutiveTimeouts = 0;
    // takes effect at next deal; the current hand is unaffected (6.2)
  }

  /** Host-approved rebuy, applied only between hands (3.4). */
  approveAddChips(playerId: string, amount: number): void {
    const p = this.players.get(playerId);
    if (!p || amount <= 0) return;
    const room = this.config.maxBuyIn - (p.stack + p.pendingAddChips);
    const add = Math.max(0, Math.min(amount, room));
    if (add === 0) return;
    p.pendingAddChips += add;
    if (this.phaseVal === "handEnded" || this.phaseVal === "lobby") this.applyPendingChips();
  }

  /** Seat a spectator (busted, re-buying) or a brand-new player at an empty seat
   *  with a fresh buy-in. Between hands only (the server gates emptiness/timing). */
  seatPlayer(id: string, name: string, seat: number, stack: number): void {
    if (this.handInProgress()) return;
    const amount = clamp(stack, this.config.minBuyIn, this.config.maxBuyIn);
    const existing = this.players.get(id);
    if (existing) {
      existing.seat = seat;
      existing.stack = amount;
      existing.buyInTotal += amount; // a fresh buy-in adds to the ledger
      existing.spectating = false;
      existing.sittingOut = false;
      existing.consecutiveTimeouts = 0;
    } else {
      this.players.set(id, {
        id, name, seat, stack: amount, buyInTotal: amount,
        sittingOut: false, consecutiveTimeouts: 0, timeBank: this.config.timeBankSec,
        pendingAddChips: 0, spectating: false,
      });
    }
    this.pushLog(`${name} takes seat ${seat + 1} with ${fmt(amount)}`);
  }

  private applyPendingChips(): void {
    for (const p of this.players.values()) {
      if (p.pendingAddChips > 0) {
        p.stack += p.pendingAddChips;
        p.buyInTotal += p.pendingAddChips;
        this.pushLog(`${p.name} added ${fmt(p.pendingAddChips)} chips`);
        p.pendingAddChips = 0;
      }
    }
    // busted (stack 0) → spectator, removed from their seat; a rebuy revives one
    for (const p of this.players.values()) p.spectating = p.stack <= 0;
  }

  private pushLog(msg: string): void {
    this.log.push(msg);
  }

  /** Exact snapshot of every player's session record, for a mid-session engine
   *  handoff (mode switch) that must preserve stacks + ledger + sit-out. */
  exportPlayers(): PlayerRecord[] {
    return [...this.players.values()].map((p) => ({ ...p }));
  }

  private playerAtSeat(seat: number): PlayerRecord | undefined {
    for (const p of this.players.values()) if (p.seat === seat) return p;
    return undefined;
  }

  private pumpBetting(): void {
    const b = this.betting!;
    while (b.status() === "roundComplete") b.beginNextRound(); // all cards pre-dealt; just advance
    if (b.isComplete()) this.postBetting();
    else {
      this.phaseVal = "betting";
      // arm the per-turn clock for the new actor (server enforces; UI displays)
      this.turnStartedAt = Date.now();
      this.turnDeadlineAt = Date.now() + this.config.actionTimeSec * 1000;
    }
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
      this.arrangementOrder.set(s, [0, 1, 2, 3, 4, 5]); // the default split's order
    }
    this.phaseVal = "picking";
    this.phaseDeadline = Date.now() + PICK_DECIDE_SEC * 1000;
    this.turnStartedAt = null;
    this.turnDeadlineAt = null;
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
    this.arrangementOrder.set(seat, [...order]);
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
    // representation flips happen here (blind); they collect into flipLog but
    // stay hidden until handEnded (state() gates the exposure).
    this.prepared = prepareShowdown(pots, this.arrangements, this.dealt!.boards, this.rng, this.flipLog);
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
    // R1: surrender is banker-only. A seat that doesn't own a guaranteed share
    // may not surrender — it must run. Enforced here, at the live-game entry
    // point, so a hacked client can't take the 30% buyout in a spot the rules
    // forbid. (The pure resolver still handles a surrender if handed one.)
    if (decision === "surrender") {
      const contest = this.prepared?.find((c) => c.potIndex === potIndex);
      if (!contest || !surrenderSeatsOf(contest).includes(seat)) {
        throw new Error(`seat ${seat} may not surrender in pot ${potIndex} (banker-only, R1)`);
      }
    }
    this.decisions.set(key, decision);
    if (this.pendingDecisions().length === 0) this.finalizeShowdown();
  }
  /** Timer fired: everyone who didn't declare defaults to RUN (play it out). */
  decisionsTimeout(): void {
    if (this.phaseVal !== "decisions") return;
    this.finalizeShowdown(); // finalizeShowdown() treats any missing decision as "run"
  }

  private finalizeShowdown(): void {
    const delta = finalizeShowdown(this.prepared!, this.decisions, this.arrangements, this.rng, this.flipLog);
    this.settle(delta);
  }

  private settle(delta: Map<number, number>): void {
    const b = this.betting!;
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    for (const s of this.eligible) {
      bySeat.get(s)!.stack = b.stackOf(s) + (delta.get(s) ?? 0);
    }
    this.lastDelta = delta;
    for (const [seat, amt] of delta) {
      if (amt > 0) {
        const nm = this.playerAtSeat(seat)?.name ?? `Seat ${seat + 1}`;
        this.pushLog(`${nm} wins ${fmt(amt)}`);
      }
    }
    // busted (stack 0) → spectator, removed from their seat
    for (const p of this.players.values()) p.spectating = p.stack <= 0;
    this.phaseVal = "handEnded";
    this.phaseDeadline = null;
    this.turnStartedAt = null;
    this.turnDeadlineAt = null;
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

  /** Full-truth GameState snapshot (Step 6 seam). Carries EVERY seat's hole
   *  cards, arrangement, and declarations — the filter strips other seats'
   *  secrets per viewer, exactly as it does for NLHE hole cards. Board cards
   *  beyond the current reveal depth are omitted for EVERYONE (a future board
   *  card must never reach any client). */
  state(): GameState {
    const b = this.betting;
    const live = this.handInProgress() && b != null; // betting|picking|decisions
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    const dealtIn = new Set(this.eligible);
    const actor = this.phaseVal === "betting" ? b!.currentActor() : null;
    // hole cards + arrangement become public only AFTER picking locks
    const cardsRevealed = this.phaseVal === "decisions" || this.phaseVal === "handEnded";

    const phase: Phase =
      this.phaseVal === "lobby" ? "lobby"
      : this.phaseVal === "ended" ? "ended"
      : this.phaseVal === "handEnded" ? "handEnded"
      : "inHand";

    // board reveal depth: flops(3) in round 0, +turn(4) round 1, +river(5)
    // round 2; full at showdown. Never expose beyond this to ANYONE.
    const revealCount = this.phaseVal === "betting" ? 3 + b!.roundNumber() : 5;
    const bf = this.dealt?.boards;
    const boards = bf
      ? { a: bf.a.slice(0, revealCount), b: bf.b.slice(0, revealCount) }
      : { a: [], b: [] };

    // Fixed 7-seat grid: every index 0..6 is a slot — occupied or empty (item 2).
    const occupied = new Map<number, PlayerRecord>();
    for (const p of this.players.values()) if (!p.spectating) occupied.set(p.seat, p);
    const seats: SeatView[] = [];
    for (let i = 0; i < MAX_DFT_SEATS; i++) {
      const p = occupied.get(i);
      if (!p) { seats.push(emptySeatView(i)); continue; }
      const inHandNow = live && dealtIn.has(p.seat);
      const folded = inHandNow ? b!.isFolded(p.seat) : false;
      const isShowdownSeat = this.showdownSeats.includes(p.seat);
      const decls: { potIndex: number; decision: DftDecision }[] = [];
      for (const [key, d] of this.decisions) {
        const [pi, sSeat] = key.split(":").map(Number);
        if (sSeat === p.seat) decls.push({ potIndex: pi, decision: d });
      }
      seats.push({
        seat: p.seat, id: p.id, name: p.name,
        stack: inHandNow ? b!.stackOf(p.seat) : p.stack,
        betSize: this.phaseVal === "betting" && dealtIn.has(p.seat) ? b!.roundBetOf(p.seat) : 0,
        inHand: inHandNow && !folded,
        folded,
        sittingOut: p.sittingOut,
        isButton: live ? this.lastButton === p.seat : false,
        isTurn: actor === p.seat,
        holeCards: inHandNow ? (this.dealt!.hole.get(p.seat) ?? null) : null,
        revealed: cardsRevealed && isShowdownSeat && !folded,
        lastAction: null, // DFT betting-action badges: deferred to the UI step
        timeBank: p.timeBank,
        arrangement: inHandNow && isShowdownSeat ? (this.arrangementOrder.get(p.seat) ?? null) : null,
        declarations: decls.length ? decls : undefined,
      });
    }

    const legal = this.phaseVal === "betting" ? b!.legal() : null;
    const canBetOrRaise = !!legal && legal.actions.some((a) => a === "bet" || a === "raise");
    const windowLive = this.phaseVal === "picking" || this.phaseVal === "decisions";

    let dft: DftView | undefined;
    if (this.phaseVal !== "lobby" && this.phaseVal !== "ended") {
      const picking =
        this.phaseVal === "picking"
          ? { deadlineAt: this.phaseDeadline, seats: [...this.showdownSeats], lockedSeats: [...this.lockedPick] }
          : null;
      let decisions: DftView["decisions"] = null;
      if (this.phaseVal === "decisions" && this.prepared) {
        const contests = this.prepared
          .map((c) => ({
            potIndex: c.potIndex, amount: c.amount,
            seats: decisionSeatsOf(c), surrenderSeats: surrenderSeatsOf(c),
          }))
          .filter((c) => c.seats.length > 0);
        const lockedSeats = [...this.decisions.keys()].map((k) => {
          const [potIndex, seat] = k.split(":").map(Number);
          return { potIndex, seat };
        });
        decisions = { deadlineAt: this.phaseDeadline, contests, lockedSeats };
      }
      dft = {
        subPhase: this.phaseVal === "betting" ? "betting" : this.phaseVal === "picking" ? "picking" : "decisions",
        boards, picking, decisions,
        // reveal the flips ONLY once the hand is over — during the blind
        // decisions phase the rep-flip results already sit in flipLog but must
        // not reach any client (they'd tip the run/surrender math).
        flips: this.phaseVal === "handEnded" ? this.flipLog : [],
      };
    }

    const lastHandResult: HandResultShare[] | null =
      this.phaseVal === "handEnded"
        ? [...this.lastDelta.entries()]
            .filter(([, amt]) => amt > 0)
            .map(([seat, amt]) => ({
              seat, name: bySeat.get(seat)?.name ?? `Seat ${seat + 1}`,
              amountWon: amt, handName: null, cards: null,
            }))
        : null;

    return {
      variant: "dft",
      phase,
      handNumber: this.handNumber,
      config: this.config,
      seats,
      communityCards: [], // DFT has two boards; the UI reads state.dft.boards
      pots: live ? b!.sidePots().map((sp) => ({ size: sp.amount, eligibleSeats: sp.eligibleSeats })) : [],
      totalPot: live ? b!.totalPot() : 0,
      round: this.phaseVal === "betting" ? (ROUND_TAG[b!.roundNumber()] ?? null) : null,
      playerToAct: actor,
      legalActions: legal ? (legal.actions as PlayerAction[]) : null,
      betRange: canBetOrRaise ? { min: legal!.minRaiseTo, max: legal!.maxRaiseTo } : null,
      callAmount: legal ? legal.callAmount : 0,
      turnStartedAt: this.phaseVal === "betting"
        ? this.turnStartedAt
        : windowLive && this.phaseDeadline != null ? this.phaseDeadline - PICK_DECIDE_SEC * 1000 : null,
      turnDeadlineAt: this.phaseVal === "betting" ? this.turnDeadlineAt : windowLive ? this.phaseDeadline : null,
      lastHandResult,
      log: this.log.slice(-60),
      canShowSeat: null,
      waitingReason: this.waitingReason,
      dft,
    };
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
