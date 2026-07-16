"use client";
// ============================================================
// DFT PICKING PANEL — the hand-split screen (Step 6b).
//
// You hold six cards; you split them into three hands:
//   HAND A → plays Board A      HAND B → plays Board B
//   TEX    → your flip hand (heads-up / representation flips)
//
// Mobile-first: TAP-TO-SWAP, not drag. Tap one card, tap another,
// they swap. The split is pre-filled with the default (1-2 / 3-4 /
// 5-6) so a player can just LOCK. Locking is irreversible and the
// choice is blind — the server never reveals your split to anyone
// until everyone has locked (or the 30s window times out).
//
// This component only ever shows/edits YOUR OWN cards. Opponents'
// cards arrive stripped (filter.ts); we render backs for them
// elsewhere. If you're not in this showdown (folded / spectator),
// you get the neutral "others are choosing" wait state.
// ============================================================

import { useState } from "react";
import { Card, DftView } from "@/engine/types";
import { CardFace } from "./CardFace";

interface Props {
  holeCards: Card[] | null;      // YOUR six cards (dealt order 0..5)
  boards: DftView["boards"];     // both boards, revealed cards only
  picking: NonNullable<DftView["picking"]>;
  mySeat: number | null;
  initialOrder: number[] | null; // your current locked/default split order
  deadlineAt: number | null;
  displayNow: number;            // Date.now() + clockOffsetMs (server-true)
  onSubmit: (order: number[]) => void;
}

// slot layout: order positions [0,1]=Hand A, [2,3]=Hand B, [4,5]=Tex
const GROUPS: { label: string; board: "a" | "b" | null; pos: [number, number] }[] = [
  { label: "Hand A", board: "a", pos: [0, 1] },
  { label: "Hand B", board: "b", pos: [2, 3] },
  { label: "Tex", board: null, pos: [4, 5] },
];
const WINDOW_MS = 30_000;

export function DftPicking({
  holeCards, boards, picking, mySeat, initialOrder, deadlineAt, displayNow, onSubmit,
}: Props) {
  const amPicker = mySeat != null && picking.seats.includes(mySeat);
  const locked = mySeat != null && picking.lockedSeats.includes(mySeat);
  const lockedCount = picking.lockedSeats.length;
  const total = picking.seats.length;

  const [order, setOrder] = useState<number[]>(initialOrder ?? [0, 1, 2, 3, 4, 5]);
  const [sel, setSel] = useState<number | null>(null);

  const timePct = deadlineAt ? Math.max(0, Math.min(1, (deadlineAt - displayNow) / WINDOW_MS)) : null;
  const secsLeft = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - displayNow) / 1000)) : null;

  // ---- not my decision: neutral wait state ----
  if (!amPicker) {
    return (
      <div className="dft-pick">
        <div className="dft-pick-card">
          <h3>Choosing hands</h3>
          <p className="hint">Players are splitting their six cards. {lockedCount}/{total} locked.</p>
        </div>
      </div>
    );
  }

  // ---- locked in: irreversible, now waiting on the rest ----
  if (locked) {
    return (
      <div className="dft-pick">
        <div className="dft-pick-card">
          <h3>Split locked <span className="tick">✓</span></h3>
          <p className="hint">Waiting for the table — {lockedCount}/{total} locked.</p>
          {timePct != null && (
            <div className="dft-pick-timer"><div className="dft-pick-fill" style={{ width: `${timePct * 100}%` }} /></div>
          )}
        </div>
      </div>
    );
  }

  const tapSlot = (pos: number) => {
    if (sel === null) { setSel(pos); return; }
    if (sel === pos) { setSel(null); return; }
    setOrder((o) => {
      const n = [...o];
      [n[sel], n[pos]] = [n[pos], n[sel]];
      return n;
    });
    setSel(null);
  };

  const cards = holeCards ?? [];

  return (
    <div className="dft-pick">
      <div className="dft-pick-card">
        <h3>Split your six cards</h3>
        <p className="hint">Tap two cards to swap them. Hand A plays Board A, Hand B plays Board B, Tex is your flip hand.</p>

        {GROUPS.map((g) => (
          <div className="dft-pick-group" key={g.label}>
            <div className="dft-pick-row">
              <span className="dft-pick-label">{g.label}</span>
              <div className="dft-pick-slot">
                {g.pos.map((pos) => (
                  <button
                    key={pos}
                    className={`dft-pick-cell${sel === pos ? " selected" : ""}`}
                    onClick={() => tapSlot(pos)}
                    aria-label={`Card ${pos + 1} in ${g.label}`}
                  >
                    <CardFace card={cards[order[pos]] ?? null} small />
                  </button>
                ))}
              </div>
            </div>
            {g.board && (
              <div className="dft-pick-board">
                {boards[g.board].map((c, i) => <CardFace key={i} card={c} small />)}
              </div>
            )}
          </div>
        ))}

        {timePct != null && (
          <div className="dft-pick-timer">
            <div className={`dft-pick-fill${timePct < 0.25 ? " low" : ""}`} style={{ width: `${timePct * 100}%` }} />
          </div>
        )}

        <button className="primary-btn" onClick={() => onSubmit(order)}>
          Lock in split{secsLeft != null ? ` · ${secsLeft}s` : ""}
        </button>
        <p className="dft-pick-warn">Locking is final — you can’t change your split after this.</p>
      </div>
    </div>
  );
}
