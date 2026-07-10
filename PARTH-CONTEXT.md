# PARTH — READ THIS / PASTE INTO CLAUDE

This doc gives you (and your Claude) full context on the poker project. Kabir built phase 1a with his Claude; this is your onboarding.

## The project in one paragraph

We're building a private multiplayer poker game for the group. Phase 1a (done) is a playable No-Limit Hold'em cash game on one screen — real engine, real ledger, hot-seat play. Next phases: multiplayer over a shared link (1b), Sit & Go mode (1c), your Double Flop Tex variant + run-it-twice (1d), then a 3D table with custom characters (2). Chips are abstract points; a session ledger tracks buy-ins/net per person, and an overall ledger tallies nets across sessions (your spec 3.6).

## Who owns what

- **Kabir = client**: everything the player sees — lobby, table UI, ledger screens, later the whole 3D scene.
- **You = server/engine**: the game's brain — `src/engine/` now, and in 1b the PartyKit server that runs it authoritatively (it holds the hidden cards, so nobody can cheat by reading the page source).
- The contract between you two is `src/engine/types.ts` — especially `GameState`. Change it only by agreement, because both sides depend on it.

## Stack

Next.js (Vercel) for the frontend → PartyKit for the live game server in 1b → Supabase for the persistent overall ledger in 1b+. One GitHub monorepo, both of you working through Claude Code.

## What's already built (phase 1a)

- `src/engine/manager.ts` — GameManager: full hand loop, blinds rotation, 30s clock + 30s time bank (refills +5s/hand), auto check/fold on timeout, auto sit-out after 2 straight timeouts, host-approved rebuys between hands only, pause/resume, voluntary show after a fold-win, session ledger. All per your spec answers.
- `src/engine/types.ts` — the shared contract.
- 2D table UI — dark felt, glowing turn indicator, action bar with raise slider (Min/Pot/All-in), dealer log, ledger panel, lobby with config + overall ledger.
- `test-engine.ts` — 200-hand randomized stress test asserting chip conservation after every single action.

## The bug we found (you'll like this)

poker-ts (the battle-tested engine library) has a real bug: when someone is **all-in** and other players keep betting on later streets, the library internally drops the all-in player from its array — and at showdown, their winnings are paid into a null via optional chaining and **silently destroyed**. We proved it with a chip-conservation test (chips literally vanished), traced it through the library source, and wrote a 4-line patch that's frozen in `patches/` and auto-applies on npm install. Your spec's guardrail ("don't hand-write side pots, use a tested library") was right — but even tested libraries need invariant tests. Run `npx tsx test-engine.ts` before every push.

## Open questions on Double Flop Tex (need YOUR answers before 1d)

Your rules writeup is great but has gaps an engine can't guess:

1. **Betting sequence with two boards.** You wrote "players may be betting on either board at any time" but there's ONE shared pot. Does that just mean normal betting rounds (preflop → flops → turns → rivers) where your motivation can come from either board? Or something structurally different? The engine needs one defined action order.
2. **Face-down turn/river reveal timing.** Both turns are dealt face-down, revealed "when the preceding betting round is complete." So: bet after flops → reveal BOTH turns → bet → reveal BOTH rivers → bet → showdown? Confirm that's the sequence (3 post-deal betting rounds total).
3. **Hand assignment is positional and binding?** Player picks which 2 cards are Hand 1 (Board A), Hand 2 (Board B), Hand 3 (Tex) — do they choose at showdown, or are the six cards locked into positions when dealt? Choosing at showdown is a real strategic layer but needs a picking UI.
4. **Side pots × flips.** With all-ins you can have main + side pots. Does the whole board-win/Tex-flip/surrender structure run independently per pot (your 9.3 answer suggests you think per-pot)? That can mean multiple sequential flips per hand.
5. **Three-way+ Tex flips.** You covered removing 6 cards for three players, but if three players each win/represent something, is the final flip always heads-up between two board representatives, or can 3+ ever be in one flip? Your text implies always exactly 2 for the final — confirm.
6. **Surrender with 3+ players in a chop flip.** 30/70 is defined for two players. If three players chop a board and one surrenders, what do they get — 30% of a third? Define the general rule.
7. **Ante and short stacks.** 2BB ante bomb pot: if someone can't cover the ante, are they dealt out or all-in for the ante?

Send answers back the same way as the spec doc and 1d becomes buildable.

## How to work on the repo

1. Clone, `npm install` (the poker-ts patch auto-applies — if you ever see "patch failed", stop and tell Kabir).
2. `npm run dev` to play locally, `npx tsx test-engine.ts` before pushing.
3. Read `CLAUDE.md` — it's the conventions file both our Claudes follow. The number-one rule: **no UI imports inside `src/engine/`**, ever. That folder is moving onto your server in 1b.
4. Your 1b starting point: PartyKit room that owns a GameManager instance, receives `{action, amount}` messages, broadcasts per-player-filtered `GameState` (strip everyone else's `holeCards`), keyword login mapping to player ids, 2-min disconnect grace (spec 8.2).
