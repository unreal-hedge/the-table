# Phase 1E — Fixes & Polish

Runs **after** Phase 1D. Do not mix with variant work — these are separate
concerns and must be separate commits.

---

## 1. Sit-out timer (replaces "2 consecutive timeouts")

**Current:** a player is sat out after 2 consecutive timeouts.

**Wanted:** a player is sat out only after being **completely inactive** — no
fold, check, call, raise, or time-bank use — for **two entire hands**.

Any action of any kind resets the counter. **Time-bank usage counts as
activity.**

---

## 2. Bet slider increment

Slider steps in **50s**, not 100s.

- Minimum bet stays **200**.
- Blinds stay **100/200**.

This is a precision change only, not a structural one.

---

## 3. Host privileges — Parth and Kabir only

The home screen shows all characters. A player **selects their character**,
enters the **table code**, and enters their **private keyword**.

**Only the players logged in as PARTH and KABIR get host/admin privileges** —
regardless of who created the room or started the game.

Host status is derived from **character identity**, never from room-creation
order.

Keywords are per-character. Simple placeholders for now; individualised later.

---

## 4. Rejoin after refresh

Login persists for the **duration of a session** (localStorage). Refreshing the
page rejoins the same seat automatically without re-entering game details.

**When a session ends, the stored login is cleared.** Every new session
requires a fresh login.

---

## 5. Rejoin after elimination — cash game only (not SNG)

An eliminated player may request an empty seat. The request goes to the host,
who may:

- **ACCEPT**
- **REJECT**
- **IGNORE**
- **EDIT STACK** → then accept

An **ignored** request persists and may be accepted after the current game ends
and a new one begins on the same table.

In SNG, elimination is permanent (winner takes all) — rejoin does not apply.

---

## 6. POV rotation

Every player sees **themselves at the bottom** of the table. Seating order
rotates around the viewer.

Relative seat order and dealer button position must remain correct after
rotation.

---

## 7. Showdown reveal

- All players **involved in the final betting** have their hands revealed
  **automatically**.
- Any player **not involved** (folded) gets a **SHOW HANDS** button, available
  **only after showdown**, to voluntarily reveal.
- The **winning 5-card hand must be visually highlighted** — the exact cards
  used (from board + hole) lift or glow.
- The hand must be **named** (e.g. "Flush, King high").

---

## 8. Dealing animation

- The **dealer sits at the centre** of the table and distributes.
- Hole cards dealt **one at a time** to each player, in rotation.
- Flop cards revealed **one at a time**, not as a block.
- Turn and river revealed individually, with a beat between them.
- **All-in runout:** reveal turn → pause ~1s → reveal river. **Never dump both
  at once.**

---

## 9. Visual redesign

- Poker table felt: **red**.
- Card faces redesigned — new art direction, decide with Kabir.
