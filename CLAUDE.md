# The Table — custom poker for the boys

Private multiplayer poker game. Kabir owns the **client** (UI, lobby, ledger display, later the 3D scene). Parth owns the **server/engine** side (game logic, later the PartyKit multiplayer server). The seam is client vs server — NOT "3D vs poker".

## Architecture (agreed, don't drift)

- **Engine = `shared/engine/`** — plain TypeScript, ZERO UI imports. In phase 1b this folder lifts onto the PartyKit server unchanged. If you're about to import React into the engine, stop.
- The UI talks to the engine ONLY through `GameManager` methods and the `GameState` snapshot from `state()`. The future server sends this same `GameState` over the wire (with other players' `holeCards` stripped).
- Stack: Next.js on Vercel (frontend) → PartyKit (authoritative game server, phase 1b) → Supabase (persistent ledger, phase 1b+). For now the overall ledger lives in localStorage.

## Phases

- **1a (DONE)**: NLHE cash game, hot-seat on one screen, no server. This repo.
- **1b**: multiplayer — PartyKit server owns GameManager; per-player views; keyword login; disconnect grace (2 min), re-login from another device (spec 8.2); rathole prevention (3.5).
- **1c**: Sit & Go mode — 100k fixed stacks, 1k/2k blinds doubling per elimination, winner takes all, host sets ₹ value for the overall ledger (spec 1.2, 3.2, 3.3, 4.1).
- **1d**: Double Flop Tex (spec 1.1). Custom eval via `pokersolver` (already a dependency). Ruleset is settled in `docs/double-flop-tex-answers.md` — the law for 1D. Run-it-twice is split out to its own later phase (Hold'em all-ins only); it is NOT part of 1D.
- **2**: 3D scene (react-three-fiber) replacing the 2D table. Reads the exact same GameState.

## Critical: the poker-ts patch

`poker-ts@1.5.0` has a chip-destroying bug: between betting rounds the dealer replaces its player array with only players still able to bet, so **all-in players get nulled — and at showdown their payout hits `_players[seat]?.addToStack(payout)` and silently vanishes**. Winnings destroyed, chips leak.

We patch 4 lines in `dealer.js` (preserve a full `_allPlayers` array and pay winners through it). The patch lives in `patches/poker-ts+1.5.0.patch` and auto-applies via the `postinstall` hook (`patch-package`). **Never remove the postinstall script, never upgrade poker-ts without re-running the conservation test below.**

## Testing — run before every push

```
npx tsx test-engine.ts
```

200 random hands with timeouts, sit-outs, rebuys, all-ins. Asserts after EVERY action: stacks + bets + pots == total bought in, and the ledger nets to zero. If you touch the engine and this fails, you broke chip conservation.

## Verification — real browser, not just compilers

- **Every step that touches CSS or components ends with a real-browser screenshot check at desktop width AND 375px** before the step is called done. "Compiles" is not "renders" — the CSS pipeline can break while the build stays green.
- **Never run `next build` while the dev server is running** — they share `.next`, and the build deletes the dev server's assets (fresh loads then 404 into unstyled bare HTML while hot-reloaded tabs keep looking fine). Local verification builds use `npm run build:check` (separate `.next-check` dir); plain `npm run build` is for CI/Vercel.
- After config or structure changes (tsconfig paths, next.config, moving folders), **restart the dev server** — it caches module resolution and will serve a stale graph indefinitely.

## Conventions

- Chips are abstract points (spec 3.1), formatted with `fmt()` (en-IN locale).
- All spec references (e.g. "3.4") point to `poker-logic-spec-for-parth.pdf` — Parth's answered rules doc, the source of truth for game rules.
- Engine rebuilds a fresh poker-ts `Table` every hand and manages button rotation itself (`nextButtonSeat`) — poker-ts's internal button drifts when players stand up/bust. Don't "simplify" this back to a persistent table.
- `holeCards`/`communityCards` must be snapshotted BEFORE `showdown()` — poker-ts asserts if you read them after the hand ends.
- **poker-ts view quirk**: a preflop folder's dead bet stays visible in `seats().betSize`, but a postflop folder's zeroes instantly (chips sit in an internal bucket until round end). `GameManager` compensates via `deadBets` — measured as the betSize that actually disappears at fold time. Don't "simplify" the before/after measurement into a flat `+= betSize`; that double-counts preflop folds.
- Design tokens live at the top of `globals.css`. Fonts are self-hosted via @fontsource (Google Fonts fetch breaks builds).
- **Local hot-seat mode is dev-only**: players never see it. Reach it at `/?dev=local` — it's the engine debug harness (phase 1a), kept working on purpose. The visible app is online-only.
- **Deploys**: pushes to `main` auto-deploy the frontend (Vercel ↔ GitHub). The game server does NOT auto-deploy — after touching `party/` or `shared/`, redeploy it manually with `npm run party:deploy`.
- **Push at every commit**: never leave commits local. `git push` immediately after each commit lands (and `npm run party:deploy` in the same breath if the commit touched `party/` or `shared/`). Local-only commits are a repo-rule violation — the whole point is the live site and the game server stay in lockstep with `main`.
