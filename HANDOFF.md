# The Table — Handoff

> Written to be pasted into a **fresh Claude session with zero prior context**.
> If that's you: read it top to bottom before touching anything. It tells you
> what the project is, what's done, what's built-but-not-live, what's untested,
> and exactly what to do next.
>
> **Last rewritten:** after the "lifecycle hardening" pass (items 1–7) that
> followed the first DFT playtest attempt. If the git log has commits past
> `f76f6ad` that this doc doesn't mention, trust the log, not this line.

---

## A. PRIORITY 1 — ONE DORMANT DEPLOY + TWO UNPASSED PLAYTEST GATES

Three things are true right now and all three block progress. In order:

### A0. Everything since `b082c62` is pushed but **NOT LIVE**.
The Cloudflare **worker does not auto-deploy.** Every commit after `b082c62`
that touches `party/` or `shared/` is on `main` but **dormant** — the running
server is still on old code. **This includes the entire lifecycle-hardening pass
(items 1–7).** The frontend (Vercel) *did* auto-deploy those pushes, so the
**client and server are now out of sync in production** until someone runs the
deploy.

**The dormant worker commits (oldest → newest):**

| Commit | Item | Touches |
|---|---|---|
| `b7bf584` | Item 6 — two permanent admins (Parth + Kabir), identity-based host | party |
| `8925254` | Item 1 — busted → spectator, waiting reason, DFT dealer log | shared |
| `02b7557` | Item 2 — numbered seats + spectator seat requests | party + shared |
| `323f282` | Item 3 — player-initiated rebuy requests, admin-approved | party + shared |
| `0b09e0b` | Item 4 — stop/restart + deal-next control | party + shared |
| `58094b4` | Item 5 — CREATE vs JOIN + self-registration | party |

`f76f6ad` (Item 7, pot/stack legibility) is **frontend-only** — it went live via
Vercel already and needs no worker deploy.

> **FIRST ACTION for whoever holds the Cloudflare account (Kabir):** run
> `npm run party:deploy`. Until then, none of the lifecycle fixes below actually
> work in the deployed game, and the live client is talking to a server that
> doesn't understand its new messages. **Parth cannot run this** — the worker is
> on Kabir's Cloudflare account and the deploy needs a token Parth doesn't have.
> (See `docs/KABIR-TODO.md`, which leads with exactly this.)

### A1. The 1B (Hold'em) two-device playtest has **never happened.**
Multiplayer is built, deployed, and passed a 12-scenario headless E2E over real
websockets — but **nobody has ever played the deployed Hold'em game on two real
phones at once.** The roadmap requires a real two-device human session (a full
game including one **mid-hand disconnect + rejoin**) before 1B is closed.

### A2. The 1D (Double Flop Tex) two-device playtest has **never happened either.**
The whole DFT variant — engine, server seam, and UI — is built and deployed, but
it has only ever been driven by headless bots. The first attempt to actually
play it is what surfaced the lifecycle gap that items 1–7 fix (see §C). **DFT
now needs its own two-device playtest** once the deploy in A0 is live.

Everything sits on the 1B foundation. **If multiplayer has a real-world bug
(reconnect, device-takeover, clock, presence), it will surface inside DFT and
look like a DFT bug — you'll waste days in the wrong layer.** Do the deploy,
then both playtests, before building anything new.

---

## B. WHAT THE PROJECT IS

**The Table** is a private, invite-only multiplayer poker game two friends —
**Parth** and **Kabir** — are building for their group. **No real money:** chips
are abstract points; a ledger tracks buy-ins and net per person for bragging
rights.

- **Kabir owns the client** (UI, lobby, table, ledger screens, later a 3D scene).
- **Parth owns the server/engine** (game logic, the multiplayer server).
- The seam between them is **client vs server**, not "3D vs poker".

**Live URLs:**
- Frontend (Vercel): **https://poker-hazel-tau.vercel.app** — **auto-deploys on every push to `main`.**
- Game server (Cloudflare Workers + Durable Objects): **https://the-table.kabir31vazirani-f26.workers.dev** — redeploy with `npm run party:deploy`. **Does NOT auto-deploy; run that after touching `party/` or `shared/`** (see §A0).

