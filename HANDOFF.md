# The Table — Handoff

> This document is written to be pasted into a **fresh Claude session with zero
> prior context**. If that's you: read it top to bottom before touching
> anything. It tells you what the project is, what's done, what's load-bearing
> but untested, and exactly what to do next.

---

## A. PRIORITY 1 — THE 1B PLAYTEST GATE IS UNPASSED. READ THIS FIRST.

**Nobody has ever played the deployed Hold'em game on two real phones at the
same time.** The multiplayer server (Phase 1B) is built and deployed, and it
passed automated end-to-end tests against headless bots — but the roadmap
requires a **real two-device human playtest** before 1B is considered closed,
and **that playtest has never happened.**

Everything built since 1B sits on that untested foundation — **including the
entire Double Flop Tex engine.** The DFT engine will eventually run on the same
authoritative multiplayer server. **If multiplayer has a real-world bug
(reconnect, device-takeover, clock, presence), it will surface inside DFT and
look like a DFT bug.** You will waste days chasing the wrong layer.

**Kabir must do the 1B playtest with Parth — two real phones, a full session
including one mid-hand disconnect + rejoin — BEFORE starting Step 6 (below).**
Do not skip this. Do not start the DFT server integration on an unverified base.

---

## B. WHAT THE PROJECT IS

**The Table** is a private, invite-only multiplayer poker game two friends —
**Parth** and **Kabir** — are building for their group. **No real money**:
chips are abstract points; a ledger tracks buy-ins and net per person for
bragging rights.

- **Kabir owns the client** (UI, lobby, table, ledger screens, later a 3D scene).
- **Parth owns the server/engine** (game logic, the multiplayer server).
- The seam between them is **client vs server**, not "3D vs poker".

**Live URLs:**
- Frontend (Vercel): **https://poker-hazel-tau.vercel.app** — redeploy with `npx vercel --prod --yes`. **Auto-deploys on every push to `main`.**
- Game server (Cloudflare Workers + Durable Objects): **https://the-table.kabir31vazirani-f26.workers.dev** — redeploy with `npm run party:deploy`. **Does NOT auto-deploy; you must run that command after touching `party/` or `shared/`.**

**Architecture (agreed — do not drift):** Next.js on Vercel (frontend) →
PartyServer on Cloudflare (the authoritative game server; it holds the deck and
hidden cards so nobody can cheat by reading page source) → Supabase (persistent
ledger, not built yet). The engine is **plain TypeScript at `shared/engine/`
with ZERO UI imports** — the same code runs in the browser (hot-seat dev mode)
and on the server. The UI talks to the engine only through manager methods and
the `GameState` snapshot; the server sends that same `GameState` over the wire,
stripped of other players' hidden cards.

**Source-of-truth docs, in reading order:** `PARTH-CONTEXT.md`, `CLAUDE.md`,
`ROADMAP.md`, `docs/double-flop-tex-answers.md` (**the law for Phase 1D — wins
any conflict**), `docs/phase-1e-fixes.md`. Game rules also cite
`poker-logic-spec-for-parth.pdf`.

---

## C. WHAT IS DONE

### Phase 1A — DONE
No-Limit Hold'em cash game, single-screen hot-seat, real engine + ledger. Now
dev-only, reachable at `/?dev=local`.

### Phase 1B — BUILT + DEPLOYED, **gate unpassed** (see section A)
Full multiplayer: friends join one shared link from their own phones. The
PartyServer Durable Object owns a `GameManager`, verifies every action
server-side, and broadcasts a per-player-filtered `GameState`. Includes keyword
login, host authority from a server-side roster, 2-minute disconnect grace,
device-takeover (re-login from another device), a server-owned action clock,
rathole prevention, and text chat. Passed a 12-scenario headless E2E over real
websockets. **Not yet played by two humans on two phones.**

### Phase 1D — Double Flop Tex ENGINE, steps 1–5 DONE (this handoff's work)

Double Flop Tex (DFT) is a custom **bomb-pot variant on two boards with one
shared pot**. Everyone antes 1 BB (200), no preflop, three post-deal betting
rounds, then a showdown where each player splits their 6 cards into three 2-card
hands (Hand 1 vs Board A, Hand 2 vs Board B, Hand 3 = "Tex" flip hand), boards
are won per-pot, ties and cross-board splits are resolved by **heads-up Tex
flips** with a blind **run/surrender** decision. The full ruleset is
`docs/double-flop-tex-answers.md` — **read it; it is the law.**

