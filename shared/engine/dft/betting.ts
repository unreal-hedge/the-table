// ============================================================
// DFT betting — the bomb-pot betting engine + side-pot partition.
//
// This is card-free chip mechanics only. It knows nothing about
// boards, hole cards, or showdown — just: post antes, run three
// No-Limit betting rounds, track per-player contributions, and
// partition the pot into side pots at the end.
//
// HIGHEST BUG RISK in the project (Parth): poker-ts's own side-pot
// payout bug is the proof. So conservation is the invariant —
// for every seat, stack + contributed == buyIn, always. test-dft.ts
// asserts sum(stacks) + sum(pots) == total bought in after EVERY
// action, before any showdown exists.
//
// Bomb pot: everyone antes 1 BB (200) before cards; NO preflop round;
// exactly THREE post-deal betting rounds. No blinds are posted, so
// each round opens with no live bet and the first live seat left of
// the button acts first (standard Hold'em order).
// ============================================================

export type BetActionType = "fold" | "check" | "call" | "bet" | "raise";

/** What the actor may legally do right now. `amount` for bet/raise is the
 *  new TOTAL round-bet for the seat (chips-in-front this round), matching
 *  poker-ts's convention so the co-owned GameState shape is unchanged. */
export interface LegalBet {
  actions: BetActionType[];
  callAmount: number; // chips to add to call (0 if check available)
  minRaiseTo: number; // min new round-bet total for bet/raise (0 if none)
  maxRaiseTo: number; // all-in round-bet total (0 if no bet/raise available)
}

export interface SidePot {
  amount: number;
  eligibleSeats: number[]; // non-folded contributors who can win this layer
}

export interface BettingConfig {
  ante: number; // 200 (1 BB)
  minBet: number; // 200 (1 BB)
  increment: number; // 50
}

export interface SeatStack {
  seat: number;
  stack: number;
}

export type BettingStatus = "awaiting" | "roundComplete" | "handComplete";

export class DftBetting {
  private readonly cfg: BettingConfig;
  private readonly buyIn = new Map<number, number>();
  private readonly stackBySeat = new Map<number, number>();
  private readonly contributed = new Map<number, number>();
  private readonly roundBet = new Map<number, number>();
  private readonly foldedSet = new Set<number>();
  private readonly order: number[]; // action order: clockwise from left of button

  private roundIndex = 0; // 0,1,2
  private currentHigh = 0; // highest round-bet this round
  private lastRaiseSize: number;
  private actedThisRound = new Set<number>();
  private toActSeat: number | null = null;
  private statusVal: BettingStatus = "awaiting";
  private winnerByFoldSeat: number | null = null;

  constructor(seats: SeatStack[], button: number, cfg: BettingConfig) {
    this.cfg = cfg;
    this.lastRaiseSize = cfg.minBet;
    const occ = seats.map((s) => s.seat).sort((a, b) => a - b);
    const after = occ.filter((s) => s > button);
    const before = occ.filter((s) => s <= button);
    this.order = [...after, ...before]; // first entry = first to act (left of button)
    for (const s of seats) {
      this.buyIn.set(s.seat, s.stack);
      this.stackBySeat.set(s.seat, s.stack);
      this.contributed.set(s.seat, 0);
      this.roundBet.set(s.seat, 0);
    }
    this.postAntes();
    this.beginRound();
  }

  // ---------- public surface (driven by the manager and test) ----------

  status(): BettingStatus {
    return this.statusVal;
  }
  isComplete(): boolean {
    return this.statusVal === "handComplete";
  }
  currentActor(): number | null {
    return this.statusVal === "awaiting" ? this.toActSeat : null;
  }
  roundNumber(): number {
    return this.roundIndex;
  }
  winnerByFold(): number | null {
    return this.winnerByFoldSeat;
  }
  stackOf(seat: number): number {
    return this.stackBySeat.get(seat) ?? 0;
  }
  contributedOf(seat: number): number {
    return this.contributed.get(seat) ?? 0;
  }
  roundBetOf(seat: number): number {
    return this.roundBet.get(seat) ?? 0;
  }
  isFolded(seat: number): boolean {
    return this.foldedSet.has(seat);
  }
  isAllIn(seat: number): boolean {
    return !this.foldedSet.has(seat) && (this.stackBySeat.get(seat) ?? 0) === 0;
  }
  seats(): number[] {
    return [...this.order];
  }
  totalPot(): number {
    let t = 0;
    for (const s of this.order) t += this.contributed.get(s)!;
    return t;
  }

