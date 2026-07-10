"use client";
// Game settings + player list form, shared by the local (hot-seat)
// lobby and the online host's start screen. Pure form: collects a
// GameConfig and starting players, hands them to onSubmit.

import { useState } from "react";
import { DEFAULT_CONFIG, GameConfig } from "@/engine/types";

export interface SetupPlayer {
  id: string;
  name: string;
  buyIn: number;
  keyword?: string; // online: this player's login word (host distributes them)
  host?: boolean;   // online: co-host flag
}

interface Props {
  submitLabel: string;
  /** "auto": stable generated ids (hot-seat). "name": id = lowercased
   *  name — online friends log in by name + keyword, so the id must be
   *  guessable from the name. "name" mode also collects keywords. */
  idMode: "auto" | "name";
  onSubmit: (config: GameConfig, players: SetupPlayer[]) => void;
}

const MIN_KEYWORD_LENGTH = 2;

export function GameSetupForm({ submitLabel, idMode, onSubmit }: Props) {
  const [cfg, setCfg] = useState<GameConfig>(DEFAULT_CONFIG);
  const [players, setPlayers] = useState<SetupPlayer[]>([
    { id: "p1", name: "Kabir", buyIn: 1000, keyword: "", host: false },
    { id: "p2", name: "Parth", buyIn: 1000, keyword: "", host: false },
  ]);

  const num = (v: string) => Math.max(0, Number(v) || 0);
  const loginId = (name: string) => name.trim().toLowerCase();
  const online = idMode === "name";

  const names = players.map((p) => loginId(p.name));
  const hasDupes = online && new Set(names).size !== names.length;
  const keywordsOk =
    !online ||
    players.every((p) => (p.keyword ?? "").trim().length >= MIN_KEYWORD_LENGTH);
  const valid =
    players.length >= 2 &&
    players.every((p) => p.name.trim() && p.buyIn >= cfg.minBuyIn && p.buyIn <= cfg.maxBuyIn) &&
    !hasDupes &&
    keywordsOk;

  const patch = (id: string, part: Partial<SetupPlayer>) =>
    setPlayers(players.map((x) => (x.id === id ? { ...x, ...part } : x)));

  const submit = () => {
    const finalPlayers = online
      ? players.map((p) => ({
          ...p,
          id: loginId(p.name),
          keyword: (p.keyword ?? "").trim().toLowerCase(),
        }))
      : players;
    onSubmit(cfg, finalPlayers);
  };

  return (
    <>
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
            onChange={(e) => patch(p.id, { name: e.target.value })} />
          {online && (
            <input className="keyword" type="text" placeholder="keyword"
              value={p.keyword ?? ""} title="This player's login word"
              onChange={(e) => patch(p.id, { keyword: e.target.value })} />
          )}
          <input className="buyin" type="number" value={p.buyIn} title="Buy-in"
            onChange={(e) => patch(p.id, { buyIn: num(e.target.value) })} />
          {online && (
            <label className="cohost-toggle" title="Co-host: can pause, rebuy, end">
              <input type="checkbox" checked={!!p.host}
                onChange={(e) => patch(p.id, { host: e.target.checked })} />
              host
            </label>
          )}
          {players.length > 2 && (
            <button className="icon-btn" aria-label={`Remove ${p.name}`}
              onClick={() => setPlayers(players.filter((x) => x.id !== p.id))}>✕</button>
          )}
        </div>
      ))}
      {players.length < 8 && (
        <button className="ghost-btn"
          onClick={() => setPlayers([...players, { id: `p${Date.now()}`, name: "", buyIn: cfg.defaultBuyIn, keyword: "", host: false }])}>
          + Add player
        </button>
      )}
      {hasDupes && (
        <p className="form-hint">Two players can&apos;t share the same name — it&apos;s how they log in.</p>
      )}
      {online && !hasDupes && (
        <p className="form-hint">
          Each friend logs in with their name + keyword (min {MIN_KEYWORD_LENGTH} letters).
          Send everyone theirs privately. Your own row must match the login you used.
        </p>
      )}

      <button className="primary-btn" disabled={!valid} onClick={submit}>
        {submitLabel}
      </button>
    </>
  );
}