**poker-ts cannot run DFT** (it's hardwired to 2 hole cards, one board, a
preflop round). So DFT is a **fully custom, standalone engine** that never
imports poker-ts. NLHE keeps using poker-ts, untouched.

The engine lives in **`shared/engine/dft/`** (all pure TypeScript, no UI, no
poker-ts):

| File | What it is |
|---|---|
| `cards.ts` | `Card {rank,suit}` ↔ pokersolver string (`"Th"`) bijection + full deck |
| `deck.ts` | Seeded **mulberry32** RNG (injectable — never `Math.random`), Fisher-Yates shuffle, draw-from-top `Deck`, `freshDeckMinus` (for flips) |
| `eval.ts` | Thin **pokersolver** wrapper: best-5-of-7, plays the board for free, tie-aware winner detection |
| `betting.ts` | Bomb-pot betting engine + **side-pot partition** + uncalled-bet return |
| `showdown.ts` | `planShowdown` / `prepareShowdown` / `finalizeShowdown` / `flip` — board winners per pot, representation & final flips, surrender |
| `manager.ts` | `DoubleFlopManager` — the referee; wires deal → bet → pick → decide → settle; implements `shared/engine/table-engine.ts` |

Plus `shared/engine/util.ts` (`fmt`/`clamp`/`nextButtonSeat`/`ledgerRows`) and
`shared/engine/table-engine.ts` (the `TableEngine` interface). **NLHE's
`GameManager` was deliberately NOT touched** — it keeps its own copies of those
helpers for now (see "SessionCore" in section G).

**Tests (run with `npx tsx <file>`):**
- `test-dft-units.ts` — bijection round-trips, RNG determinism + completeness, eval sanity (playing the board, chop detection, ranking).
- `test-dft.ts` — **the gate.** 400 betting-only hands (conservation after every action) **+ ~369 full hands through the manager** (chip total == total bought-in after every phase transition, ledger nets to zero every hand) **+ all seven edge cases**: all-in-for-ante, everyone-folds, win-both-boards, both-boards-chopped, 3-way chop (no surrender), guaranteed-50%, and a player declaring **opposite** run/surrender across a main + side pot. Also asserts 8 players is rejected.
- `test-dft-showdown.ts` — the six showdown correctness points pinned with hand-crafted scenarios + a 400-deal conservation fuzz.
- `test-engine.ts` — the **NLHE** invariant test; must always print `ALL INVARIANTS PASS`.

---

## D. WHAT THE TESTS DO **NOT** PROVE

Read this before trusting the green checkmarks.

- **Conservation is not rules-correctness.** Every DFT test proves chips are
  never created or destroyed. It does **not** prove the betting follows poker
  rules perfectly. A **min-raise or reopening bug could be poker-wrong while
  conserving chips flawlessly** — the pot would still balance, but the wrong
  player might have been allowed to act. The betting + side-pot code needs a
  careful human read, not just green tests. (It is the highest-risk code in the
  repo — see section H.)
- **Nothing has touched a browser or the wire.** The engine has only ever run
  headless. There is no DFT UI and no DFT server integration yet.
- **The interactive phases were driven programmatically.** Arrangements and
  run/surrender decisions in the tests are chosen by code, not by real
  simultaneous players over a network with a 30-second clock. The
  blind/simultaneous **secrecy** guarantee is **not** enforced by the engine
  alone — it must be enforced by the Step 6 filter (section F).
- **Flip fairness is not distribution-tested.** Flips are seeded and
  conservation-checked; nobody has verified the win distribution is unbiased.

---

## E. THE TWO OPEN RULE QUESTIONS (Kabir to rule on)

Both are **shipped as-is**; do not change them without an explicit decision.

### E1. Flip ties
Two Tex hands can tie on the flip board (rare but possible).

- **Parth's intended rule (under-specified):** if the two Tex hands are
  *identical in rank* (suits irrelevant — AK vs AK), re-run the flip **once**;
  if it chops again, chop for real. If the hands are *different* (AK vs QJ),
  re-run until someone wins. **Problem:** "re-run until someone wins" has no
  bound and risks an infinite loop; "how many re-runs" is undefined.
- **What the engine currently does (shipped):** a **final-flip** tie **splits
  the stake 50/50**. A **representation-flip** tie **re-flips up to 8 times**,
  then falls back to the **lowest seat number** as the representative. This is
  deterministic and cannot loop.
- **Cost of changing:** small and localized to `showdown.ts` (`flip`,
  `repFlip`, `finalizeShowdown`), but it must stay bounded — no unbounded
  re-run loops.