**Architecture (agreed — do not drift):** Next.js on Vercel (frontend) →
PartyServer on Cloudflare (the authoritative game server; it holds the deck and
hidden cards so nobody can cheat by reading page source) → Supabase (persistent
ledger, not built yet). The engine is **plain TypeScript at `shared/engine/`
with ZERO UI imports** — the same code runs in the browser (hot-seat dev mode)
and on the server. The UI talks to the engine only through manager methods and
the `GameState` snapshot; the server sends that same `GameState` over the wire,
stripped of other players' hidden cards.

**Source-of-truth docs, in reading order:** `CLAUDE.md`, `ROADMAP.md`,
`docs/double-flop-tex-answers.md` (**the law for Phase 1D, incl. the RULINGS
register at the top — wins any conflict**), `docs/phase-1e-fixes.md`,
`docs/KABIR-TODO.md` (the live action list). Game rules also cite
`poker-logic-spec-for-parth.pdf`.

---

## C. WHAT IS DONE

### Phase 1A — DONE
No-Limit Hold'em cash game, single-screen hot-seat, real engine + ledger. Now
dev-only, reachable at `/?dev=local`. Kept working on purpose as the engine
debug harness.

### Phase 1B — BUILT + DEPLOYED, **gate unpassed** (see §A1)
Full multiplayer: friends join one shared link from their own phones. The
PartyServer Durable Object owns a `GameManager`, verifies every action
server-side, and broadcasts a per-player-filtered `GameState`. Keyword login,
2-minute disconnect grace, device-takeover (re-login from another device), a
server-owned action clock, rathole prevention, text chat. Passed a headless E2E
over real websockets. **Not yet played by two humans.**

### Phase 1D — Double Flop Tex — **FULLY BUILT + DEPLOYED, gate unpassed** (see §A2)

DFT is a custom **bomb-pot variant on two boards with one shared pot**. Everyone
antes 1 BB, no preflop, three post-deal betting rounds, then a showdown where
each player splits their 6 cards into three 2-card hands (vs Board A, vs Board B,
and a "Tex" flip hand), boards are won per-pot, ties/cross-board splits resolve
by **heads-up Tex flips** with a blind **run/surrender** decision. Full ruleset:
`docs/double-flop-tex-answers.md` — **read it; it is the law.**

- **Engine (steps 1–5)** — `shared/engine/dft/`, all pure TypeScript, never
  imports poker-ts (poker-ts is hardwired to 2 hole cards / one board / a preflop
  round and cannot run DFT). Files: `cards.ts` (Card ↔ pokersolver bijection +
  deck), `deck.ts` (seeded mulberry32 RNG — injectable, never `Math.random` —
  Fisher-Yates, `freshDeckMinus`), `eval.ts` (pokersolver wrapper: best-5-of-7,
  plays the board, tie-aware), `betting.ts` (bomb-pot betting + side-pot
  partition + uncalled-bet return), `showdown.ts` (board winners, representation
  & final flips, surrender), `manager.ts` (`DoubleFlopManager` referee,
  implements `shared/engine/table-engine.ts`). DFT is **7-max** (8 players ×
  6 + two 5-card boards > 52; rejected at the config layer).
- **Step 6 — THE SEAM (done by Kabir).** The co-owned layer is wired: the server
  hosts **both** engines with a host mode-switch (NLHE ↔ DFT, applied next hand);
  `shared/protocol.ts` carries `submitArrangement` / `declare`; `shared/engine/
  types.ts`'s `GameState` grew a `variant` discriminator plus DFT boards /
  picking / decisions / flip-reveal sub-states; and **`party/filter.ts` is the
  anti-cheat core** — it strips, per viewer, other seats' hole cards **and their
  locked arrangement** and **their run/surrender declaration**. Only *who* has
  locked in is public; never *what*. This was the hard requirement of Step 6 and
  it is implemented in `filter.ts`.
- **DFT UI (done by Kabir).** Two-board table, interactive drag hand-split picker
  (default split pre-filled + always playable, 30s timer, irreversible accept),
  blind run/surrender modal, sequential flip reveal.

