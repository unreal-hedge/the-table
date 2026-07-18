"use client";
// ============================================================
// OnlineGame — multiplayer mode. Everything on screen is driven
// by server-pushed state via useRoom; this component sends small
// intent messages and renders what comes back.
//
// Explicit connection UX (Kabir's requirements):
//  - status pill (connected / reconnecting / disconnected) always visible
//  - "in room: [names]" presence line for two-device debugging
//  - a dropped connection shows a full veil — never a silent freeze
// ============================================================

import { useState } from "react";
import { useRoom, ConnectionStatus } from "@/hooks/use-room";
import { GameSetupForm } from "./GameSetupForm";
import { TableView } from "./TableView";
import { EndScreen } from "./EndScreen";

interface Props {
  room: string;
  myId: string;
  keyword: string;
  onExit: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "connecting…",
  connected: "connected",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
};
const STATUS_CLASS: Record<ConnectionStatus, string> = {
  connecting: "warn", connected: "ok", reconnecting: "warn", disconnected: "bad",
};

function ConnPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`conn-pill ${STATUS_CLASS[status]}`}>
      <span className="dot" />{STATUS_LABEL[status]}
    </span>
  );
}

export function OnlineGame({ room, myId, keyword, onExit }: Props) {
  const r = useRoom(room, myId, keyword);
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const isHost = r.isHost; // server-confirmed via the roster, never guessed
  const memberNames = r.members.map((m) => m.name).join(", ") || "just you";

  // ----- kicked: another device took this seat (spec 8.2) -----
  if (r.kicked) {
    return (
      <div className="lobby">
        <div className="lobby-card" style={{ textAlign: "center" }}>
          <h1>Signed out <span className="suit">♠</span></h1>
          <p className="sub" style={{ marginTop: 12 }}>
            You logged in on another device — this screen gave up your seat.
          </p>
          <button className="primary-btn" onClick={r.rejoin}>
            Log back in here instead
          </button>
          <button className="ghost-btn" style={{ marginTop: 12 }} onClick={onExit}>
            Leave
          </button>
        </div>
      </div>
    );
  }

  // ----- session over -----
  if (r.summary && !summaryDismissed) {
    return (
      <EndScreen summary={r.summary} backLabel="Back to room"
        onBack={() => setSummaryDismissed(true)} />
    );
  }

  // ----- waiting room (no game yet, or last one ended) -----
  const gameRunning = r.state != null && r.state.phase !== "ended";
  if (!gameRunning) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>The Table <span className="suit">♠</span></h1>
          <p className="sub">
            room <span className="mono">{room}</span> · you are <span className="mono">{myId}</span>
          </p>
          <div className="net-row">
            <ConnPill status={r.status} />
            <span className="room-line">in room: {memberNames}</span>
          </div>

          {isHost ? (
            <GameSetupForm submitLabel="Start the game" idMode="name"
              hostLogin={{ id: myId, keyword }}
              onSubmit={(config, players, gameMode) => {
                setSummaryDismissed(false);
                r.send.host({ kind: "start", config, players, gameMode });
              }} />
          ) : (
            <p className="waiting-note">Waiting for the host to start the game…</p>
          )}

          {r.lastError && <p className="form-hint error">{r.lastError}</p>}
          <button className="ghost-btn" style={{ marginTop: 18 }} onClick={onExit}>
            Leave room
          </button>
        </div>
      </div>
    );
  }

  // ----- live table -----
  const offline = r.status !== "connected";
  return (
    <TableView
      state={r.state!}
      mode="online"
      mySeat={r.mySeat}
      isHost={isHost}
      ledgerRows={r.ledger}
      clockOffsetMs={r.clockSkewMs}
      connectedIds={new Set(r.members.map((m) => m.id))}
      chat={r.chat}
      myId={myId}
      onChat={(text) => r.send.chat(text)}
      corner={
        <div className="net-corner">
          <ConnPill status={r.status} />
          <span className="room-line">in room: {memberNames}</span>
          {r.mySeat == null && (
            <span className="room-line spectate-note">
              watching as {myId} — not seated in this game
            </span>
          )}
        </div>
      }
      overlay={
        <>
          {r.lastError && <div className="err-toast">{r.lastError}</div>}
          {offline && (
            <div className="veil">
              <div>
                <div className="msg">
                  {r.status === "disconnected" ? "Disconnected" : "Reconnecting…"}
                </div>
                <div className="hint">
                  {r.status === "disconnected"
                    ? "Check your internet. We'll keep retrying — your seat is safe."
                    : "Connection dropped — trying to get you back to the table."}
                </div>
              </div>
            </div>
          )}
        </>
      }
      onAct={(a, amt) => r.send.act(a, amt)}
      onTimeBank={() => r.send.timeBank()} // server-verified; button live again (Step 6)
      onShow={() => r.send.show()}
      onPause={isHost ? () => r.send.host({ kind: "pause" }) : undefined}
      onEnd={isHost ? () => r.send.host({ kind: "end" }) : undefined}
      onSetMode={isHost ? (mode) => r.send.host({ kind: "setGameMode", mode }) : undefined}
      onSubmitArrangement={(order) => r.send.submitArrangement(order)}
      onDeclare={(potIndex, decision) => r.send.declare(potIndex, decision)}
      onAddChips={isHost ? (id, amt) => r.send.host({ kind: "addChips", playerId: id, amount: amt }) : undefined}
      onSitToggle={isHost ? (id, out) => r.send.host({ kind: "sitOut", playerId: id, out }) : undefined}
      onRequestSeat={(seat) => r.send.requestSeat(seat)}
      onSeatRequest={isHost ? (playerId, action, stack) => r.send.host({ kind: "seatRequest", playerId, action, stack }) : undefined}
    />
  );
}
