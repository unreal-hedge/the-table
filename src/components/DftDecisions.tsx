"use client";
// ============================================================
// DFT DECISIONS — the blind run/surrender call, PER POT (Part 3.4).
//
// After picking, each contested pot goes to a Tex flip. Before ANY flip
// card shows, every involved player makes a blind, binding call for EACH
// pot they're in — a player in a main pot and a side pot decides twice,
// independently, and may run one while surrendering the other.
//   RUN       — play the flip.
//   SURRENDER — banker-only (R1): only a player who already owns a banked
//               half may take 30% of the contested rest instead of flipping.
//               The engine lists who may (surrenderSeats); everyone else
//               only sees RUN.
// Blind + simultaneous: you never see another player's cards or choice,
// only WHO has locked. Binding: no take-backs. A seat that doesn't act by
// the shared 30s deadline auto-runs every pot it owes.
// ============================================================

import { DftDecision, DftView } from "@/engine/types";
import { potName } from "./Showdown";

interface Props {
  decisions: NonNullable<DftView["decisions"]>;
  potCount: number;              // how many pots exist this hand (names: main / side 1 …)
  mySeat: number | null;
  deadlineAt: number | null;
  displayNow: number;
  onDeclare: (potIndex: number, decision: DftDecision) => void;
}

const WINDOW_MS = 30_000;
const fmt = (n: number) => n.toLocaleString("en-IN");

export function DftDecisions({ decisions, potCount, mySeat, deadlineAt, displayNow, onDeclare }: Props) {
  const mine = mySeat == null ? [] : decisions.contests.filter((c) => c.seats.includes(mySeat));
  const declared = (potIndex: number) =>
    mySeat != null && decisions.lockedSeats.some((l) => l.potIndex === potIndex && l.seat === mySeat);
  const pending = mine.filter((c) => !declared(c.potIndex)).length;

  const timePct = deadlineAt ? Math.max(0, Math.min(1, (deadlineAt - displayNow) / WINDOW_MS)) : null;
  const secsLeft = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - displayNow) / 1000)) : null;

  return (
    <div className="dft-decide">
      <div className="dft-decide-card">
        <h3>Run or surrender</h3>
        <p className="hint">
          {mine.length > 1
            ? `You're in ${mine.length} pots — each is its own blind call.`
            : "Each board found a different winner — this pot goes to a Tex flip."}
          {" "}Decide before a single card shows.
        </p>

        {mine.map((c) => {
          const amBanker = mySeat != null && c.surrenderSeats.includes(mySeat);
          const banked = amBanker ? Math.floor(c.amount / 2) : 0;
          const contested = c.amount - banked;
          const done = declared(c.potIndex);
          return (
            <div key={c.potIndex} className={`dft-pot-call${done ? " done" : ""}`}>
              <div className="dft-pot-head">
                <span className="dft-pot-name">{potName(c.potIndex, potCount).replace(/^./, (m) => m.toUpperCase())}</span>
                <span className="dft-pot-amt">{fmt(c.amount)}</span>
              </div>
              <div className="dft-decide-stakes">
                {amBanker && (
                  <div className="dft-decide-banked"><span>Banked · yours</span><strong>{fmt(banked)}</strong></div>
                )}
                <div className="dft-decide-contested">
                  <span>{amBanker ? "Contested in the flip" : "Winner takes"}</span><strong>{fmt(contested)}</strong>
                </div>
              </div>
              {done ? (
                <div className="dft-pot-locked">Locked in <span className="tick">✓</span> · blind until the reveal</div>
              ) : (
                <div className="dft-pot-btns">
                  <button className="dft-run" onClick={() => onDeclare(c.potIndex, "run")}>Run the flip</button>
                  {amBanker ? (
                    <button className="dft-decide-surrender" onClick={() => onDeclare(c.potIndex, "surrender")}>
                      Surrender <small>keep {fmt(banked)} + 30% of {fmt(contested)}</small>
                    </button>
                  ) : (
                    <p className="dft-pick-warn">No banked share here, so surrender isn&apos;t offered — you must run.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {timePct != null && (
          <div className="dft-decide-timer">
            <div className={`dft-pick-fill${timePct < 0.25 ? " low" : ""}`} style={{ width: `${timePct * 100}%` }} />
          </div>
        )}
        {secsLeft != null && (
          <p className="dft-decide-clock">
            {secsLeft}s · binding, no take-backs{pending > 1 ? ` · ${pending} calls left` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