**Both DFT rule questions are now RULED** (see `docs/double-flop-tex-answers.md`
→ RULINGS). What was HANDOFF §E1/§E2 is settled:
- **R1 — surrender eligibility: banker-only.** Only the player who owns the
  banked half may surrender; the challenger must run. Enforced at
  `manager.declare()`.
- **R2 — flip ties: even split, immediately, no re-runs.** A final heads-up flip
  tie splits the stake 50/50; a representation-flip tie crowns no champion.

> **One discrepancy to tell Parth (engine owner):** the answers doc originally
> said R1 needed "no code change" — that was wrong. The engine *did* let either
> player surrender a plain heads-up flip; Kabir added the banker-only enforcement
> at `manager.declare()` (commit `dd08820`). The engine and the doc now agree,
> but Parth should know the enforcement point moved into his layer. (Also flagged
> in `ROADMAP.md`.)

### Lifecycle hardening (items 1–7) — BUILT + PUSHED, **worker deploy dormant** (§A0)

The first attempt to actually *play* DFT died on the first all-in hand with no
way to recover. **Root cause (diagnosed, not guessed): not a crash — a shared
lifecycle dead-end.** When a player busts and fewer than two players have chips,
the engine correctly parks at a waiting state — but there was **no recovery UI**
and **host power was tied to room-creation order**, so if the wrong person was
"host" nobody could re-seat, rebuy, or restart. NLHE had the same latent gap;
DFT just surfaces it fast (bomb-pot antes bust stacks quickly). The seven fixes,
all verified headless + over the wire (see §D for what that does and doesn't
prove):

1. **Busted → live spectator.** Removed from the seat but stays connected and
   watching; an explicit "waiting for ≥2 players with chips" reason shows in both
   modes (never a silent freeze); DFT keeps a dealer log; spectators are never
   trapped behind DFT picking/decision overlays.
2. **Numbered seats + seat requests.** Fixed seat grid (NLHE 1–8, DFT 1–7). A
   spectator taps an empty seat → request → **either admin** gets accept / reject
   / ignore (persists to next game) / edit-stack-then-accept.
3. **Approved rebuys.** Every add-chips/rebuy needs admin approval, between hands
   only, both modes — and the **busted player can initiate the request themselves.**
4. **Stop / restart / deal-next.** Admins can stop (settles the ledger) and
   restart a fresh session on the same table — same seated crew, fresh default
   buy-ins, carried-over *ignored* seat requests — without anyone re-entering the
   room or keyword. Plus the previously-missing manual "deal next hand" control
   for a parked table.
5. **CREATE vs JOIN.** Lobby split into **Create game** (character + table +
   keyword + mode + blinds + starting stack; auto-starts you seated) and **Join
   game** (character + table + keyword only). The server now **self-registers**
   any character new to a room (keyword set on first login; returning must match)
   — so an admin can join a room they never created, and a full table drops you
   to spectate + request a seat.
6. **Two permanent admins by IDENTITY.** `parth` and `kabir` are admins from
   their character identity, **never** room-creation order; both hold every host
   power independently; nobody else ever does. Replaced the old roster `host` flag.
7. **Legible pot + stacks.** The pot total is the biggest number on the felt
   (22px/700 desktop, 17px mobile) and every seated stack reads at a glance
   (16px/700 desktop, 14px mobile). DFT's between-boards pot inherits the same.
   *Frontend-only — already live via Vercel.*

---

## D. WHAT THE TESTS / VERIFICATION DO **NOT** PROVE

Read this before trusting the green checkmarks.

- **No two-device human playtest has happened for 1B or 1D** (see §A). Everything
  is headless + wire-bot verified only.
- **Conservation is not rules-correctness.** Every DFT engine test proves chips
  are never created or destroyed. It does **not** prove the betting follows poker
  rules perfectly — a min-raise/reopening bug could be poker-wrong while
  conserving chips flawlessly. The `betting.ts` side-pot + uncalled-bet-return
  code is the **highest-risk code in the repo** and needs a human read (§H).
