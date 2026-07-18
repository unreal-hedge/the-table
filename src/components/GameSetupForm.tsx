"use client";
// Game settings + player list form, shared by the local (hot-seat)
// lobby and the online host's start screen. Pure form: collects a
// GameConfig and starting players, hands them to onSubmit.

import { useState } from "react";
import { DEFAULT_CONFIG, GameConfig, Variant } from "@/engine/types";

const DFT_MAX_SEATS = 7; // 7×6 hole + two 5-card boards = 52 exactly

export interface SetupPlayer {
  id: string;
  name: string;
  buyIn: number;
  keyword?: string; // online: this player's login word (host distributes them)
}

interface Props {
  submitLabel: string;
  /** "auto": stable generated ids (hot-seat). "name": id = lowercased
   *  name — online friends log in by name + keyword, so the id must be
   *  guessable from the name. "name" mode also collects keywords. */
  idMode: "auto" | "name";
  /** Online: the host's own login. Row 1 is locked to this name so the
   *  host can't start a game that doesn't include their own identity
   *  (which would make them a silent spectator of their own table). */
  hostLogin?: { id: string; keyword: string };
  onSubmit: (config: GameConfig, players: SetupPlayer[], gameMode: Variant) => void;
}

const MIN_KEYWORD_LENGTH = 2;

export function GameSetupForm({ submitLabel, idMode, hostLogin, onSubmit }: Props) {
  const [cfg, setCfg] = useState<GameConfig>(DEFAULT_CONFIG);
  const [gameMode, setGameMode] = useState<Variant>("nlhe"); // online host picks the variant
  const [players, setPlayers] = useState<SetupPlayer[]>(
    hostLogin
      ? [
          { id: "p1", name: hostLogin.id, buyIn: 1000, keyword: hostLogin.keyword },
          { id: "p2", name: "", buyIn: 1000, keyword: "" },
        ]
      : [
          { id: "p1", name: "Kabir", buyIn: 1000, keyword: "" },
          { id: "p2", name: "Parth", buyIn: 1000, keyword: "" },
        ]
  );

  const num = (v: string) => Math.max(0, Number(v) || 0);
  const loginId = (name: string) => name.trim().toLowerCase();
  const online = idMode === "name";
  const seatCap = gameMode === "dft" ? DFT_MAX_SEATS : 8;
  const overSeatCap = players.length > seatCap;

  const names = players.map((p) => loginId(p.name));
  const hasDupes = online && new Set(names).size !== names.length;
  const keywordsOk =
    !online ||
    players.every((p) => (p.keyword ?? "").trim().length >= MIN_KEYWORD_LENGTH);
  const valid =
    players.length >= 2 &&
    !overSeatCap &&
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
    onSubmit(cfg, finalPlayers, online ? gameMode : "nlhe");
  };

  return (
    <>
      {online && (
        <>
          <h2>Game mode</h2>
          <div className="mode-tabs" role="tablist">
            <button role="tab" aria-selected={gameMode === "nlhe"}
              className={`mode-tab${gameMode === "nlhe" ? " active" : ""}`}
              onClick={() => setGameMode("nlhe")}>
              No-Limit Hold&apos;em
            </button>
            <button role="tab" aria-selected={gameMode === "dft"}
              className={`mode-tab${gameMode === "dft" ? " active" : ""}`}
              onClick={() => setGameMode("dft")}>
              Double Flop Tex
            </button>
          </div>
          {gameMode === "dft" && (
            <p className="form-hint">
              Two boards, one pot · everyone antes 1 BB, no blinds · seats {DFT_MAX_SEATS} max.
            </p>
          )}
        </>
      )}

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

      <h2>Players ({players.length}/{seatCap})</h2>
      {players.map((p, i) => {
        const isLockedHostRow = !!hostLogin && i === 0;
        return (
          <div className="player-row" key={p.id}>
            <input type="text" placeholder={`Player ${i + 1}`} value={p.name}
              disabled={isLockedHostRow}
              title={isLockedHostRow ? "You — locked to your login name" : undefined}
              onChange={(e) => patch(p.id, { name: e.target.value })} />
            {online && (
              <input className="keyword" type="text" placeholder="keyword"
                value={p.keyword ?? ""} title="This player's login word"
                onChange={(e) => patch(p.id, { keyword: e.target.value })} />
            )}
            <input className="buyin" type="number" value={p.buyIn} title="Buy-in"
              onChange={(e) => patch(p.id, { buyIn: num(e.target.value) })} />
            {players.length > 2 && !isLockedHostRow && (
              <button className="icon-btn" aria-label={`Remove ${p.name}`}
                onClick={() => setPlayers(players.filter((x) => x.id !== p.id))}>✕</button>
            )}
          </div>
        );
      })}
      {players.length < seatCap && (
        <button className="ghost-btn"
          onClick={() => setPlayers([...players, { id: `p${Date.now()}`, name: "", buyIn: cfg.defaultBuyIn, keyword: "" }])}>
          + Add player
        </button>
      )}
      {overSeatCap && (
        <p className="form-hint error">Double Flop Tex seats {DFT_MAX_SEATS} max — remove a player.</p>
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
