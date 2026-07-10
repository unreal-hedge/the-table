"use client";
import { useEffect, useState } from "react";
import { DEFAULT_CONFIG, GameConfig, SessionSummary } from "@/engine/types";
import { fmt } from "@/engine/manager";

export interface LobbyPlayer { id: string; name: string; buyIn: number }

interface Props { onStart: (config: GameConfig, players: LobbyPlayer[]) => void }

const OVERALL_KEY = "poker-overall-ledger";

export function readOverall(): SessionSummary[] {
  try { return JSON.parse(localStorage.getItem(OVERALL_KEY) ?? "[]"); } catch { return []; }
}
export function appendOverall(s: SessionSummary) {
  localStorage.setItem(OVERALL_KEY, JSON.stringify([...readOverall(), s]));
}

export function Lobby({ onStart }: Props) {
  const [cfg, setCfg] = useState<GameConfig>(DEFAULT_CONFIG);
  const [players, setPlayers] = useState<LobbyPlayer[]>([
    { id: "p1", name: "Kabir", buyIn: 1000 },
    { id: "p2", name: "Parth", buyIn: 1000 },
  ]);
  const [overall, setOverall] = useState<Record<string, number>>({});

  useEffect(() => {
    const totals: Record<string, number> = {};
    for (const s of readOverall())
      for (const r of s.rows) totals[r.name] = (totals[r.name] ?? 0) + r.net;
    setOverall(totals);
  }, []);

  const valid = players.length >= 2 && players.every((p) => p.name.trim() && p.buyIn >= cfg.minBuyIn && p.buyIn <= cfg.maxBuyIn);
  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>The Table <span className="suit">♠</span></h1>
        <p className="sub">Private cash game · No-Limit Hold&apos;em · chips are points, settle up after</p>

        <h2>Game settings</h2>
        <div className="field-row">
          <div className="field"><label>Small blind</label>
            <input type="number" value={cfg.smallBlind} onChange={(e) => setCfg({ ...cfg, smallBlind: num(e.target.value) })} /></div>
          <div className="field"><label>Big blind</label>
            <input type="number" value={cfg.bigBlind} onChange={(e) => setCfg({ ...cfg, bigBlind: num(e.target.value) })} /></div>
          <div className="field"><label>Min buy-in</label>
            <input type="number" value={cfg.minBuyIn} onChange={(e) => setCfg({ ...cfg, minBuyIn: num(e.target.value) })} /></div>
          <div className="field"><label>Max buy-in</label>
            <input type="number" value={cfg.maxBuyIn} onChange={(e) => setCfg({ ...cfg, maxBuyIn: num(e.target.value) })} /></div>
          <div className="field"><label>Seconds to act</label>
            <input type="number" value={cfg.actionTimeSec} onChange={(e) => setCfg({ ...cfg, actionTimeSec: Math.max(5, num(e.target.value)) })} /></div>
        </div>

        <h2>Players ({players.length}/8)</h2>
        {players.map((p, i) => (
          <div className="player-row" key={p.id}>
            <input type="text" placeholder={`Player ${i + 1}`} value={p.name}
              onChange={(e) => setPlayers(players.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x))} />
            <input className="buyin" type="number" value={p.buyIn} title="Buy-in"
              onChange={(e) => setPlayers(players.map((x) => x.id === p.id ? { ...x, buyIn: num(e.target.value) } : x))} />
            {players.length > 2 && (
              <button className="icon-btn" aria-label={`Remove ${p.name}`}
                onClick={() => setPlayers(players.filter((x) => x.id !== p.id))}>✕</button>
            )}
          </div>
        ))}
        {players.length < 8 && (
          <button className="ghost-btn"
            onClick={() => setPlayers([...players, { id: `p${Date.now()}`, name: "", buyIn: cfg.defaultBuyIn }])}>
            + Add player
          </button>
        )}

        <button className="primary-btn" disabled={!valid} onClick={() => onStart(cfg, players)}>
          Deal the first hand
        </button>

        {Object.keys(overall).length > 0 && (
          <div className="overall-ledger">
            <h2>Overall ledger (all sessions)</h2>
            {Object.entries(overall).sort((a, b) => b[1] - a[1]).map(([name, net]) => (
              <div className="row" key={name}>
                <span>{name}</span>
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