- **The lifecycle fixes (items 1–7) had NO visual QA.** They were verified by
  headless engine tests + **wire E2Es over real websockets** (`test-host-identity`,
  `test-seat-request`, `test-chip-request`, `test-restart`, `test-create-join` —
  all green) + a clean `build:check`, and item 7's font sizes were confirmed in a
  real browser at desktop and 375px. But the **screenshot tool was down this
  session**, so no one has eyeballed the new spectator banner, the seat-request
  admin panel, the CREATE/JOIN lobby, or the restart flow *as rendered*. The
  playtest checklist for each is in `docs/KABIR-TODO.md`.
- **DFT interactive phases were driven programmatically.** Arrangements and
  run/surrender decisions in tests are chosen by code, not by real simultaneous
  players over a network with a 30-second clock. The blind/simultaneous secrecy
  guarantee is enforced by `party/filter.ts`, verified by the filter tests — but
  never by two humans actually trying to peek.
- **Flip fairness is not distribution-tested.** Flips are seeded and
  conservation-checked; nobody has verified the win distribution is unbiased.

---

## E. THE TEST SUITES (run with `npx tsx <file>`)

Gates that must be green before any commit that touches their layer:

- `test-engine.ts` — **NLHE** invariant test. 200 random hands; must print
  `ALL INVARIANTS PASS`. NLHE must never regress.
- `test-filter.ts` — view-filter leak test (NLHE + DFT). Must print `NO LEAKS`.
- `test-dft.ts` — **the DFT gate.** 400 betting-only hands + ~369 full manager
  hands (conservation every phase, ledger nets zero) + all seven edge cases +
  8-players-rejected.
- `test-dft-units.ts`, `test-dft-session.ts`, `test-dft-showdown.ts`,
  `test-dft-view.ts` — bijection/RNG/eval units, session round-trip, showdown
  correctness + conservation fuzz, per-flip view integrity.
- **Wire E2Es** (need `npm run party:dev` in another terminal; target
  `PARTY_HOST=127.0.0.1:<port>` if wrangler picks a non-8787 port):
  `test-host-identity.ts`, `test-seat-request.ts`, `test-chip-request.ts`,
  `test-restart.ts`, `test-create-join.ts`, plus `test-online.ts` /
  `test-online-dft.ts`.
- Build: **`NEXT_DIST_DIR=.next-check npx next build`** (never plain `next build`
  while the dev server runs — see §H).

---

## F. WHAT'S NEXT (in order)

1. **Deploy the worker** — `npm run party:deploy` (Kabir). Nothing below matters
   until the live server runs the code on `main`. See §A0.
2. **1B two-device playtest** (Parth + Kabir): two phones, full Hold'em session,
   one mid-hand disconnect + rejoin. Closes the 1B gate.
3. **1D two-device playtest**: a full Double Flop Tex session on two phones,
   busting someone out and recovering via the new lifecycle controls (seat
   request, rebuy, restart). This is the exact scenario that broke before items
   1–7 — confirm it now recovers. Use the per-item checklist in
   `docs/KABIR-TODO.md`.
4. **Phase 1E** — the nine items in `docs/phase-1e-fixes.md` (sit-out timer,
   50-chip bet slider, POV rotation, showdown reveal + highlight, dealing
   animation, red-felt redesign, etc.). Note items 1E overlaps partly with what
   the lifecycle pass already did (e.g. "host = Parth/Kabir only" is now item 6);
   reconcile before building. **1E runs AFTER 1D — never mix 1E into a 1D commit.**

**Step 6 (the DFT server seam) is DONE** — it is no longer a future task. If an
older note tells you to build it, that note is stale.

---

## G. WHAT IS SKIPPED, AND WHY

- **1B.2 (Supabase persistent ledger)** and **1C (Sit & Go mode)** were
  deliberately deferred — independent, buildable later without conflict. Parth
  chose to jump straight to 1D. The overall cross-session ledger still lives in
  **localStorage** for now.
- **Run-it-twice** was cut from 1D entirely — never specced for DFT's two-board
  flip structure. It becomes its own later phase, **scoped to normal Hold'em
  all-ins only** (see ROADMAP).
