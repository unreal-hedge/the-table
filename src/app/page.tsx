"use client";
import { useEffect, useRef, useState } from "react";
import { GameManager, fmt } from "@/engine/manager";
import { GameConfig, SessionSummary } from "@/engine/types";
import { Lobby, LobbyPlayer, appendOverall } from "@/components/Lobby";
import { Seat } from "@/components/Seat";
import { CardFace } from "@/components/CardFace";
import { ActionBar } from "@/components/ActionBar";
import { LedgerPanel } from "@/components/LedgerPanel";

// seat positions: ellipse in scene %, seat 0 at the bottom, clockwise
function seatPos(i: number, n: number) {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n; // start bottom
  const x = 50 + 34 * Math.cos(angle);
  const y = 44 + 30 * Math.sin(angle);
  const bx = 50 + 20 * Math.cos(angle);
  const by = 45 + 16 * Math.sin(angle);
  return { x, y, bx, by };
}

export default function Home() {
  const gmRef = useRef<GameManager | null>(null);
  const [, force] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [peekSeat, setPeekSeat] = useState<number | null>(null);
  const lastHandled = useRef(-1);

  const rerender = () => force((n) => n + 1);

  // game clock: drives the visible countdown, timeouts, and auto-next-hand
  useEffect(() => {
    const t = setInterval(() => {
      const gm = gmRef.current;
      if (!gm) return;
      const s = gm.state();
      if (s.phase === "inHand" && s.turnDeadlineAt && Date.now() > s.turnDeadlineAt) {
        gm.timeout();
      }
      if (s.phase === "handEnded" && lastHandled.current !== s.handNumber) {
        lastHandled.current = s.handNumber;
        setTimeout(() => {
          const g = gmRef.current;
          if (g && g.state().phase === "handEnded") { g.dealNextHand(); rerender(); }
        }, 4200);
      }
      rerender();
    }, 200);
    return () => clearInterval(t);
  }, []);

  const start = (config: GameConfig, players: LobbyPlayer[]) => {
    gmRef.current = new GameManager(config, players);
    gmRef.current.start();
    lastHandled.current = -1;
    setSummary(null);
    rerender();
  };

  const gm = gmRef.current;
  if (summary) return <EndScreen summary={summary} onLobby={() => { gmRef.current = null; setSummary(null); }} />;
  if (!gm) return <Lobby onStart={start} />;

  const s = gm.state();
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

  return (
    <div className="scene">
      <div className="title-corner">The Table <span className="suit">♠</span></div>
      <div className="blind-corner mono">
        blinds {fmt(s.config.smallBlind)}/{fmt(s.config.bigBlind)} · hand #{s.handNumber}
      </div>

      <div className="side-controls">
        <button onClick={() => { gm.togglePause(); rerender(); }}>
          {s.phase === "paused" ? "Resume" : "Pause"}
        </button>
        <button onClick={() => setShowLedger(true)}>Ledger</button>
        <button onClick={() => {
          const sum = gm.stop();
          appendOverall(sum);
          setSummary(sum);
        }}>End session</button>
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
        return (
          <Seat key={v.id} view={v}
            x={p.x} y={p.y} betX={p.bx} betY={p.by}
            timerPct={v.isTurn ? timerPct : null}
            peeking={peekSeat === v.seat}
            onPeek={() => setPeekSeat(peekSeat === v.seat ? null : v.seat)}
            winBadge={winBySeat.get(v.seat) ?? null}
          />
        );
      })}

      {s.canShowSeat != null && (
        <div className="side-controls" style={{ top: "auto", bottom: 130 }}>
          <button onClick={() => { gm.voluntaryShow(s.canShowSeat!); rerender(); }}>
            Show winning cards
          </button>
        </div>
      )}

      <ActionBar state={s}
        onAct={(a, amt) => { gm.act(a, amt); setPeekSeat(null); rerender(); }}
        onTimeBank={() => { gm.useTimeBank(); rerender(); }}
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
        <LedgerPanel rows={gm.ledger()}
          canEdit maxBuyIn={s.config.maxBuyIn}
          onAddChips={(id, amt) => { gm.approveAddChips(id, amt); rerender(); }}
          onSitToggle={(id, out) => { gm.toggleSitOut(id, out); rerender(); }}
          sittingOut={sittingOut}
          onClose={() => setShowLedger(false)}
        />
      )}
    </div>
  );
}

function EndScreen({ summary, onLobby }: { summary: SessionSummary; onLobby: () => void }) {
  return (
    <div className="end-wrap">
      <div className="end-card">
        <h1>Session over</h1>
        <p className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
          {summary.handsPlayed} hands played · saved to the overall ledger
        </p>
        <table className="ledger-table">
          <thead>
            <tr><th>Player</th><th className="num">Bought in</th><th className="num">Final stack</th><th className="num">Net</th></tr>
          </thead>
          <tbody>
            {[...summary.rows].sort((a, b) => b.net - a.net).map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{fmt(r.buyInTotal)}</td>
                <td className="num">{fmt(r.stack)}</td>
                <td className={`num ${r.net > 0 ? "pos" : r.net < 0 ? "neg" : ""}`}>
                  {r.net > 0 ? "+" : ""}{fmt(r.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="primary-btn" onClick={onLobby}>Back to lobby</button>
      </div>
    </div>
  );
}
