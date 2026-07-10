# The Table — Build Roadmap

> Login is keyword-based as of Step 5 (name + keyword per player, host-configured). One rule to know: **the first person into a fresh room becomes its host** — join your room before sharing the link, and re-claim it first if the server ever restarts.

The plan, phase by phase. **Every phase has a gate**: engine test passes (`npx tsx test-engine.ts`) + `npm run build` clean + Kabir playtests and says **"gate passed"** before the next phase starts. Never build two phases in one go. Checkboxes get updated as work lands.

Rules that never change (from CLAUDE.md):
- `src/engine/` stays UI-free — no React/DOM imports, ever.
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
  - [ ] 2-minute disconnect grace before a player counts as gone. *(Step 7)*
- [ ] **Server-owned clock** — server owns the 30s action clock + time bank; client countdowns are display only.
- [ ] **Rathole prevention (spec 3.5)** — leave and rejoin the same session → must re-enter with at least the stack you left with (capped at max buy-in).
- [ ] **Text chat** — simple room chat: small bubbles near the sender's seat for a few seconds + in the log strip. Keep last ~50 messages.
- [x] **Keep hot-seat mode** working as "local mode" — DONE (Local tab; same TableView, engine driven locally).
- [ ] **Deploy** — frontend on Vercel, server via PartyKit. Exact commands + walk Kabir through account setup (assume never done it).

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

## PHASE 1D — DOUBLE FLOP TEX + RUN-IT-TWICE  **[BLOCKED]**

Do NOT start until `docs/double-flop-tex-answers.md` exists with Parth's answers to the 7 open questions in PARTH-CONTEXT.md. If asked to start without that file, refuse and say what's missing.

When unblocked: fully custom variant — use `pokersolver` for hand evaluation, build as a separate engine module behind a variant interface, and write a dedicated invariant test (like `test-engine.ts`) before wiring any UI. Same for run-it-twice with per-pot opt-out (spec 9.3).

**Gate:** new variant test passes 200+ random hands with chip conservation.

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