### E2. Guaranteed-50% surrender
When a player wins one board outright **and** ties on the other, they bank 50%
irrevocably and a single representation flip decides the other 50%.

- **What the engine currently does (shipped):** in the heads-up case, **only
  the banker (who owns the banked half) may surrender; the challenger must
  run.** Derived from the core rule *"surrender requires owning half the pot"* —
  the challenger owns nothing yet.
- **Parth floated** letting the challenger "buy out" at 40%. **This was
  rejected** because it contradicts the core "own half to surrender" rule and
  the 30/70 symmetry used in every other flip. **Do not implement it** without
  reconciling that conflict first.
- **Cost of changing:** small (`finalizeShowdown`, the `gtdHeadsUp` branch), but
  it changes payouts and breaks the stated invariant, so it needs a real ruling.

---

## F. WHAT KABIR OWNS NEXT (in order)

### F1. The 1B playtest with Parth
See section A. **Do this first.** Two phones, full session, one disconnect +
rejoin. Nothing below is safe to build on until this passes.

### F2. STEP 6 — THE SEAM (server integration of DFT)

This is the **co-owned** layer: `shared/protocol.ts`, `party/filter.ts`,
`party/server.ts`, and `shared/engine/types.ts` (`GameState`). The DFT engine
(steps 1–5) touched **none** of these on purpose. Step 6 wires
`DoubleFlopManager` onto the multiplayer server the same way `GameManager` is
wired today.

**Design note — the contract changes you'll need:**

- **`GameState` (types.ts) grows, additively.** Add a `variant: "nlhe" | "dft"`
  discriminator. For DFT add: the **two boards** (`boards: { a: Card[]; b:
  Card[] }`, containing only *revealed* cards), **6 hole cards** per seat
  (`holeCards` already an array — it just carries 6), a **picking** sub-state
  (`{ deadlineAt, lockedSeats: number[], myArrangement?: ... }`), a **decisions**
  sub-state (`{ contests: {potIndex, seats, amount}[], lockedSeats:
  {potIndex, seat}[], myPending?: {potIndex}[] }`), and **flip reveal** state.
  Keep NLHE's existing fields working so Kabir's current UI is undisturbed.
- **New client → server messages** (`protocol.ts`): `{ type:
  "submitArrangement", order: number[] }` (a permutation of 0..5) and `{ type:
  "declare", potIndex, decision: "run" | "surrender" }`. Both are actor-verified
  like `act` today.
- **New server timers** (`server.ts`): the current clock is one timer for the
  one player to act. Picking and decisions are **simultaneous** — the server
  needs a single shared **window timer** (30s) per phase that, on expiry, calls
  `manager.pickingTimeout()` / `manager.decisionsTimeout()`. This is separate
  from the per-turn action clock.
- **`filter.ts` — the anti-cheat core.** Today it strips other players'
  un-revealed hole cards. It must now **also** strip, per viewer: **another
  player's locked arrangement** and **another player's run/surrender
  declaration**. The viewer receives only *their own* arrangement/decision plus
  the public `lockedSeats` list (WHO has locked in).

> **HARD REQUIREMENT — this is anti-cheat, not a UI nicety:** no intermediate
> state may EVER leak a player's locked arrangement or their run/surrender
> declaration before the simultaneous reveal. **Only WHO has locked in is
> public. Never WHAT.** If a player can see an opponent surrendered (or how they
> split their cards) before deciding, they gain expected value and the game is
> broken. The engine already stores these privately (`lockedPickSeats()` exposes
> only *who*; arrangements and decisions are private fields); the filter must
> preserve that on the wire.

### F3. The DFT UI (Kabir's client work)
- The **drag-and-drop hand-splitting screen**: the default arrangement
  (cards 1-2 / 3-4 / 5-6) is pre-filled and always playable, a **30-second
  timer**, an **irreversible ACCEPT**. On timeout the current on-screen layout
  locks.
- A **two-board table layout**.
- **Sequential flip reveal** (never dump both flip cards at once).
- A **run/surrender modal** (blind, simultaneous, binding).

### F4. Phase 1E — all nine items in `docs/phase-1e-fixes.md`
Sit-out timer change, 50-chip bet slider, host = Parth/Kabir only, rejoin after
refresh, rejoin after elimination (cash only), POV rotation, showdown reveal +
highlight, dealing animation, red-felt visual redesign. **1E runs AFTER 1D —
never mix 1E work into a 1D commit.**

---

## G. WHAT IS SKIPPED, AND WHY

