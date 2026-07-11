"use client";
// Entry screen. Players only ever see the online room flow — the app
// is online-only for users. Local hot-seat (phase 1a) survives as our
// DEV-ONLY debug harness behind /?dev=local; it must never be visible
// in the normal flow. Also shows the overall (cross-session) ledger
// from localStorage until it moves to Supabase in phase 1b.2.

import { useEffect, useState } from "react";
import { GameConfig, SessionSummary } from "@/engine/types";
import { fmt } from "@/engine/manager";
import { GameSetupForm, SetupPlayer } from "./GameSetupForm";

const OVERALL_KEY = "poker-overall-ledger";

export function readOverall(): SessionSummary[] {
  try { return JSON.parse(localStorage.getItem(OVERALL_KEY) ?? "[]"); } catch { return []; }
}
export function appendOverall(s: SessionSummary) {
  localStorage.setItem(OVERALL_KEY, JSON.stringify([...readOverall(), s]));
}

interface Props {
  /** true only via /?dev=local — exposes the hot-seat debug harness */
  devLocal: boolean;
  onStartLocal: (config: GameConfig, players: SetupPlayer[]) => void;
  onJoinOnline: (room: string, myId: string, keyword: string) => void;
}

export function Lobby({ devLocal, onStartLocal, onJoinOnline }: Props) {
  const [tab, setTab] = useState<"local" | "online">("online");
  const [room, setRoom] = useState("");
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [overall, setOverall] = useState<Record<string, number>>({});

  useEffect(() => {
    const totals: Record<string, number> = {};
    for (const s of readOverall())
      for (const r of s.rows) totals[r.name] = (totals[r.name] ?? 0) + r.net;
    setOverall(totals);
  }, []);

  const joinValid =
    room.trim().length >= 2 && name.trim().length >= 2 && keyword.trim().length >= 2;
  const join = () =>
    onJoinOnline(
      room.trim().toLowerCase(),
      name.trim().toLowerCase(),
      keyword.trim().toLowerCase()
    );

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>The Table <span className="suit">♠</span></h1>
        <p className="sub">Private cash game · No-Limit Hold&apos;em · chips are points, settle up after</p>

        {devLocal && (
          <div className="mode-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "online"}
              className={`mode-tab${tab === "online" ? " active" : ""}`}
              onClick={() => setTab("online")}>
              Online room
            </button>
            <button role="tab" aria-selected={tab === "local"}
              className={`mode-tab${tab === "local" ? " active" : ""}`}
              onClick={() => setTab("local")}>
              Local hot-seat (dev)
            </button>
          </div>
        )}

        {devLocal && tab === "local" ? (
          <GameSetupForm submitLabel="Deal the first hand" idMode="auto"
            onSubmit={onStartLocal} />
        ) : (
          <>
            <h2>Join a room</h2>
            <div className="field-row">
              <div className="field"><label>Room name</label>
                <input type="text" placeholder="friday-night" value={room}
                  onChange={(e) => setRoom(e.target.value)} /></div>
              <div className="field"><label>Your name</label>
                <input type="text" placeholder="kabir" value={name}
                  onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label>Keyword</label>
                <input type="password" placeholder="secret word" value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && joinValid) join(); }} /></div>
            </div>
            <p className="form-hint">
              First person into a fresh room becomes host — their keyword is set
              by this login. Everyone else needs the name + keyword the host
              configured. Logging in from a new device takes your seat with you.
            </p>
            <button className="primary-btn" disabled={!joinValid} onClick={join}>
              Join room
            </button>
          </>
        )}

        {Object.keys(overall).length > 0 && (
          <div className="overall-ledger">
            <h2>Overall ledger (all sessions)</h2>
            {Object.entries(overall).sort((a, b) => b[1] - a[1]).map(([n, net]) => (
              <div className="row" key={n}>
                <span>{n}</span>
                <span className={`mono ${net > 0 ? "pos" : net < 0 ? "neg" : ""}`}>
                  {net > 0 ? "+" : ""}{fmt(net)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
