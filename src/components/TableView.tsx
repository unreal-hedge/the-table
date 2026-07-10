"use client";
// ============================================================
// TableView — the poker scene, extracted from page.tsx so BOTH
// modes render the exact same table:
//   hotseat: driven by a local GameManager (LocalGame)
//   online:  driven by server-pushed GameState (OnlineGame)
// Pure renderer: everything it knows arrives via props.
// ============================================================

import { ReactNode, useEffect, useState } from "react";
import { fmt } from "@/engine/manager";
import { GameState, LedgerRow, PlayerAction } from "@/engine/types";
import { Seat } from "./Seat";
import { CardFace } from "./CardFace";
import { ActionBar } from "./ActionBar";
import { LedgerPanel } from "./LedgerPanel";

// seat positions: ellipse in scene %, seat 0 at the bottom, clockwise
function seatPos(i: number, n: number) {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n; // start bottom
  const x = 50 + 34 * Math.cos(angle);
  const y = 44 + 30 * Math.sin(angle);
  const bx = 50 + 20 * Math.cos(angle);
  const by = 45 + 16 * Math.sin(angle);
  return { x, y, bx, by };
}

interface Props {
  state: GameState;
  mode: "hotseat" | "online";
  mySeat?: number | null;        // online: which seat is me
  isHost: boolean;               // pause/end controls + ledger editing
  ledgerRows: LedgerRow[];
  corner?: ReactNode;            // online: connection pill + room line
  overlay?: ReactNode;           // online: disconnect veil / error toast
  onAct: (a: PlayerAction, amount?: number) => void;
  onTimeBank?: () => void;       // absent → button hidden (server clock lands in Step 6)
  onShow: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onAddChips?: (id: string, amount: number) => void;
  onSitToggle?: (id: string, out: boolean) => void;
}

export function TableView({
  state: s, mode, mySeat = null, isHost, ledgerRows, corner, overlay,
  onAct, onTimeBank, onShow, onPause, onEnd, onAddChips, onSitToggle,
}: Props) {
  const [showLedger, setShowLedger] = useState(false);
  const [peekSeat, setPeekSeat] = useState<number | null>(null);

  // display-only countdown tick (timeout decisions live elsewhere:
  // hotseat → LocalGame's loop; online → the server, Step 6)
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const n = s.seats.length;
  const timerPct = s.turnDeadlineAt && s.turnStartedAt
    ? Math.max(0, (s.turnDeadlineAt - Date.now()) / (s.turnDeadlineAt - s.turnStartedAt))
    : null;
  const winBySeat = new Map(
    (s.phase === "handEnded" ? s.lastHandResult ?? [] : []).map((r) => [
      r.seat,
      `WINS ${fmt(r.amountWon)}${r.handName ? " · " + r.handName.toUpperCase() : ""}`,
    ])
  );
  const sittingOut: Record<string, boolean> = {};
  for (const seat of s.seats) sittingOut[seat.id] = seat.sittingOut;

  const myTurn = mode === "hotseat" || (mySeat != null && s.playerToAct === mySeat);
  const canShow = mode === "hotseat"
    ? s.canShowSeat != null
    : s.canShowSeat != null && s.canShowSeat === mySeat;

  return (
    <div className="scene">
      <div className="title-corner">The Table <span className="suit">♠</span></div>
      <div className="blind-corner mono">
        blinds {fmt(s.config.smallBlind)}/{fmt(s.config.bigBlind)} · hand #{s.handNumber}
      </div>
      {corner}

      <div className="side-controls">
        {isHost && onPause && (
          <button onClick={onPause}>{s.phase === "paused" ? "Resume" : "Pause"}</button>
        )}
        <button onClick={() => setShowLedger(true)}>Ledger</button>
        {isHost && onEnd && <button onClick={onEnd}>End session</button>}
      </div>

      <div className="table-wrap">
        <div className="felt" />
        <div className="table-brand">The Table</div>
        {s.round && <div className="round-tag">{s.round}</div>}
        <div className="board">
          {s.communityCards.map((c, i) => <CardFace key={i} card={c} />)}
        </div>
        {s.totalPot > 0 && <div className="pot-line">POT {fmt(s.totalPot)}</div>}
      </div>

      {s.seats.map((v, i) => {
        const p = seatPos(i, n);
        const peeking = mode === "online" ? v.seat === mySeat : peekSeat === v.seat;
        return (
          <Seat key={v.id} view={v}
            x={p.x} y={p.y} betX={p.bx} betY={p.by}
            timerPct={v.isTurn ? timerPct : null}
            peeking={peeking}
            peekable={mode === "hotseat"}
            onPeek={() => setPeekSeat(peekSeat === v.seat ? null : v.seat)}
            winBadge={winBySeat.get(v.seat) ?? null}
          />
        );
      })}

      {canShow && (
        <div className="side-controls" style={{ top: "auto", bottom: 130 }}>
          <button onClick={onShow}>Show winning cards</button>
        </div>
      )}

      <ActionBar state={s} enabled={myTurn}
        onAct={(a, amt) => { onAct(a, amt); setPeekSeat(null); }}
        onTimeBank={onTimeBank}
      />

      {s.phase === "paused" && (
        <div className="veil">
          <div>
            <div className="msg">Paused</div>
            <div className="hint">Clock is frozen. Host resumes from the top-right.</div>
          </div>
        </div>
      )}

      {showLedger && (
        <LedgerPanel rows={ledgerRows}
          canEdit={isHost && !!onAddChips} maxBuyIn={s.config.maxBuyIn}
          onAddChips={(id, amt) => onAddChips?.(id, amt)}
          onSitToggle={(id, out) => onSitToggle?.(id, out)}
          sittingOut={sittingOut}
          onClose={() => setShowLedger(false)}
        />
      )}

      {overlay}
    </div>
  );
}
