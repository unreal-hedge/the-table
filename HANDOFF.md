# The Table — Handoff

> Written to be pasted into a **fresh Claude session with zero prior context**.
> If that's you: read it top to bottom before touching anything. It tells you
> what the project is, what's done, what's built-but-not-live, what's untested,
> and exactly what to do next.
>
> **Last rewritten:** 2026-09-12, after Parth's **readability + motion + Phase 1E
> pass** (the session that followed the failed first DFT playtest). If the git
> log has commits past the ones this doc names, trust the log, not this line.

---

## A. PRIORITY 1 — THE WORKER IS STILL DORMANT, AND TWO PLAYTEST GATES ARE OPEN

### A0. The live game server is still on `22fbcf8`. Everything after it is NOT LIVE.
The Cloudflare worker does **not** auto-deploy yet. Kabir's GitHub Action
(`.github/workflows/deploy-worker.yml`) exists and runs on every `party/` /
`shared/` push — and it has **failed twice at the "Deploy to Cloudflare" step**
(runs on `3206d9d` and `9838efa`) after every gate before it passed. That is the
signature of the missing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo
secrets (the logs need admin rights, so it's inferred from the step results).

**So the live Vercel client is talking to a server that doesn't understand it.**
The client now sends `draftArrangement`, `sitToggle`, and the new `show` rule;
the live server ignores/rejects them. Nothing in this pass works on the live
site until Kabir adds the two secrets and re-runs the Action (or runs
`npm run party:deploy` by hand). `docs/KABIR-TODO.md` item 1 has the list of
dormant commits.

### A1 / A2. The 1B (Hold'em) and 1D (Double Flop) two-device playtests have **still never happened.**
Everything is headless + wire-bot + real-browser verified by one person driving
two tabs. The checklist for the two-phone session is `docs/KABIR-TODO.md` §3.

---

## B. WHAT THE PROJECT IS

**The Table** is a private, invite-only multiplayer poker game two friends —
**Parth** and **Kabir** — are building for their group. **No real money:** chips
are abstract points; a ledger tracks buy-ins and net per person.

- **Kabir owns the client** (UI, lobby, table, ledger screens, later a 3D scene).
- **Parth owns the server/engine** (game logic, the multiplayer server).
- The seam between them is **client vs server**, not "3D vs poker".

**Live URLs:**
- Frontend (Vercel): **https://poker-hazel-tau.vercel.app** — auto-deploys on every push to `main`.
- Game server (Cloudflare Workers + Durable Objects): **https://the-table.kabir31vazirani-f26.workers.dev** — deploys via the Action once the secrets exist; until then `npm run party:deploy` (Kabir).

**Architecture (agreed — do not drift):** Next.js on Vercel → PartyServer on
Cloudflare (the authoritative game server; it holds the deck and hidden cards) →
Supabase (persistent ledger, not built yet). The engine is **plain TypeScript
at `shared/engine/` with ZERO UI imports**; the same code runs in the browser
(hot-seat dev mode) and on the server. `party/filter.ts` strips other players'
secrets per viewer before anything goes on the wire.

**Source-of-truth docs, in reading order:** `CLAUDE.md`, `ROADMAP.md`,
`docs/double-flop-tex-answers.md` (**the law for DFT — wins any conflict**),
`docs/phase-1e-fixes.md`, `docs/KABIR-TODO.md` (the live action list).

---

## C. WHAT IS DONE

### Phase 1A — DONE
NLHE cash game, hot-seat, dev-only at `/?dev=local` (the engine debug harness).

### Phase 1B — BUILT + DEPLOYED, gate unpassed
Full multiplayer: keyword login, 2-minute disconnect grace, device takeover,
server-owned clock, rathole prevention, chat. Headless E2E over real websockets.

### Phase 1D — Double Flop Tex — BUILT, gate unpassed
Engine (`shared/engine/dft/`), the server seam, filter secrecy, and the UI.
Rules: `docs/double-flop-tex-answers.md` (R1 banker-only surrender, R2 even-split
ties). 7-max by card arithmetic.

### Lifecycle hardening (items 1–7) — BUILT, worker deploy dormant
Busted → spectator, numbered seats + requests, approved rebuys, stop/restart/
deal-next, CREATE vs JOIN + self-registration, two permanent admins by identity
(`parth`, `kabir`), legible pot + stacks. Only `22fbcf8` of this is live.

### The readability + motion + 1E pass (2026-09-12) — BUILT, worker deploy dormant

Why it exists: Parth and Kabir sat down to play DFT and couldn't read their
cards, couldn't tell which hand played which board, saw everything appear at
once, and the showdown flashed past. Commits, in order:

1. `2af7dad` **KABIR-TODO #3/#7** — parked-table reason logged once; restart
   proven not to carry the sit-out flag (`test-restart.ts`). *shared*
2. `49ded1d` **KABIR-TODO #1 #2 #4 #5 #6 #8** — compact "☰ Table" menu sheet +
   "Requests N" pill (admins), no action bar for spectators, lobby subtitle,
   in-app dialogs (rebuy, edit stack, restart, end), HANDOFF enumeration note.
3. `215aadc` **Cards + claret felt (2.1 / 1E.9)** — one `CardFace` with a width
   variable (xs/sm/md/lg), big centre pip, corner index, four-colour suits,
   `dim`/`lift` states; claret felt, walnut rail, gold accents.
4. `7a0637b` **Live hand-split drafts (2.4, engine + wire)** — `draftArrangement`
   message; the working split is stored engine-side, stripped per viewer by the
   filter, seeds picking, and a picking timeout locks what was on screen. The
   settled hand stays on the table at handEnded (cards, splits, pots, folded).
   DFT action badges + log lines; DFT time bank; no rabbit-hunting on fold-wins.
   *shared + party*
5. `e190971` **The three-hand dock (2.2 / 2.3 / 1E.6)** — HAND A · TEX · HAND B
   always grouped at the bottom, live hand names from the engine's evaluator,
   tap-to-swap rearranging any time until lock (drafts to the server), board
   focus glow, picking in the dock (timer + LOCK IN), POV rotation (viewer at
   the bottom), explicit phone seat map, fanned opponent backs, chat in the
   top-right cluster.
6. **Showdown pace + 1E engine** (see git log) — `shared/engine/timing.ts` is the
   ONE pace table; `handEndHoldMs(state)` tells the server how long to hold a
   finished hand (server uses it). `runoutCards` (NLHE all-in) and
   `dft.contests` (per-pot resolution kinds) at handEnded. **1E.1** sit out only
   after two whole hands with no action of any kind (time bank, lock, declare
   count as actions); **self sit-toggle** message; **1E.7** `showableSeats` +
   `voluntaryShow` for folded players and fold-win winners in BOTH engines;
   **Hold'em fold-win bug fixed** (see §H). *shared + party*
7. **Motion + showdown + 1E client** (see git log) — `usePresentation` turns
   server snapshots into a timeline: hole cards fly from the dealer one at a
   time rotating; Board A's cards land one by one, then Board B's; turn/river
   get a beat; all-in runouts one card at a time; betting opens only when both
   boards are up. The showdown replays slowly for EVERYONE: Board A (winner
   named, five lifted) → Board B → each flip one at a time (fresh board dealt
   card by card) → surrender / tie explanations → the pot slides to the
   winner(s); stacks stay frozen until it lands. Per-pot run/surrender modal
   (3.4). SHOW HANDS button (1E.7). 50-chip slider (1E.2). Login persists across
   a refresh, cleared when the session ends (1E.4). "away · out next hand" badge.

Everything above was verified in a real browser at desktop and 375px, and the
motion/showdown by DOM sampling of a live table (see §D).

---

## D. WHAT THE TESTS / VERIFICATION DO **NOT** PROVE

- **No two-device human playtest has happened for 1B or 1D.** One person drove
  two browser tabs. Two phones on real networks may still surprise us.
- **The showdown replay was verified by DOM sampling, not by eye.** The
  screenshot tool went unstable during the final captures; the deal flights,
  board reveal timing (A then B, ~340ms apart), the flip step (five cards ~370ms
  apart, winner named), the pot flights and the frozen-stack release were all
  observed as DOM state at 120ms resolution, plus earlier screenshots of the
  dock, boards, picking and decisions. **Look at the replay with your own eyes
  on two phones before trusting its feel.**
- **Conservation is not rules-correctness.** `betting.ts` side pots + uncalled
  bet return remain the highest-risk code in the repo.
- **Flip fairness is not distribution-tested.**
- **Hold'em all-in runouts and side pots in the new choreography** were tested
  headless (a preflop all-in reports a 5-card runout, hold covers it) but not
  watched in a browser.

---

## E. THE TEST SUITES (run with `npx tsx <file>`)

Gates before **every** commit — all of them, every time:
- `test-engine.ts` → `ALL INVARIANTS PASS`; `test-filter.ts` → `NO LEAKS`
  (now also proves betting-phase drafts are stripped per viewer).
- `test-dft.ts`, `test-dft-units.ts`, `test-dft-session.ts`,
  `test-dft-showdown.ts`, `test-dft-view.ts`.
- **`test-lifecycle.ts` (new)** — log-once, drafts (rules, timeout locks the
  draft, lock is final, folded can't draft), handEnded exposure, no rabbit
  hunt, DFT time bank, hand-end holds, 1E.1 inactivity sit-out (both engines,
  time bank / lock count as activity), 1E.7 show hands, the fold-win fix.
- `npm run party:check`.
- **Wire E2Es (need `npm run party:dev`):** `test-online.ts`, `test-online-dft.ts`
  (now also: a draft comes back to its owner, an opponent's split never
  arrives), `test-host-identity.ts`, `test-seat-request.ts`,
  `test-chip-request.ts`, `test-restart.ts`, `test-create-join.ts`.
- Build: `NEXT_DIST_DIR=.next-check npx next build` (never plain `next build`
  beside the dev server).

---

## F. WHAT'S NEXT (in order)

1. **Deploy the worker** — add the two CI secrets and re-run the Action, or
   `npm run party:deploy` (Kabir). Nothing below matters until the live server
   runs `main`. See §A0 and `docs/KABIR-TODO.md` item 1.
2. **1D two-device playtest** with the checklist in `docs/KABIR-TODO.md` §3 —
   reading cards, following the hand, the showdown replay, the bust/recover
   flow. Then **1B** (Hold'em, with a mid-hand disconnect + rejoin).
3. Feed the playtest findings back; polish the replay pace from
   `shared/engine/timing.ts` if it drags or rushes.
4. Later: 1B.2 (Supabase ledger), 1C (SNG), 1F (run-it-twice, Hold'em only),
   the shared SessionCore, Phase 2 (3D).

---

## G. WHAT IS SKIPPED, AND WHY

- **1B.2 / 1C** deferred; the overall ledger still lives in localStorage.
- **Run-it-twice** cut from 1D (Hold'em-only later phase).
- **SessionCore** (dedupe the two managers' session scaffolding) deferred until
  both engines are gate-passed; 1E's inactivity + show logic was implemented in
  BOTH managers in parallel — one more thing for SessionCore to collapse.

---

## H. THE LANDMINES

- **The poker-ts patch is load-bearing** (`patches/poker-ts+1.5.0.patch`, applied
  by `postinstall`). Never remove postinstall, never upgrade poker-ts.
- **poker-ts ends a fold-win through its SHOWDOWN path** — `winners()` comes
  back empty. `finishByShowdown` now detects that and routes to the fold-win
  path (winner's cards hidden, pot reported, `canShowSeat` set). Before this
  pass the survivor's cards were marked revealed and no winner row existed.
- **`shared/engine/timing.ts` is a contract, not a client detail.** The server
  holds a finished hand for `handEndHoldMs(state)`; the client's replay is cut
  from the same numbers. Change the pace there only, and keep
  `test-lifecycle.ts`'s hold checks green.
- **Hand-split drafts are secret.** They ride `SeatView.arrangement` from the
  deal, gated by `revealed` exactly like hole cards; the filter strips them and
  the server never broadcasts a draft. Don't add a "someone rearranged" signal.
- **`usePresentation` only animates what it witnessed.** A viewer's first
  snapshot mid-hand renders immediately; a first snapshot at the start of a hand
  (flop out, nobody acted) animates the deal; the replay runs for anyone who saw
  any of the hand live.
- **Never run `next build` while the dev server is running** — use
  `NEXT_DIST_DIR=.next-check`.
- **pokersolver has its OWN rank scale** — never route it through `handNames.ts`.
  `src/lib/handLabel.ts` names hands from pokersolver's words + ordered cards
  (royal flush handled).
- **DFT is 7-max.** **Host authority is identity-based.** **Login self-registers
  (enumeration accepted).** **Restart re-indexes seats densely.**
- **Wrangler dev reloads on every `shared/`/`party/` save and wipes the room**
  — every manual browser test needs a fresh start after an engine edit.

---

## I. THE WORKING RHYTHM

Parth and Kabir alternate. Whoever picks up starts by reading this doc and
`docs/KABIR-TODO.md`; the repo + these docs are the only shared memory.

## J. THE RULES BOTH SIDES FOLLOW

One step at a time. All gates green before every commit; push at every commit.
Own commit per logical unit; flag every `party/` / `shared/` touch so the deploy
list stays accurate. Never touch the poker-ts patch. No silent dependencies.
Real-browser screenshots at desktop AND 375px for every visual change — and say
plainly when the screenshot tool couldn't. Push back; don't be a yes-man.
Diagnose before you fix.