- **1B.2 (Supabase persistent ledger)** and **1C (Sit & Go mode)** were
  **deliberately deferred**. They're independent and can be built later without
  conflict. Parth chose to jump straight to 1D.
- **Run-it-twice** was **cut from 1D entirely.** It was never specced for DFT's
  two-board flip structure and may not even be coherent alongside it. It becomes
  **its own later phase, scoped to normal Hold'em all-ins only** (see ROADMAP).
- **A shared `SessionCore`** (deduping the session scaffolding that
  `GameManager` and `DoubleFlopManager` currently duplicate — ledger, sit-out,
  clock, rebuy, button rotation) is deferred to **after both engines are
  gate-passed**, to avoid risking a regression in the deployed NLHE engine.

---

## H. THE LANDMINES

From `CLAUDE.md` (hard-won) and this phase:

- **The poker-ts patch is load-bearing.** `poker-ts@1.5.0` silently destroys
  all-in players' winnings at showdown. We patch 4 lines in `dealer.js`
  (`patches/poker-ts+1.5.0.patch`), auto-applied by the `postinstall` hook
  (`patch-package`). **Never remove the postinstall script. Never upgrade
  poker-ts without re-running `npx tsx test-engine.ts`.** DFT does not use
  poker-ts, so the patch is an NLHE-only concern.
- **Never run `next build` while the dev server is running** — they share
  `.next` and the build deletes the dev server's assets. Use **`npm run
  build:check`** for local verification (separate `.next-check` dir). On
  Windows the `build:check` npm script fails (`NEXT_DIST_DIR=...` is bash
  syntax); run `NEXT_DIST_DIR=.next-check npx next build` from Git Bash instead.
- **Restart the dev server after config/structure changes** (tsconfig paths,
  next.config, moving folders) — it caches module resolution.
- **`holeCards`/`communityCards` must be snapshotted BEFORE `showdown()`** in
  the NLHE engine — poker-ts asserts if you read them after the hand ends.
- **The `deadBets` quirk** in `GameManager`: a preflop folder's dead bet lingers
  in `seats().betSize` while a postflop folder's zeroes instantly. Don't
  "simplify" the before/after fold measurement — it double-counts preflop folds.
- **Fonts are self-hosted** via @fontsource (Google Fonts fetch breaks builds).
- **Deploys:** push to `main` → Vercel redeploys the frontend automatically. The
  game server does **not** auto-deploy — run `npm run party:deploy` after
  touching `party/` or `shared/`.
- **pokersolver has its OWN rank scale** (flush = 6) that differs from poker-ts's
  enum (flush = 5). DFT eval uses pokersolver's `.name`/`.descr`/`.rank`
  directly and must **NEVER** be routed through `handNames.ts` (that file maps
  poker-ts's scale only).
- **pokersolver names a royal flush `"Straight Flush"`** — a naming quirk to
  handle in the 1E "name the winning hand" UI.
- **DFT is 7-max. 8 players is physically impossible** (7 × 6 hole + two 5-card
  boards = 52 exactly) and is **rejected at the config layer** — surface that
  error in the lobby, don't let it reach the engine as a crash.
- **The side-pot partition + uncalled-bet-return logic in `betting.ts` is the
  single highest-risk code in the repo.** poker-ts's own analogous code had a
  chip-destroying bug we had to patch. Ours is heavily conservation-tested but
  conservation ≠ rules-correctness (section D). **Give it a careful human read
  before trusting it in a real-money-adjacent context.**

---

## I. THE WORKING RHYTHM

Parth and Kabir **alternate.** Each person, when they finish a chunk, hands back
**an updated repo plus a fresh context document** (like this one). Whoever picks
up **starts by reading that document** — do not assume the other side's Claude
left you notes in your head; it didn't. The repo + the handoff doc are the only
shared memory.

---

## J. THE RULES BOTH SIDES FOLLOW

- **One step at a time.** Plan → get agreement → build → verify → commit. Don't
  chain steps without checking in.
- **Test + build green before every commit.** `npx tsx test-engine.ts` must
  print `ALL INVARIANTS PASS` (NLHE must never regress); the relevant DFT tests
  must pass; the isolated build must be clean.
- **Never touch the poker-ts patch or the `postinstall` hook.**
- **No silent dependencies** — say what you're adding and why, first.
- **Back up before destructive edits.**
- **Push back. Don't be a yes-man.** If a spec is inconsistent or an approach is
  wrong, say so directly.
- Commit at logical checkpoints with clear messages; each phase has a gate, and
  at each gate, remind whoever's driving to push.
