# Kabir — action list

Ordered. Do them top to bottom. **Item 1 still blocks everything else.**

---

## 1. THE WORKER DEPLOY IS STILL DORMANT — add the two CI secrets

> **CHECKED 2026-09-12 (Parth's readability session).** The "Deploy game server"
> Action has run **twice** (on `3206d9d` and `9838efa`) and **failed both times at
> the "Deploy to Cloudflare" step** — every gate before it (npm ci, test-engine,
> test-filter, party:check) went green. That is the missing-secrets signature:
> wrangler refuses to deploy non-interactively without `CLOUDFLARE_API_TOKEN`.
> The logs need repo-admin rights to read, so this is inferred from the step
> results, not the log text — but nothing else fails only at that step.
>
> **Consequence: the live worker is still on `22fbcf8` (Kabir's manual deploy).**
> Everything after it that touches `party/` or `shared/` is pushed but NOT LIVE,
> and the live Vercel client now sends messages the live server doesn't know
> (`draftArrangement`, `sitToggle`, the new `show` rule). **The live site will
> misbehave until the worker is deployed.** Dormant commits, oldest → newest:
>
> | Commit | What | Touches |
> |---|---|---|
> | `9838efa` | Hold'em → Double Flop switch fix (7-max guard) | party |
> | `2af7dad` | log-once for the parked table (#3) | shared |
> | `7a0637b` | live hand-split drafts (secret), hand stays on the table at handEnded, DFT badges/log/time bank | shared + party |
> | the "showdown pace + 1E engine" commit (see git log) | shared timing + hand-end hold, runout/contest summaries, inactivity sit-out (1E.1), self sit-toggle, SHOW HANDS (1E.7), Hold'em fold-win fix | shared + party |
>
> **Do one of:**
> - GitHub → Settings → Secrets and variables → Actions → add
>   `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers" template) and
>   `CLOUDFLARE_ACCOUNT_ID`, then re-run the failed "Deploy game server" run from
>   the Actions tab. **Permanent fix — Parth never needs Cloudflare access.**
> - or `npx wrangler login` + `npm run party:deploy` by hand (one-off).
>
> After deploying, hard-refresh both phones.

---

## 2. Your eight QA findings — status

| # | Finding | Status |
|---|---|---|
| 1 | 375px: 7-button admin column covers Seat 5 / clips Seat 4 | **Fixed** (`49ded1d`): one top-right "☰ Table" menu (sheet) + a pulsing "Requests N" pill for admins. |
| 2 | Requests panel sits on FOLD / CHECK / CALL | **Fixed** (`49ded1d`): requests live in the top-right sheet; the action bar is never covered. |
| 3 | Dealer-log spam "Waiting for at least 2 players…" | **Fixed** (`2af7dad`, both engines): logged once, on change. Headless test in `test-lifecycle.ts`. |
| 4 | Spectators see the disabled action bar | **Fixed** (`49ded1d`): unseated viewers get no bar (desktop: a slim dealer-log strip; phone: a "watching · tap an empty seat" note). |
| 5 | Lobby subtitle stale | **Fixed** (`49ded1d`): "Private poker · Hold'em & Double Flop Tex · chips are points, settle up after". |
| 6 | window.prompt / window.confirm | **Fixed** (`49ded1d`): in-app dialogs for Request chips, Edit stack, Edit rebuy, Restart, and End session. |
| 7 | "sitting out" while apparently dealt in after a Restart | **Investigated, not a restart bug.** The flag does NOT survive a restart (proven in `test-restart.ts`). What you saw: the clock sat the idle bot out AGAIN in the fresh session, and the engine flips `sittingOut` mid-hand ("takes effect next deal") while that hand's cards are still in front of them. Reproduced live in this session. **Replaced by 1E.1** (sit out only after two whole inactive hands) and the seat now shows "away · out next hand" instead of "sitting out" while the player is still in a hand. |
| 8 | Self-registration enables username enumeration | **Accepted for a private game**; HANDOFF's stale "no enumeration" claim corrected (`49ded1d`). |

---

## 3. What to test on two real phones (the readability pass)

Everything below is built and verified in a real browser (desktop + 375px) or
by DOM sampling of the live table, but **not yet played by two humans**. Test
against the LIVE site only **after item 1** — with the worker dormant, the live
client and server disagree.

### 3A. Reading your cards (Double Flop)
- [ ] Your six cards sit at the bottom in three labelled groups — **HAND A · TEX · HAND B** — from the moment they land. Never a loose row.
- [ ] Under Hand A / Hand B a live hand name ("Pair of Kings", "Flush, Queen high") that updates as the turn and river land. Nothing under Tex.
- [ ] Tap a card, tap another → they swap, anywhere across the three groups, any time until you lock. The names update instantly.
- [ ] Tapping a Hand A card makes **Board A glow** (amber); Hand B → Board B (sky).
- [ ] **Secrecy:** while one of you rearranges, the other's screen shows only your six backs — no grouping, no hint, no flicker. Try to peek. You should fail.
- [ ] Cards are big and the suits are unmistakable (four colours) on the phone.

### 3B. Following the hand
- [ ] New hand: cards fly from the dealer one at a time, rotating; then Board A's three land one by one, then Board B's; the action buttons only light up once both boards are fully up.
- [ ] Turn and river: a beat, then each board's card lands (A then B).
- [ ] All-in: the remaining cards come one at a time with a pause, never all at once.
- [ ] Picking phase: a timer bar + **LOCK IN** appear above your three hands (no modal). After locking: "Locked in ✓ · waiting for N/M". Locking is final.
- [ ] Run/surrender: one card per pot you're in, each with the pot's name and stake; RUN always; SURRENDER only when you own the banked half.

### 3C. The showdown (everyone watches — spectators too)
- [ ] **Board A** step (~3.5s): every involved Hand A, named; the winner highlighted; their five cards lifted (board + hole).
- [ ] **Board B** step, same.
- [ ] Each **flip** one at a time: who's flipping, their Tex hands, a fresh board dealt card by card, winner named. Smallest pot first.
- [ ] A surrender or a tied representation flip gets its own explanation card.
- [ ] The pot **slides to the winner** and only then do the stacks change.
- [ ] Hold'em: involved hands revealed + named, the winner's five lifted, the pot slides. Folded players get a **SHOW HANDS** button after the hand.

### 3D. Lifecycle (still the scenario that broke the first playtest)
- [ ] Bust someone out on an all-in → spectator → request chips / tap a seat → admin approves from the **Requests** pill → play resumes.
- [ ] **Restart** from the Table menu (in-app confirm) → settled ledger → fresh hand #1, same crew.
- [ ] Sit out only after **two whole hands** with no action; "I'm back — deal me in" from the Table menu brings you back.
- [ ] Refresh the phone mid-session → you're back at the table without re-typing anything. End the session → the next visit asks you to log in.
- [ ] You always see yourself at the bottom; the dealer button follows its seat.
- [ ] Bet slider steps in 50s; the minimum bet is still 200.

---

## 4. FYI — nothing to do, just know

- **Both DFT rule questions are ruled** (`docs/double-flop-tex-answers.md` → RULINGS): R1 surrender = banker-only; R2 flip ties = even split, no re-runs.
- **A pre-existing Hold'em bug was fixed in passing:** poker-ts ends a fold-win through its showdown path, and the engine used to mark the survivor's cards *revealed* and report no winner row (no "wins" badge, no log line). Fold-wins now keep the winner's cards hidden (they may SHOW) and report the pot. `test-lifecycle.ts` covers it.
- **The hand-end hold is now a shared contract** (`shared/engine/timing.ts`): the server holds a finished hand for exactly as long as the client's replay needs. Change the pace there, never in the server.
