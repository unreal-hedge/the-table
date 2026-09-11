"use client";
// ============================================================
// HandDock — YOUR six Double Flop cards, always in three labelled hands
// (readability 2.2–2.4). Never a loose row:
//
//        HAND A          TEX           HAND B
//    (plays Board A)  (flip hand)  (plays Board B)
//
// - Live naming: under Hand A/B, what it makes against its board right
//   now ("Pair of Kings"), updating as the turn and river land. Tex has
//   no board, so nothing under it until a flip.
// - Live rearranging: tap a card, tap another, they swap — any time from
//   the deal until you LOCK. Every change is sent as a DRAFT (the server
//   keeps it privately so a timeout locks what you see; nobody else ever
//   receives it). During the picking phase the dock grows a timer + LOCK.
// - Tapping a group lights up the board it plays (onFocusBoard).
// This component only ever renders the viewer's own cards.
// ============================================================

import { ReactNode, useEffect, useState } from "react";
import { Card, DftView } from "@/engine/types";
import { CardFace } from "./CardFace";
import { labelHand } from "@/lib/handLabel";

export const DEFAULT_ORDER = [0, 1, 2, 3, 4, 5];
const PICK_WINDOW_MS = 30_000;

// order positions: [0,1] = Hand A, [2,3] = Hand B, [4,5] = Tex (engine contract)
const GROUPS: { key: "a" | "tex" | "b"; label: string; sub: string; pos: [number, number] }[] = [
  { key: "a", label: "Hand A", sub: "plays Board A", pos: [0, 1] },
  { key: "tex", label: "Tex", sub: "flip hand", pos: [4, 5] },
  { key: "b", label: "Hand B", sub: "plays Board B", pos: [2, 3] },
];

interface Props {
  handNumber: number;
  holeCards: Card[];               // my six, dealt order
  serverOrder: number[] | null;    // the engine's copy of my split (seeds a hand; authoritative once locked)
  boards: DftView["boards"];
  editable: boolean;               // may rearrange right now
  locked: boolean;                 // my split is locked (picking lock or later)
  /** picking phase details when I'm one of the pickers */
  picking: { deadlineAt: number | null; displayNow: number; lockedCount: number; total: number } | null;
  visibleCount?: number;           // deal animation: how many of my cards have arrived (default all)
  free?: boolean;                  // no action bar below → dock sits on the bottom edge
  onDraft: (order: number[]) => void;
  onLock?: () => void;
  onFocusBoard?: (board: "a" | "b" | null) => void;
  children?: ReactNode;            // my seat plate (name / stack / clock), rendered under the cards
}

export function HandDock({
  handNumber, holeCards, serverOrder, boards, editable, locked, picking,
  visibleCount = 6, free = false, onDraft, onLock, onFocusBoard, children,
}: Props) {
  const [order, setOrder] = useState<number[]>(serverOrder ?? DEFAULT_ORDER);
  const [sel, setSel] = useState<number | null>(null);

  // a new hand resets the split to whatever the server dealt us (the default,
  // or a draft restored after a refresh); never re-seed mid-hand — the local
  // order is ahead of the server copy by at most one message
  useEffect(() => {
    setOrder(serverOrder ?? DEFAULT_ORDER);
    setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handNumber]);

  useEffect(() => { if (!editable) setSel(null); }, [editable]);

  const shown = locked && serverOrder ? serverOrder : order;
  const cardAt = (pos: number): Card | null => {
    const idx = shown[pos];
    return idx < visibleCount ? holeCards[idx] ?? null : null;
  };
  const complete = visibleCount >= 6;

  const tap = (pos: number) => {
    if (!editable) return;
    if (sel === null) {
      setSel(pos);
      onFocusBoard?.(groupOf(pos));
      return;
    }
    if (sel === pos) { setSel(null); onFocusBoard?.(null); return; }
    const next = [...order];
    [next[sel], next[pos]] = [next[pos], next[sel]];
    setOrder(next);
    setSel(null);
    onFocusBoard?.(null);
    onDraft(next);
  };

  const nameFor = (g: (typeof GROUPS)[number]): string | null => {
    if (g.key === "tex" || !complete) return null;
    const board = g.key === "a" ? boards.a : boards.b;
    if (board.length < 3) return null;
    const hole = [cardAt(g.pos[0]), cardAt(g.pos[1])].filter((c): c is Card => !!c);
    if (hole.length < 2) return null;
    return labelHand(hole, board)?.name ?? null;
  };

  const timePct = picking?.deadlineAt
    ? Math.max(0, Math.min(1, (picking.deadlineAt - picking.displayNow) / PICK_WINDOW_MS))
    : null;
  const secsLeft = picking?.deadlineAt ? Math.max(0, Math.ceil((picking.deadlineAt - picking.displayNow) / 1000)) : null;

  return (
    <div className={`hand-dock${free ? " free" : ""}${picking ? " picking" : ""}`}>
      {picking && (
        <div className="dock-pick">
          {locked ? (
            <div className="dock-locked">Locked in ✓ · waiting for {picking.lockedCount}/{picking.total}</div>
          ) : (
            <>
              <div className="dock-pick-row">
                <div className="dock-timer">
                  <div className={`dock-timer-fill${timePct != null && timePct < 0.25 ? " low" : ""}`}
                    style={{ width: `${(timePct ?? 0) * 100}%` }} />
                </div>
                <button className="dock-lock" onClick={onLock}>
                  Lock in{secsLeft != null ? ` · ${secsLeft}s` : ""}
                </button>
              </div>
              <div className="dock-hint">Tap two cards to swap. Locking is final.</div>
            </>
          )}
        </div>
      )}
      <div className="dock-groups">
        {GROUPS.map((g) => {
          const name = nameFor(g);
          const selectedHere = sel !== null && g.pos.includes(sel);
          return (
            <div key={g.key} className={`dock-group ${g.key}${selectedHere ? " active" : ""}`}>
              <div className="dock-label">{g.label}</div>
              <div className="dock-cards">
                {g.pos.map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    className={`dock-cell${sel === pos ? " selected" : ""}`}
                    disabled={!editable}
                    onClick={() => tap(pos)}
                    aria-label={`${g.label} card ${g.pos.indexOf(pos) + 1}`}
                  >
                    <CardFace card={cardAt(pos)} size="lg" delay={cardAt(pos) ? shown[pos] * 60 : 0} />
                  </button>
                ))}
              </div>
              <div className={`dock-name${name ? "" : " empty"}`}>{name ?? g.sub}</div>
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

function groupOf(pos: number): "a" | "b" | null {
  if (pos === 0 || pos === 1) return "a";
  if (pos === 2 || pos === 3) return "b";
  return null;
}