  /** The one place the manager builds legal actions + bet range from. */
  legal(): LegalBet {
    const seat = this.toActSeat;
    if (seat === null || this.statusVal !== "awaiting") {
      return { actions: [], callAmount: 0, minRaiseTo: 0, maxRaiseTo: 0 };
    }
    const rb = this.roundBet.get(seat)!;
    const stack = this.stackBySeat.get(seat)!;
    const toCall = Math.min(this.currentHigh - rb, stack);
    const actions: BetActionType[] = [];
    if (this.currentHigh === rb) actions.push("check");
    else actions.push("fold", "call");

    // A bet/raise needs (a) chips beyond a call, and (b) someone else who can
    // still act (never bet into an all-in field — the chips would just return).
    const maxRaiseTo = rb + stack;
    let minRaiseTo = 0;
    if (stack > toCall && this.othersCanAct(seat)) {
      const raw = this.currentHigh === 0 ? this.cfg.minBet : this.currentHigh + this.lastRaiseSize;
      minRaiseTo = Math.min(this.roundUp(raw), maxRaiseTo);
      actions.push(this.currentHigh === 0 ? "bet" : "raise");
    }
    return { actions, callAmount: toCall, minRaiseTo, maxRaiseTo };
  }

  act(action: BetActionType, amount?: number): void {
    const seat = this.toActSeat;
    if (seat === null || this.statusVal !== "awaiting") {
      throw new Error("no actor to act right now");
    }
    const legal = this.legal();
    if (!legal.actions.includes(action)) {
      throw new Error(`illegal action "${action}" for seat ${seat}`);
    }
    const rb = this.roundBet.get(seat)!;
    const stack = this.stackBySeat.get(seat)!;

    switch (action) {
      case "fold":
        this.foldedSet.add(seat);
        break;
      case "check":
        this.actedThisRound.add(seat);
        break;
      case "call":
        this.commit(seat, legal.callAmount);
        this.actedThisRound.add(seat);
        break;
      case "bet":
      case "raise": {
        if (typeof amount !== "number") throw new Error("bet/raise requires an amount");
        const target = amount;
        const isAllIn = target === legal.maxRaiseTo;
        if (target > legal.maxRaiseTo) throw new Error("bet exceeds stack");
        if (target <= this.currentHigh && this.currentHigh !== 0) {
          throw new Error("raise must exceed the current bet");
        }
        if (!isAllIn) {
          if (target < legal.minRaiseTo) throw new Error("bet below minimum");
          if (target % this.cfg.increment !== 0) throw new Error("bet must be a 50-chip step");
        }
        this.commit(seat, target - rb);
        const prevHigh = this.currentHigh;
        this.currentHigh = target;
        const raiseIncrement = target - prevHigh;
        if (raiseIncrement >= this.lastRaiseSize) {
          // full raise -> reopens the round for everyone
          this.lastRaiseSize = raiseIncrement;
          this.actedThisRound = new Set([seat]);
        } else {
          // short all-in raise -> does NOT reopen; players who already acted
          // don't act again. Their under-call is returned via side pots.
          this.actedThisRound.add(seat);
        }
        break;
      }
    }
    this.advanceAfterAction();
  }

  /** Manager calls this after dealing the next board, when a round completed. */
  beginNextRound(): void {
    if (this.statusVal !== "roundComplete") {
      throw new Error("cannot advance: current round is not complete");
    }
    this.roundIndex += 1;
    this.beginRound();
  }

