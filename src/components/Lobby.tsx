"use client";
// Entry screen. Players only ever see the online room flow — the app
// is online-only for users. Local hot-seat (phase 1a) survives as our
// DEV-ONLY debug harness behind /?dev=local; it must never be visible
// in the normal flow. Also shows the overall (cross-session) ledger
// from localStorage until it moves to Supabase in phase 1b.2.

import { useEffect, useState } from "react";
import { DEFAULT_CONFIG, GameConfig, SessionSummary, Variant } from "@/engine/types";
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
  onCreateOnline: (room: string, myId: string, keyword: string, config: GameConfig, mode: Variant) => void;
}

export function Lobby({ devLocal, onStartLocal, onJoinOnline, onCreateOnline }: Props) {
  const [tab, setTab] = useState<"local" | "online">("online");
  const [entry, setEntry] = useState<"create" | "join">("join"); // item 5: two paths
  const [room, setRoom] = useState("");
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  // CREATE-only config
  const [mode, setMode] = useState<Variant>("nlhe");
  const [sb, setSb] = useState(100);
  const [bb, setBb] = useState(200);
  const [stack, setStack] = useState(2000);
  const [overall, setOverall] = useState<Record<string, number>>({});

  useEffect(() => {
    const totals: Record<string, number> = {};
    for (const s of readOverall())
      for (const r of s.rows) totals[r.name] = (totals[r.name] ?? 0) + r.net;
    setOverall(totals);
  }, []);

  const idsValid = room.trim().length >= 2 && name.trim().length >= 2 && keyword.trim().length >= 2;
  const joinValid = idsValid;
  const createValid = idsValid && sb > 0 && bb > 0 && stack > 0;
  const norm = () => [room.trim().toLowerCase(), name.trim().toLowerCase(), keyword.trim().toLowerCase()] as const;
  const join = () => { const [r, n, k] = norm(); onJoinOnline(r, n, k); };
  const create = () => {
    const [r, n, k] = norm();
    const config: GameConfig = {
      ...DEFAULT_CONFIG, smallBlind: sb, bigBlind: bb, defaultBuyIn: stack,
      minBuyIn: Math.min(DEFAULT_CONFIG.minBuyIn, stack), maxBuyIn: Math.max(DEFAULT_CONFIG.maxBuyIn, stack),
    };
    onCreateOnline(r, n, k, config, mode);
  };

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
            <div className="mode-tabs" role="tablist">
              <button role="tab" aria-selected={entry === "create"}
                className={`mode-tab${entry === "create" ? " active" : ""}`}
                onClick={() => setEntry("create")}>Create game</button>
              <button role="tab" aria-selected={entry === "join"}
                className={`mode-tab${entry === "join" ? " active" : ""}`}
                onClick={() => setEntry("join")}>Join game</button>
            </div>

            <div className="field-row">
              <div className="field"><label>Your character</label>
                <input type="text" placeholder="kabir" value={name}
                  onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label>Table name</label>
                <input type="text" placeholder="friday-night" value={room}
                  onChange={(e) => setRoom(e.target.value)} /></div>
              <div className="field"><label>Keyword</label>
                <input type="password" placeholder="secret word" value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (entry === "join" && joinValid) join(); else if (entry === "create" && createValid) create(); } }} /></div>
            </div>

            {entry === "create" ? (
              <>
                <h3>Game mode</h3>
                <div className="mode-tabs" role="tablist">
                  <button role="tab" aria-selected={mode === "nlhe"}
                    className={`mode-tab${mode === "nlhe" ? " active" : ""}`}
                    onClick={() => setMode("nlhe")}>No-Limit Hold&apos;em</button>
                  <button role="tab" aria-selected={mode === "dft"}
                    className={`mode-tab${mode === "dft" ? " active" : ""}`}
                    onClick={() => setMode("dft")}>Double Flop Tex</button>
                </div>
                <div className="field-row">
                  <div className="field"><label>Small blind</label>
                    <input type="number" value={sb} onChange={(e) => setSb(Math.max(0, Number(e.target.value) || 0))} /></div>
                  <div className="field"><label>Big blind</label>
                    <input type="number" value={bb} onChange={(e) => setBb(Math.max(0, Number(e.target.value) || 0))} /></div>
                  <div className="field"><label>Starting stack</label>
                    <input type="number" value={stack} onChange={(e) => setStack(Math.max(0, Number(e.target.value) || 0))} /></div>
                </div>
                <p className="form-hint">
                  You set the table up and take a seat first. Everyone else joins by
                  character + keyword and taps an empty seat — you approve them. Only
                  Parth &amp; Kabir can create a game.
                </p>
                <button className="primary-btn" disabled={!createValid} onClick={create}>Create game</button>
              </>
            ) : (
              <>
                <p className="form-hint">
                  Pick your character, the table name, and your keyword — nothing else.
                  If the table is full you&apos;ll spectate and can tap an empty seat to ask in.
                </p>
                <button className="primary-btn" disabled={!joinValid} onClick={join}>Join game</button>
              </>
            )}
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
