# The Table — Build Roadmap

> Login is keyword-based as of Step 5 (name + keyword per player, host-configured). One rule to know: **the first person into a fresh room becomes its host** — join your room before sharing the link, and re-claim it first if the server ever restarts.

The plan, phase by phase. **Every phase has a gate**: engine test passes (`npx tsx test-engine.ts`) + `npm run build` clean + Kabir playtests and says **"gate passed"** before the next phase starts. Never build two phases in one go. Checkboxes get updated as work lands.

Rules that never change (from CLAUDE.md):
- `shared/engine/` stays UI-free — no React/DOM imports, ever.
- Never touch the poker-ts patch (`patches/poker-ts+1.5.0.patch`) or remove the `postinstall` hook.
- Run `npx tsx test-engine.ts` before every commit — it must print `ALL INVARIANTS PASS`.

---

## PHASE 1B — MULTIPLAYER  *(in progress)*

Goal: friends join from their own phones/laptops via one shared link. Server is authoritative — it holds the deck and hidden cards.

- [x] **PartyKit status check** — DONE. PartyKit is alive & Cloudflare-owned (releases as of June 2026, no deprecation), backed by Durable Objects. Decision: build on **PartyServer** (the actively-developed library) running on our own **Cloudflare account**, deployed with `wrangler` — same room-based programming model as classic PartyKit, more future-proof. Classic `partykit` CLI was the simpler-but-less-maintained alternative; not chosen.
- [x] **Repo layout (engine move)** — DONE. `src/engine/` → `shared/engine/` (content unchanged). `@/engine/*` alias repointed in tsconfig so client imports are untouched; root scripts updated. Test + build green.
- [x] **Repo layout (server folder)** — DONE. `party/` with `server.ts` (TableServer skeleton), `wrangler.jsonc` (DO binding + SQLite migration + nodejs_compat), own `tsconfig.json`. Root tsconfig excludes `party/`. Scripts: `party:dev`, `party:deploy`, `party:check`. Verified: worker typechecks, `wrangler --dry-run` bundles + binding resolves, engine test + Next build still green.
- [x] **Protocol** — DONE. `shared/protocol.ts` (wire contract, co-owned like types.ts); `party/filter.ts` strips other players' un-revealed holeCards per viewer; `party/server.ts` is the authoritative host. Server verifies every `act` (connection → playerId → seat must equal playerToAct) and `host` command (host ids only) — the client's word is never trusted. Chat relay w/ last-50 buffer included. Patched poker-ts verified present in the worker bundle.
  - [x] Acceptance (code level): `npx tsx test-filter.ts` — 80 hands, 20k+ strip assertions after every action, showdown reveals still visible. Live devtools check happens at the phase gate.
- [x] **Client online mode** — DONE. Lobby has Local / Online tabs; online joins a room (name-based provisional login) and renders server-pushed state through the same TableView as hot-seat. Connection pill (connected/reconnecting/disconnected) + "in room: [names]" presence line always visible; a dropped connection shows a full-screen veil, never a silent freeze; stale state after a server restart clears via `noGame`. Verified live in-browser vs a headless bot, plus `test-online.ts`: 3 headless clients, 10 real hands over websockets — card stripping on the wire, out-of-turn acts and non-host commands rejected, ledger nets 0. Also hardened: host `dealNext` is refused mid-hand (would have destroyed the live pot).
- [x] **Login** — DONE. Room roster on the server: first join claims a fresh room (creator = host, sets own keyword); host's start form registers every player's name + keyword (+ co-host flags). Auth failures are byte-identical ("Invalid login") whether the name exists or not. Host authority comes from the roster, never the client.
  - [x] Re-login from another device takes over your seat mid-hand (spec 8.2) — old connection gets a visible "You logged in on another device" screen and is closed; never two live connections per seat. Verified in E2E (0 post-kick leaks) + live in browser incl. the rejoin path.
  - [x] 2-minute disconnect grace (Step 7) — DONE. When a seated player's LAST connection drops mid-session, everyone sees a pulsing OFFLINE tag on their seat (derived from presence, no engine change); rejoin within grace cancels cleanly, stack intact; expiry sits them out via the engine (next deal — the action clock covers their current hand). Takeover kicks never trigger grace. Grace window overridable per session for tests (default 2 min). E2E: bot hard-disconnects at hand 7 → presence drops him → grace sits him out → game finishes without him.
