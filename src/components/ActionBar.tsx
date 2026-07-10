"use client";
import { useEffect, useState } from "react";
import { GameState } from "@/engine/types";
import { fmt } from "@/engine/manager";

interface Props {
  state: GameState;
  onAct: (a: "fold" | "check" | "call" | "bet" | "raise", amount?: number) => void;
  onTimeBank: () => void;
}

export function ActionBar({ state: s, onAct, onTimeBank }: Props) {
  const legal = s.legalActions ?? [];
  const range = s.betRange;
  const [amount, setAmount] = useState(0);

  // reset slider whenever the turn changes
  useEffect(() => {
    if (range) setAmount(range.min);
  }, [s.playerToAct, s.round]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAct = s.phase === "inHand" && legal.length > 0;
  const aggr: "bet" | "raise" | null =
    legal.includes("raise") ? "raise" : legal.includes("bet") ? "bet" : null;
  const actorSeat = s.seats.find((x) => x.isTurn);
  const potPreset = Math.min(range?.max ?? 0, Math.max(range?.min ?? 0, s.totalPot));

  return (
    <div className="action-bar">
      <div className="ab-left">
        <button className="act-btn fold" disabled={!canAct || !legal.includes("fold")}
          onClick={() => onAct("fold")}>
          FOLD
        </button>
        <button className="act-btn" disabled={!canAct || !legal.includes("check")}
          onClick={() => onAct("check")}>
          CHECK
        </button>
        <button className="act-btn" disabled={!canAct || !legal.includes("call")}
          onClick={() => onAct("call")}>
          CALL
          {legal.includes("call") && <span className="amt">{fmt(s.callAmount)}</span>}
        </button>
      </div>

      <div className="ab-center">
        <LogStrip log={s.log} />
      </div>

      <div className="ab-right">
        <button className="timebank-btn" disabled={!canAct || !actorSeat || actorSeat.timeBank <= 0}
          onClick={onTimeBank} title="Use time bank">
          +{actorSeat?.timeBank ?? 0}s
        </button>
        {aggr && range && (
          <div className="raise-box">
            <input
              type="range" min={range.min} max={range.max}
              step={Math.max(1, s.config.smallBlind)}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Bet amount"
            />
            <div className="presets">
              <button onClick={() => setAmount(range.min)}>Min</button>
              <button onClick={() => setAmount(potPreset)}>Pot</button>
              <button onClick={() => setAmount(range.max)}>All-in</button>
            </div>
          </div>
        )}
        <button className="act-btn raise" disabled={!canAct || !aggr}
          onClick={() => aggr && onAct(aggr, Math.min(Math.max(amount, range?.min ?? 0), range?.max ?? 0))}>
          {aggr === "bet" ? "BET" : "RAISE"}
          {aggr && <span className="amt">{fmt(amount)}</span>}
        </button>
      </div>
    </div>
  );
}

function LogStrip({ log }: { log: string[] }) {
  return (
    <div className="log-strip" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
      {log.map((line, i) => (
        <div key={i} className={line.startsWith("—") ? "hand-mark" : ""}>{line}</div>
      ))}
    </div>
  );
}