  /** Layered side-pot partition. Folded players' chips still form the pot
   *  layers (dead money) but they are never eligible to win. Sum of pot
   *  amounts always equals the total contributed. */
  sidePots(): SidePot[] {
    const contribs = this.order
      .map((seat) => ({
        seat,
        amt: this.contributed.get(seat)!,
        folded: this.foldedSet.has(seat),
      }))
      .filter((c) => c.amt > 0);
    if (contribs.length === 0) return [];

    const levels = [...new Set(contribs.map((c) => c.amt))].sort((a, b) => a - b);
    const pots: SidePot[] = [];
    let prev = 0;
    for (const level of levels) {
      const layer = level - prev;
      const inLayer = contribs.filter((c) => c.amt >= level);
      const amount = layer * inLayer.length;
      const eligible = inLayer.filter((c) => !c.folded).map((c) => c.seat).sort((a, b) => a - b);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        // merge adjacent layers with an identical eligible set for tidiness
        if (last && sameSeats(last.eligibleSeats, eligible)) last.amount += amount;
        else pots.push({ amount, eligibleSeats: eligible });
      }
      prev = level;
    }
    return pots;
  }

  // ---------- internals ----------

  private postAntes(): void {
    for (const s of this.order) {
      const pay = Math.min(this.cfg.ante, this.stackBySeat.get(s)!);
      // antes are dead money, not a live bet -> commit without touching roundBet
      this.stackBySeat.set(s, this.stackBySeat.get(s)! - pay);
      this.contributed.set(s, this.contributed.get(s)! + pay);
    }
  }

  private beginRound(): void {
    for (const s of this.order) this.roundBet.set(s, 0);
    this.currentHigh = 0;
    this.lastRaiseSize = this.cfg.minBet;
    this.actedThisRound = new Set();

    if (this.nonFoldedCount() <= 1) {
      this.finishHand();
      return;
    }
    const first = this.firstToAct();
    if (first === null) {
      // everyone still in is all-in — no betting this round
      if (this.roundIndex >= 2) this.finishHand();
      else {
        this.statusVal = "roundComplete";
        this.toActSeat = null;
      }
      return;
    }
    this.toActSeat = first;
    this.statusVal = "awaiting";
  }

  private advanceAfterAction(): void {
    if (this.nonFoldedCount() <= 1) {
      this.returnUncalled();
      this.finishHand();
      return;
    }
    const next = this.nextToAct(this.toActSeat!);
    if (next !== null) {
      this.toActSeat = next;
      this.statusVal = "awaiting";
      return;
    }
    // round betting complete
    this.returnUncalled();
    if (this.roundIndex >= 2) {
      this.finishHand();
    } else {
      this.statusVal = "roundComplete";
      this.toActSeat = null;
    }
  }

  private finishHand(): void {
    this.statusVal = "handComplete";
    this.toActSeat = null;
    const live = this.order.filter((s) => !this.foldedSet.has(s));
    this.winnerByFoldSeat = live.length === 1 ? live[0] : null;
  }

  /** Return the uncalled top of the last aggressor's bet (the excess over the
   *  second-highest round-bet), so no chips are stranded in a pot no one can
   *  contest. Runs at the end of every round and when the hand ends by fold. */
  private returnUncalled(): void {
    const bets = this.order.map((s) => ({ s, rb: this.roundBet.get(s)! }));
    const sorted = [...bets].sort((a, b) => b.rb - a.rb);
    if (sorted.length === 0 || sorted[0].rb === 0) return;
    const top = sorted[0];
    // top must be a still-live player to get a refund; folded players forfeit
    if (this.foldedSet.has(top.s)) return;
    const second = sorted.length >= 2 ? sorted[1].rb : 0;
    const excess = top.rb - second;
    if (excess > 0) {
      this.stackBySeat.set(top.s, this.stackBySeat.get(top.s)! + excess);
      this.contributed.set(top.s, this.contributed.get(top.s)! - excess);
      this.roundBet.set(top.s, top.rb - excess);
    }
  }

  private commit(seat: number, amount: number): void {
    this.stackBySeat.set(seat, this.stackBySeat.get(seat)! - amount);
    this.contributed.set(seat, this.contributed.get(seat)! + amount);
    this.roundBet.set(seat, this.roundBet.get(seat)! + amount);
  }

  private canAct(seat: number): boolean {
    return !this.foldedSet.has(seat) && (this.stackBySeat.get(seat) ?? 0) > 0;
  }
  private othersCanAct(seat: number): boolean {
    return this.order.some((s) => s !== seat && this.canAct(s));
  }
  private nonFoldedCount(): number {
    return this.order.filter((s) => !this.foldedSet.has(s)).length;
  }
  private firstToAct(): number | null {
    for (const s of this.order) if (this.canAct(s)) return s;
    return null;
  }
  private nextToAct(from: number): number | null {
    const idx = this.order.indexOf(from);
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const s = this.order[(idx + k) % n];
      if (this.canAct(s) && !this.actedThisRound.has(s)) return s;
    }
    return null;
  }
  private roundUp(n: number): number {
    return Math.ceil(n / this.cfg.increment) * this.cfg.increment;
  }
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
