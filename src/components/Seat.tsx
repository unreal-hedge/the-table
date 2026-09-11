"use client";
import { Card, SeatView } from "@/engine/types";
import { fmt } from "@/engine/manager";
import { CardFace, CardSize } from "./CardFace";
import type { SeatFrame } from "./Showdown";
import { cardKey } from "@/lib/handLabel";

interface Props {
  view: SeatView;
  x?: number; y?: number;        // % position on the scene (absent = render inline, e.g. inside the dock)
  timerPct: number | null;       // 0..1 remaining, only for the actor
  peeking: boolean;
  peekable?: boolean;            // hot-seat only; online has no peek flow
  offline?: boolean;             // online: no live connection (grace running)
  bubble?: string | null;        // recent chat line, floats above the seat
  backCount?: number;            // hidden-card count for opponents (2 NLHE, 6 DFT)
  cardSize?: CardSize;           // xs for opponents, md for your own NLHE cards
  hideCards?: boolean;           // the dock renders this seat's cards instead
  visibleCards?: number;         // deal animation: how many cards have arrived so far
  top?: boolean;                 // seat on the top rail: cards hang below the plate
  fan?: boolean;                 // hidden cards stack into a tight fan (6 backs in one row)
  phone?: boolean;               // compact reveal (only the hand in play)
  frame?: SeatFrame;             // showdown step: which hand is live, what won, which cards lift
  canRequest?: boolean;          // spectator may tap this empty seat to request it (item 2)
  onRequestSeat?: () => void;
  onPeek: () => void;
  winBadge: string | null;       // "WINS 4,200" etc.
}

const GROUPS: { key: "a" | "tex" | "b"; label: string; pos: [number, number] }[] = [
  { key: "a", label: "A", pos: [0, 1] },
  { key: "tex", label: "Tex", pos: [4, 5] },
  { key: "b", label: "B", pos: [2, 3] },
];

export function Seat({
  view: v, x, y, timerPct, peeking, peekable = true, offline = false, bubble = null,
  backCount = 2, cardSize = "xs", hideCards = false, visibleCards, top = false, fan = false,
  phone = false, frame, canRequest = false, onRequestSeat, onPeek, winBadge,
}: Props) {
  const pos = x != null && y != null ? { left: `${x}%`, top: `${y}%` } : undefined;
  const inline = pos === undefined;
  // Empty numbered slot (item 2): a spectator can tap it to ask for the seat.
  if (v.empty) {
    return (
      <div
        className={`seat empty${canRequest ? " requestable" : ""}`}
        style={pos}
        onClick={canRequest ? onRequestSeat : undefined}
      >
        <div className="empty-plate">
          <div className="seat-num">Seat {v.seat + 1}</div>
          {canRequest && <div className="sit-hint">tap to sit</div>}
        </div>
      </div>
    );
  }
  const showFaces = v.revealed || peeking;
  const badge = winBadge ?? v.lastAction;
  const badgeCls = winBadge ? "win" : v.folded ? "fold" : "";
  const total = v.holeCards ? v.holeCards.length : backCount;
  const count = Math.min(total, visibleCards ?? total);
  // a revealed Double Flop seat shows its three hands (the public split)
  // (on a phone only while a showdown step names the hand in play — otherwise a fan)
  const grouped = showFaces && v.holeCards && v.holeCards.length === 6 && v.arrangement && v.arrangement.length === 6 && (!phone || !!frame);

  const renderCards = () => {
    if (grouped) {
      const h = v.holeCards!;
      const o = v.arrangement!;
      const active = frame?.active ?? null;
      const groups = phone && active ? GROUPS.filter((g) => g.key === active) : GROUPS;
      return (
        <div className="seat-groups">
          {groups.map((g) => {
            const cards: Card[] = [h[o[g.pos[0]]], h[o[g.pos[1]]]];
            const isActive = active == null || active === g.key;
            return (
              <div key={g.key} className={`seat-group ${g.key}${isActive ? " active" : ""}`}>
                <span className="g-label">{g.label}</span>
                <span className="g-cards">
                  {cards.map((c, i) => (
                    <CardFace key={i} card={c} size="xs" lift={!!frame && isActive && frame.used.has(cardKey(c))} />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className={`seat-cards${fan && (!showFaces || phone) ? " fan" : ""}`}>
        {/* online: server strips opponents' holeCards to null — still
            show backs, an in-hand player must LOOK in the hand */}
        {(v.inHand || (v.revealed && v.holeCards)) && Array.from({ length: count }, (_, i) => {
          const c = showFaces && v.holeCards ? v.holeCards[i] : null;
          return (
            <CardFace key={i} card={c} size={cardSize} delay={i * 40}
              lift={!!c && !!frame && frame.used.has(cardKey(c))}
              dim={!!c && !!frame && frame.won && frame.used.size > 0 && !frame.used.has(cardKey(c))} />
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`seat${inline ? " inline" : ""}${top ? " top" : ""}${v.isTurn ? " turn" : ""}${v.folded ? " folded" : ""}${v.sittingOut ? " out" : ""}${frame?.won ? " won" : ""}`}
      style={pos}
    >
      {bubble && <div className="chat-bubble">{bubble}</div>}
      {!hideCards && renderCards()}
      {!hideCards && frame?.label && <div className="seat-hand-name">{frame.label}</div>}
      <div className="plate">
        {badge && !v.sittingOut && <span className={`badge ${badgeCls}`}>{badge}</span>}
        <div className="name">
          {v.name}
          {offline && !v.sittingOut && <span className="offline-tag">offline</span>}
        </div>
        <div className="stack">{v.sittingOut && !v.inHand ? "sitting out" : fmt(v.stack)}</div>
        {v.sittingOut && v.inHand && <div className="away-tag">away · out next hand</div>}
        {v.isTurn && timerPct != null && (
          <div className="timer-track">
            <div
              className={`timer-fill${timerPct < 0.25 ? " low" : ""}`}
              style={{ width: `${timerPct * 100}%` }}
            />
          </div>
        )}
      </div>
      {peekable && v.isTurn && v.inHand && !v.revealed && (
        <button className="peek-btn" onClick={onPeek}>
          {peeking ? "hide cards" : "peek at cards"}
        </button>
      )}
    </div>
  );
}

/** The chips in front of a seat + the dealer button — positioned separately
 *  from the seat box so the dock seat gets them too. */
export function SeatExtras({ view: v, betX, betY }: { view: SeatView; betX: number; betY: number }) {
  if (v.empty) return null;
  return (
    <>
      {v.betSize > 0 && (
        <div className="bet-chip" style={{ left: `${betX}%`, top: `${betY}%` }}>
          {fmt(v.betSize)}
        </div>
      )}
      {v.isButton && (
        <div className="dealer-chip" style={{ left: `${betX - 3.5}%`, top: `${betY + 3}%` }}>
          D
        </div>
      )}
    </>
  );
}
