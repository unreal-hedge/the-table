"use client";
import { SeatView } from "@/engine/types";
import { fmt } from "@/engine/manager";
import { CardFace } from "./CardFace";

interface Props {
  view: SeatView;
  x: number; y: number;          // % position on the scene
  betX: number; betY: number;    // % position of their bet chips
  timerPct: number | null;       // 0..1 remaining, only for the actor
  peeking: boolean;
  peekable?: boolean;            // hot-seat only; online has no peek flow
  offline?: boolean;             // online: no live connection (grace running)
  bubble?: string | null;        // recent chat line, floats above the seat
  onPeek: () => void;
  winBadge: string | null;       // "WINS 4,200" etc.
}

export function Seat({ view: v, x, y, betX, betY, timerPct, peeking, peekable = true, offline = false, bubble = null, onPeek, winBadge }: Props) {
  const showFaces = v.revealed || peeking;
  const badge = winBadge ?? v.lastAction;
  const badgeCls = winBadge ? "win" : v.folded ? "fold" : "";
  return (
    <>
      <div
        className={`seat${v.isTurn ? " turn" : ""}${v.folded ? " folded" : ""}${v.sittingOut ? " out" : ""}`}
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        {bubble && <div className="chat-bubble">{bubble}</div>}
        <div className="seat-cards">
          {/* online: server strips opponents' holeCards to null — still
              show backs, an in-hand player must LOOK in the hand */}
          {v.inHand && (v.holeCards
            ? v.holeCards.map((c, i) => <CardFace key={i} card={showFaces ? c : null} small />)
            : [0, 1].map((i) => <CardFace key={i} card={null} small />))}
        </div>
        <div className="plate">
          {badge && !v.sittingOut && <span className={`badge ${badgeCls}`}>{badge}</span>}
          <div className="name">
            {v.name}
            {offline && !v.sittingOut && <span className="offline-tag">offline</span>}
          </div>
          <div className="stack">{v.sittingOut ? "sitting out" : fmt(v.stack)}</div>
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
