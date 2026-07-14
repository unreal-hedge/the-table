# Double Flop Tex — Complete Rule Spec

Answers to the 7 open questions from PARTH-CONTEXT.md, plus the full ruleset.
**This document is the law for Phase 1D.** Where this doc and any other doc
disagree, this doc wins.

---

## RULINGS — amendments (Kabir, final)

These close the two previously-open DFT questions. **Final; do not revisit
without an explicit new ruling.**

### R1 — Surrender eligibility (was HANDOFF §E2). RULED: keep banker-only.

A participant may **SURRENDER only if they already own a guaranteed share of
the pot** — i.e. they are the banker in the guaranteed-50% branch, at the final
heads-up resolution. A challenger who owns nothing yet **must RUN** the flip.
The floated "challenger buys out at 40%" idea is **rejected** (it contradicts
the own-half-to-surrender rule and the 30/70 symmetry). No code change — this
is exactly what the engine already does.

### R2 — Flip ties (was HANDOFF §E1). RULED: even split, immediately, no re-runs.

**Any flip that ties splits the contested amount evenly among that flip's tied
winners, immediately. No re-runs. No lowest-seat fallback. Seat position never
decides who wins chips.** This applies to **every** flip type:

- **Final heads-up flip ties** → the contested stake splits 50/50.
- **Guaranteed-50% representation flip (`gtdMulti`) ties** → the contested half
  splits evenly among the tied winners; the banked half is untouched.
- **Board-representation flip ties** → **no champion is crowned**, so that board
  sends no representative to a final flip. Instead the pot resolves by
  **board ownership**: each board's 50% is split evenly among *that board's*
  tied representatives (a chopped board's tied flip-winners, or its lone
  outright winner). A final heads-up flip happens **only** when both boards each
  reduced to exactly one representative. (Engine: the `boardSplit` outcome in
  `showdown.ts`.)

  *Rationale:* this is expected-value-preserving. A tied board rep who would
  have had a ~50% shot at a 100% final flip instead banks their equal share of
  that board's 50% — the same expected value, with zero randomness or seat bias.

  *Noted edge (not a seat-decides-chips violation):* when an even split leaves
  an **indivisible odd chip** (e.g. 500 split 3 ways), that single leftover chip
  follows the universal poker convention — awarded to the lowest seat number.
  This is the same `splitAmong` rounding used by every split in the engine
  (including the 30/70 surrender payout); it concerns sub-chip rounding only,
  never who *wins* a flip. Flagged for the record; change only if Kabir rules
  otherwise.

### Also reconfirmed (both sides agreed)

- **Run-it-twice stays CUT from 1D.** It becomes its own later phase, scoped to
  **normal Hold'em all-ins only** — never the DFT two-board flip structure.
- **DFT is 7-max by card arithmetic** (7×6 hole + two 5-card boards = 52).
  8 players is physically impossible and is rejected at the config layer.

---

## THE GAME

Double Flop Tex is a six-card bomb-pot variant played on **two boards** with
**one shared pot**.

### Deal & betting sequence

1. Before any cards are dealt: every player antes a fixed **1 BB (200)**. This
   is a bomb pot — **there is no preflop betting round**.
2. Each player is dealt **6 cards**.
3. Both flops (**Flop A**, **Flop B**) revealed **simultaneously** (3 cards each).
4. **BETTING ROUND 1.**
5. Both turns dealt face-down.
6. Both turns revealed. **BETTING ROUND 2.**
7. Both rivers dealt face-down.
8. Both rivers revealed. **BETTING ROUND 3.**
9. Showdown.

There are exactly **3 post-deal betting rounds**. One shared pot throughout.
Betting is structurally normal — the two boards do not create separate betting
streams, they only change what players are betting *about*.

**No burn cards; 7-max.** DFT deals **no burns** — a burn is a physical-casino
anti-marking ritual that does nothing under a seeded digital shuffle. Dropping
it makes the deck math exact: **7 players × 6 hole cards + two 5-card boards =
52 cards.** DFT is therefore **7-max**; **8 players is physically impossible and
is rejected at the config layer with a clear error.**