- **A shared `SessionCore`** (deduping the session scaffolding — ledger, sit-out,
  clock, rebuy, button rotation, and now the item 1–5 lifecycle logic — that
  `GameManager` and `DoubleFlopManager` currently duplicate) is deferred until
  **after both engines are gate-passed**, to avoid regressing the deployed NLHE
  engine. Note items 1–5 were implemented in **both** managers in parallel; a
  future `SessionCore` is where that duplication should collapse.

---

## H. THE LANDMINES

From `CLAUDE.md` (hard-won) and these phases:

- **The poker-ts patch is load-bearing.** `poker-ts@1.5.0` silently destroys
  all-in players' winnings at showdown. We patch 4 lines in `dealer.js`
  (`patches/poker-ts+1.5.0.patch`), auto-applied by the `postinstall` hook
  (`patch-package`). **Never remove postinstall. Never upgrade poker-ts without
  re-running `npx tsx test-engine.ts`.** DFT doesn't use poker-ts.
- **Never run `next build` while the dev server is running** — they share `.next`
  and the build deletes the dev server's assets. Use `build:check` (separate
  `.next-check` dir). The npm script uses bash env syntax; on Windows run
  `NEXT_DIST_DIR=.next-check npx next build` from Git Bash.
- **Restart the dev server after config/structure changes** (tsconfig paths,
  next.config, moving folders) — it caches module resolution.
- **`holeCards`/`communityCards` must be snapshotted BEFORE `showdown()`** in the
  NLHE engine — poker-ts asserts if you read them after the hand ends.
- **The `deadBets` quirk** in `GameManager`: a preflop folder's dead bet lingers
  in `seats().betSize` while a postflop folder's zeroes instantly. Don't
  "simplify" the before/after fold measurement — it double-counts preflop folds.
- **Host authority is IDENTITY-based now** (item 6): `ADMIN_IDS = {parth, kabir}`
  on the server, `isAdmin()`; the client `isHost` comes from the server's `you`
  message, never guessed. Don't reintroduce a per-room "creator is host" flag.
- **Login self-registers** (item 5): a character new to a room sets its keyword on
  first login; a returning character must match or gets the single opaque
  `Invalid login`. Keep the rejection message identical for exists/not-exists —
  it's deliberate (no username enumeration).
- **Fonts are self-hosted** via @fontsource (Google Fonts fetch breaks builds).
- **Deploys:** push → Vercel redeploys the frontend automatically; the game
  server does **not** — run `npm run party:deploy` after touching `party/` or
  `shared/` (§A0).
- **pokersolver has its OWN rank scale** (flush = 6) differing from poker-ts's
  (flush = 5). DFT eval uses pokersolver's `.name`/`.descr`/`.rank` directly and
  must **NEVER** route through `handNames.ts` (that maps poker-ts's scale only).
  pokersolver also names a royal flush `"Straight Flush"` — handle in the 1E
  "name the winning hand" UI.
- **DFT is 7-max.** 8 players is physically impossible (7×6 + two 5-card boards =
  52 exactly) and is rejected at the config layer — surface that in the lobby,
  don't let it crash the engine.
- **`betting.ts` side-pot partition + uncalled-bet return is the single
  highest-risk code in the repo.** Heavily conservation-tested, but conservation
  ≠ rules-correctness (§D). Give it a careful human read.

---

## I. THE WORKING RHYTHM

Parth and Kabir **alternate.** When one finishes a chunk they hand back **the
updated repo plus a fresh context document** (like this one). Whoever picks up
**starts by reading it** — the repo + the handoff doc are the only shared memory.

---

## J. THE RULES BOTH SIDES FOLLOW

- **One step at a time.** Plan → get agreement → build → verify → commit.
- **Test + build green before every commit**, and **push at every commit** (no
  local-only commits — the other side pulls from `main`).
- **Own commit per item; clear messages.** Flag every `party/`-touching commit so
  the redeploy list stays accurate.
- **Never touch the poker-ts patch or the `postinstall` hook.**
- **No silent dependencies** — say what you're adding and why, first.
- **Back up before destructive edits.**
- **Push back. Don't be a yes-man.** If a spec is inconsistent or an approach is
  wrong, say so directly.
- **Diagnose before you fix.** The lifecycle pass started by proving the "table
  died" was a lifecycle dead-end, not a crash, *before* changing a line.
