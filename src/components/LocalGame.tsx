"use client";
// ============================================================
// LocalGame — hot-seat mode, our debug harness. Owns a local
// GameManager and drives it exactly as page.tsx did in phase 1a:
// a 200ms loop fires timeouts and auto-deals the next hand.
// Renders the shared TableView.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { GameManager } from "@/engine/manager";
import { GameConfig, SessionSummary } from "@/engine/types";
import { SetupPlayer } from "./GameSetupForm";
import { TableView } from "./TableView";
import { EndScreen } from "./EndScreen";
import { appendOverall } from "./Lobby";

const HAND_END_PAUSE_MS = 4200;
const TICK_MS = 200;

interface Props {
  config: GameConfig;
  players: SetupPlayer[];
  onExit: () => void;
}

export function LocalGame({ config, players, onExit }: Props) {
  const gmRef = useRef<GameManager | null>(null);
  if (!gmRef.current) {
    gmRef.current = new GameManager(config, players);
    gmRef.current.start();
  }
  const gm = gmRef.current;

  const [, force] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const lastHandled = useRef(-1);
  const rerender = () => force((n) => n + 1);

  // game clock: timeouts + auto-next-hand (display countdown lives in TableView)
  useEffect(() => {
    const t = setInterval(() => {
      const s = gm.state();
      if (s.phase === "inHand" && s.turnDeadlineAt && Date.now() > s.turnDeadlineAt) {
        gm.timeout();
      }
      if (s.phase === "handEnded" && lastHandled.current !== s.handNumber) {
        lastHandled.current = s.handNumber;
        setTimeout(() => {
          if (gm.state().phase === "handEnded") { gm.dealNextHand(); rerender(); }
        }, HAND_END_PAUSE_MS);
      }
      rerender();
    }, TICK_MS);
    return () => clearInterval(t);
  }, [gm]);

  if (summary) {
    return <EndScreen summary={summary} backLabel="Back to lobby" onBack={onExit} />;
  }

  const s = gm.state();
  return (
    <TableView
      state={s}
      mode="hotseat"
      isHost
      ledgerRows={gm.ledger()}
      onAct={(a, amt) => { gm.act(a, amt); rerender(); }}
      onTimeBank={() => { gm.useTimeBank(); rerender(); }}
      onShow={() => { if (s.canShowSeat != null) gm.voluntaryShow(s.canShowSeat); rerender(); }}
      onPause={() => { gm.togglePause(); rerender(); }}
      onEnd={() => {
        const sum = gm.stop();
        appendOverall(sum);
        setSummary(sum);
      }}
      onAddChips={(id, amt) => { gm.approveAddChips(id, amt); rerender(); }}
      onSitToggle={(id, out) => { gm.toggleSitOut(id, out); rerender(); }}
    />
  );
}