**Bet sizing.** No blinds are posted (there is no preflop round); the big blind
of 200 only sets the ante and the minimum bet. Each post-deal round opens with
no live bet, and the **first live seat left of the button acts first** (standard
Hold'em order). Opening bets and raises are No-Limit, capped at the player's
stack, with a **minimum of 200 (1 BB)** and in **50-chip increments** (200, 250,
300, …); raises additionally follow standard No-Limit min-raise sizing. (The
50-chip *slider* is a Phase 1E UI change — the engine accepts any legal 50-step
amount now so 1E never has to touch it.)

**Short stack who cannot cover the 1 BB ante (200):** goes **all-in for whatever
they have** and plays for a side pot. Never dealt out.

**Folding:** any player who folds is out of the hand entirely and does not
reach showdown. If all but one player folds, that player wins the pot
immediately — no hand splitting, no flips, no picking phase.

---

### Hand construction

Each player splits their **6 cards into three two-card hands**:

| Hand | Plays against |
|------|---------------|
| Hand 1 | Flop A |
| Hand 2 | Flop B |
| Hand 3 | The **"Tex hand"** — used only for heads-up flips |

**Evaluation is Hold'em style:** best 5-card hand from your 2 cards + the 5
board cards. A player may use **two, one, or zero** of their own cards —
playing the board is legal.

Standard poker hand rankings throughout.

---

### The picking phase (immediately before showdown)

1. Cards are dealt into a **default arrangement** (cards 1-2, 3-4, 5-6). This
   is always a valid, complete, playable arrangement.
2. Players **drag and drop** to rearrange their three hands.
3. **Only players still in the pot** participate.
4. A **30-second timer** runs. Each player presses **ACCEPT** to lock their
   arrangement. **Accept is irreversible.**
5. **On timeout**, the player's current on-screen arrangement is locked
   automatically. There is no invalid state — the default is always playable.
6. Showdown does not begin until every involved player has locked in or timed
   out.

**All-in case:** if betting ends early because players are all-in, **all
remaining board cards are revealed first**, *then* the picking phase runs,
*then* hands are revealed. Order is always: **board → picking → reveal.**

---

## SHOWDOWN

### Winning the boards

Each board is won by the **best 5-card hand among players eligible for that
pot**. Each board represents **50% of that pot**.

**Board winners are computed PER POT.** A player who wins a board among all
players may lose that same board within a side pot he isn't eligible for, and
vice versa. Each pot resolves independently on its own eligible player set.

- One player wins **both boards** → takes the **entire pot**. No flip, no
  decision, no surrender option.
- Two different players each win one board → they proceed to a **Tex flip**.

### Chops (ties on a board)

If multiple players tie on a board, all tied players flip their **Tex hands**
simultaneously to determine who represents that board's half of the pot. This
is a **representation flip**.

The winner of a representation flip is decided **only by the flip result** —
the strength of their original board hand is irrelevant. A player who won the
board with a weak hand still wins that half if their Tex flip wins.

**If both boards are chopped:** each board's representation flip resolves
first, *then* the two representatives flip against each other for the whole
pot. Flips are always **sequential** in this order.

**If a representation flip itself ties** (see R2): no representative is crowned
for that board. The final heads-up flip runs only when *both* boards produced
exactly one representative; otherwise the pot resolves by board ownership —
each board's 50% split evenly among that board's tied reps.

**Special case — win one board outright AND tie on the other.** A player who
**outright wins one board AND is part of the chop on the other board** banks
**50% of the pot immediately and irrevocably**. That half is **never at risk
again** — it cannot be surrendered, wagered, or lost.

The remaining 50% is resolved by a **single representation flip on the chopped
board**, among all players tied on that board (the guaranteed player included).
There is **NO subsequent final heads-up flip** in this branch:

- Guaranteed player **wins** the representation flip → takes the **whole pot** (100%).
- Guaranteed player **loses** the representation flip → keeps the banked 50%;
  the representation-flip winner takes the other 50%.

**Surrender inside this representation flip:**
- **3+ players** tied on that board → surrender **unavailable** (normal
  representation-flip rule: they must run).
- **Exactly heads-up** (guaranteed player vs one other) → surrender **is**
  available, but **only on the contested 50%**. The banked 50% is untouchable.

### The Tex flip

A heads-up Texas Hold'em runout using only the players' Tex hands.

- **Fresh 52-card deck**, minus the cards held by the flip participants
  (4 removed for 2 players, 6 for 3, etc.)
- Fresh **5-card community board** dealt.
- Winner takes the contested amount. **If the flip ties, the contested amount
  is split evenly among the tied winners — no re-run** (see R2).

**The final flip is always heads-up between exactly two board
representatives.** Three or more players only ever appear in a *representation*
flip, never in the final flip.

---

## SURRENDER

Before any flip, every involved player makes a **blind, simultaneous, binding**
decision: **RUN** or **SURRENDER**.

- Declared **before any flip card is revealed**.
- No player may see another's cards or decision first.
- **Not changeable** once declared.

### Outcomes (heads-up final flip only)

| Player A | Player B | Result |
|----------|----------|--------|
| Surrender | Surrender | 50/50 chop of the contested amount. No flip. |
| Run | Surrender | Runner gets **70%**, surrenderer gets **30%**. No flip. |
| Run | Run | Flip for **100%** of the contested amount. |

### Surrender is NOT available in a 3+ representation flip

Surrender requires **already owning half the pot**. Players in a representation
flip are still *competing* for that half — they do not own it yet. **They must
run it.**

Surrender only becomes available to that flip's winner, at the final heads-up
flip.

### Percentages are per-pot

All percentages are of the **specific pot being contested**. A player in
multiple pots (main + side) makes an **independent run/surrender decision for
each pot**, and may run one and surrender another.

**Simplification:** if the same set of players is eligible for every pot, merge
them and treat as one pot.

---

## THE 7 OPEN QUESTIONS — ANSWERED

**Q1 — Betting sequence with two boards.**
Normal betting rounds, one shared pot. The structure is standard; only the
board count changes. No per-board betting streams.

**Q2 — Face-down turn/river reveal timing.**
Confirmed: 3 post-deal betting rounds. Flops → bet → both turns → bet → both
rivers → bet → showdown.

**Q3 — Hand assignment.**
Player-chosen **at showdown**, not locked at deal. Requires a drag-and-drop
picking UI with a default pre-filled arrangement, a 30s timer, and an
irreversible ACCEPT.

**Q4 — Side pots × flips.**
Independent per pot. Board winners, flips, and run/surrender decisions all
resolve separately per pot. Multiple sequential flips per hand are expected.

**Q5 — Three-way+ final flips.**
Never. The final flip is always exactly heads-up. 3+ players only appear in
representation flips.

**Q6 — Surrender with 3+ in a chop flip.**
**Not allowed.** Surrender requires owning half the pot; representation-flip
players are still competing for it. They must run.

**Q7 — Ante and short stacks.**
All-in for whatever they have, play for a side pot. Never dealt out.
