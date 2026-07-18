# Kabir — action list

Ordered. Do them top to bottom. Item 1 blocks everything else.

---

## 1. DEPLOY THE WORKER — nothing below works until you do this

The Cloudflare worker **does not auto-deploy.** Every commit since `b082c62`
that touches `party/` or `shared/` is pushed to `main` but **dormant** — the
live server is still running old code. The **frontend already auto-deployed**
those same pushes via Vercel, so **production is currently mismatched**: the live
client sends messages (seat requests, rebuy requests, CREATE/JOIN self-register,
restart) that the live server doesn't understand yet.

```
npm run party:deploy
```

**Commits waiting on that deploy (oldest → newest):**

| Commit | Item | Touches |
|---|---|---|
| `b7bf584` | Item 6 — two permanent admins (Parth + Kabir), identity-based host | party |
| `8925254` | Item 1 — busted → spectator + waiting reason + DFT dealer log | shared |
| `02b7557` | Item 2 — numbered seats + spectator seat requests | party + shared |
| `323f282` | Item 3 — player-initiated rebuy requests, admin-approved | party + shared |
| `0b09e0b` | Item 4 — stop / restart / deal-next (admin) | party + shared |
| `58094b4` | Item 5 — CREATE vs JOIN + self-registration | party |

`f76f6ad` (Item 7 — pot/stack legibility) is **frontend-only**; it's already live
via Vercel and needs no worker deploy.

After deploying, hard-refresh both phones so the client picks up the matching
build.

---

## 2. Give Parth a way to deploy the worker — so item 1 stops recurring

This keeps happening because the worker lives on **your** Cloudflare account and
Parth has no token. Every time Parth ships a `party/` or `shared/` change it sits
dormant until you personally run the deploy. Fix the process, pick one:

- **Preferred:** create a scoped **Cloudflare API token** (Workers Scripts:Edit +
  the Durable Objects the worker needs) and give it to Parth, so he can run
  `CLOUDFLARE_API_TOKEN=… npm run party:deploy` from his own machine / CI.
- **Or:** add Parth to the Cloudflare account/project with deploy rights.
- **Or (best long-term):** wire a GitHub Action that runs `party:deploy` on push
  to `main` when `party/**` or `shared/**` changed, using that token as a repo
  secret — then the worker auto-deploys like the frontend and this whole section
  disappears.

Until this is done, **every handoff has to re-flag "worker is dormant"** — it's
pure recurring tax.

---

## 3. The two unpassed playtest gates — two real phones, both of you

Neither the Hold'em nor the Double Flop multiplayer game has **ever** been played
by two humans. Everything is headless + wire-bot verified only. Do these **after
the deploy in item 1 is live.**

### 3A. 1B — Hold'em, two devices
A full NLHE session on two phones. Must include:
- [ ] Both join the same table from separate phones (one CREATE, one JOIN).
- [ ] A full hand to showdown with correct pot + payout.
- [ ] **One mid-hand disconnect + rejoin** (background one phone / drop wifi mid-hand, come back within the 2-min grace) — the seat is held and resumes.
- [ ] Device-takeover: log the same character in on a third device; the old one is kicked cleanly with the "logged in elsewhere" screen.
- [ ] Ledger nets to zero at the end.

### 3B. 1D — Double Flop Tex, two devices
A full DFT session on two phones. This is the mode that **broke on the first
all-in** before the lifecycle fixes — the point of this playtest is to confirm it
now **recovers**. Must include:
- [ ] Host CREATEs a DFT game; the other JOINs.
- [ ] A full bomb-pot hand: ante → three betting rounds → the **hand-split picker** (drag, 30s timer, irreversible accept) → **run/surrender modal** (blind) → **sequential flip reveal**.
- [ ] **Secrecy check:** while one player is picking / deciding, the other must **never** see their arrangement or run/surrender choice — only that they've "locked in." Try to peek; you should fail.
- [ ] **Bust someone out on an all-in** (the original failure). Confirm the busted player becomes a **spectator**, sees the "waiting for ≥2 players with chips" banner, and is **not** frozen behind an overlay.
- [ ] The busted player **requests a rebuy**; an **admin approves** it between hands; play resumes.
- [ ] The busted player (or a new spectator) **taps an empty numbered seat**, requests it, and an **admin re-seats** them (try accept, and try edit-stack-then-accept).
- [ ] **Restart** the table (admin): the old session settles into the ledger and a fresh game deals with the same crew, no one re-entering the room/keyword.

---

## 4. Eyeball the lifecycle UI — it shipped with NO visual QA

Items 1–7 were verified headless + over the wire + a clean build, and item 7's
font sizes were checked in a browser — but the **screenshot tool was down**, so
nobody has actually *looked* at the new surfaces as rendered. During the 3B
playtest, sanity-check these at **desktop and on the phone (375px)**:

- **Item 1 — waiting banner:** readable, centered, doesn't cover the whole table; spectators can still see the felt around it.
- **Item 2 — empty seats + admin request panel:** numbered seats render (NLHE 1–8 / DFT 1–7); "tap to sit" only shows for a spectator; the admin Requests panel's accept/reject/ignore/edit-stack buttons are reachable and don't overlap the table on mobile.
- **Item 3 — "Request chips" control:** visible to a seated player, opens the amount prompt; the admin sees the rebuy in the Requests panel.
- **Item 4 — Deal-next / Restart / End buttons:** present for admins in the side controls; the Restart confirm dialog reads clearly; **not** shown to non-admins.
- **Item 5 — CREATE vs JOIN lobby:** the two tabs switch; CREATE shows mode + blinds + starting stack, JOIN shows only character/table/keyword; both usable one-handed on a phone.
- **Item 7 — pot + stacks:** the pot is the biggest, most obvious number on the felt; every seated stack is legible across the table; for DFT the pot reads clearly between the two boards. (Confirmed numerically; confirm it *looks* right.)

Log anything ugly or broken back to Parth — visual polish that isn't a
correctness bug can fold into Phase 1E.

---

## 5. FYI — nothing to do, just know

- **Both DFT rule questions are ruled** (`docs/double-flop-tex-answers.md` →
  RULINGS): **R1** surrender = banker-only; **R2** flip ties = even split, no
  re-runs. No action — this is settled law now.
- **Step 6 (the DFT server seam) is done** — server hosts both engines,
  `filter.ts` enforces arrangement/declaration secrecy, the DFT UI exists. If any
  older note lists it as "next," that note is stale.
- **For Parth (engine owner), not you:** R1's enforcement (banker-only surrender)
  had to be added at `manager.declare()` — the answers doc's original "no code
  change needed" was inaccurate. Engine + doc now agree; just so he knows the
  enforcement point is in his layer.