- [x] **Server-owned clock** — DONE. Server arms one timer per turn (deadline + 750ms network grace), re-checks the engine before firing (time bank may have moved the deadline), and applies the engine's auto check/fold + consecutive-timeout sit-out. New `timeBank` message, actor-verified like `act`. State messages carry a server timestamp so client countdowns correct for phone clock skew — displays only, the server decides. E2E: silent bot auto-acted ✅, time bank extended deadline ✅, out-of-turn timeBank rejected ✅; verified live in-browser (server folded a passive client, then auto-sat it out after 2 timeouts).
- [x] **Rathole prevention (spec 3.5)** — DONE. Within a session it's structurally impossible (seats + stacks persist in the engine for the session's life, through disconnects/takeovers/sit-outs). The real hole was end→start in the same room: the server now records everyone's cash-out stack at session end and refuses any restart where a returning player buys in below `min(exitStack, maxBuyIn)`, naming the violator and the required floor. E2E: richest cash-out re-entering at the minimum is refused; compliant restart deals hand #1.
- [x] **Text chat** — DONE. Bubbles float above the sender's seat for ~4.5s (anchored by player id via `fromId` added to ChatEntry); a 💬 button with an unread dot opens a compact chat panel (list + input, server keeps last 50, history delivered on join). *Deviation from the letter of the spec, flagged:* chat lives in its own panel rather than interleaved into the dealer log strip — the dealer log has no timestamps so honest interleaving isn't possible, and the panel also works on phones where the log strip is hidden. E2E: live delivery with correct identity + history to a late joiner.
- [x] **Keep hot-seat mode** working as "local mode" — DONE, now **dev-only**: players see an online-only lobby; the hot-seat debug harness lives at `/?dev=local` (documented in CLAUDE.md). Same TableView, engine driven locally.
- [x] **Deploy** — DONE.
  - Frontend: **https://poker-hazel-tau.vercel.app** (Vercel, project `poker`). Redeploy: `npx vercel --prod --yes`.
  - Game server: **https://the-table.kabir31vazirani-f26.workers.dev** (Cloudflare Workers + Durable Objects, free tier). Redeploy: `npm run party:deploy`.
  - Wiring: Vercel env `NEXT_PUBLIC_PARTY_HOST=the-table.kabir31vazirani-f26.workers.dev` (production). Changing it requires a redeploy (baked at build).
  - Verified: full 12-scenario E2E passed against the deployed server over wss; deployed JS bundle confirmed to carry the prod host (and not the localhost default).
  - Deploy fixes along the way: workers-types pinned to v4 + npm override (partyserver/wrangler peer conflict); E2E queues sends until socket open (real-internet latency).

**Gate:** two browsers on two devices play a full session against each other, including one mid-hand disconnect + rejoin.

---

## PHASE 1B.2 — PERSISTENT OVERALL LEDGER

Move the overall (cross-session) ledger from localStorage to Supabase — shared and permanent. Sessions table + per-player net rows, written once when a session ends. Ask Kabir for Supabase credentials here; never hardcode keys, use env vars.

**Gate:** end a session on one device, see the updated overall ledger on another.

---

## PHASE 1C — SIT & GO MODE

Host chooses Cash or SNG in the lobby (spec 1.2). SNG: 100k fixed stacks, blinds start 1k/2k and **double after each elimination**, no rebuys, winner takes all. Host sets the ₹ value of the SNG before start — that value goes into the overall ledger (spec 3.6). Eliminated players become spectators.

**Gate:** full 4+ player SNG completes and the overall ledger reflects the host-set value correctly.

---

## PHASE 1D — DOUBLE FLOP TEX  *(unblocked — planning)*

Blocker resolved: `docs/double-flop-tex-answers.md` now exists with Parth's answers to the 7 open questions and the full ruleset. **That doc is the law for 1D — where it and any other doc disagree, it wins.**

Fully custom variant — use `pokersolver` for hand evaluation, build as a separate engine module behind a variant interface, and write a dedicated invariant test (like `test-engine.ts`) before wiring any UI.

**Run-it-twice is NOT part of 1D.** It was never specced for the two-board flip structure and is split out to its own later phase (see below).

**Gate:** new variant test passes 200+ random hands with chip conservation.

---

## PHASE 1F — RUN-IT-TWICE  *(deferred)*

Split out of 1D. Scoped to **normal Hold'em all-ins only** — not Double Flop Tex (whose Tex-flip structure already resolves all-in equity; RIT across two boards was never specced). Per-pot opt-out (spec 9.3). To be fully scoped when the phase starts.

---

## LATER — SHARED SESSIONCORE (tech debt)

Deferred by decision at the 1D kickoff: NLHE's `GameManager` and DFT's
`DoubleFlopManager` are separate classes that duplicate the session scaffolding
(ledger, sit-out, time bank, pause, rebuy, button rotation). We did NOT extract
a shared base up front, to avoid risking a regression in the deployed-but-not-
yet-gate-passed NLHE engine. Once both variants work and are gate-passed,
extract a shared `SessionCore` both engines build on, so ledger-conservation
logic lives in ONE place. Until then, `test-engine.ts` and `test-dft.ts`
independently guard each engine's chip conservation.

---

## PHASE 2 — 3D TABLE

react-three-fiber scene replacing the 2D table, reading the exact same `GameState`: oval table, free orbit camera, chat as speech bubbles above characters, character avatars per friend (art pipeline decided when we get here — ask Kabir). The 2D UI stays available as a fallback toggle.

**Gate:** full multiplayer session played entirely in 3D.

---

## Working rules

- Explain simply — Kabir is learning to code. When a decision isn't covered here, ask, don't assume.
- Push back on anything that conflicts with the architecture.
- No new dependencies without saying what and why first.
- Commit at logical checkpoints with clear messages; at each gate, remind Kabir to push.
