"use client";
// ============================================================
// DFT DECISIONS MODAL — the blind run/surrender call (Step 6b).
//
// After picking, a contested pot goes to a Tex flip. Before ANY flip
// card shows, each involved player makes a blind, binding call:
//   RUN      — play the flip.
//   SURRENDER — banker-only (R1): take a guaranteed 30% of the contested
//               half instead of flipping. Offered ONLY to seats the engine
//               lists in surrenderSeats (a player who owns a banked share);
//               everyone else must run.
//
// Blind + simultaneous: you never see another player's cards or choice,
// only WHO has locked. Binding: no take-backs (the server rejects a second
// declare). A seat that doesn't act by the shared 30s deadline auto-runs.
// ============================================================

import { DftDecision, DftView } from "@/engine/types";

interface Props {
  decisions: NonNullable<DftView["decisions"]>;
  mySeat: number | null;
  deadlineAt: number | null;
  displayNow: number;
  onDeclare: (potIndex: number, decision: DftDecision) => void;
}

const WINDOW_MS = 30_000;
const fmt = (n: number) => n.toLocaleString("en-IN");

export function DftDecisions({ decisions, mySeat, deadlineAt, displayNow, onDeclare }: Props) {
  const declaredFor = (potIndex: number) =>
    mySeat != null && decisions.lockedSeats.some((l) => l.potIndex === potIndex && l.seat === mySeat);

  const myContests = mySeat == null ? [] : decisions.contests.filter((c) => c.seats.includes(mySeat));
  const pending = myContests.find((c) => !declaredFor(c.potIndex));

  const timePct = deadlineAt ? Math.max(0, Math.min(1, (deadlineAt - displayNow) / WINDOW_MS)) : null;
  const secsLeft = deadlineAt ? Math.max(0, Math.ceil((deadlineAt - displayNow) / 1000)) : null;
  const lockedCount = decisions.lockedSeats.length;
  const owedCount = decisions.contests.reduce((n, c) => n + c.seats.length, 0);

  const Timer = () =>
    timePct == null ? null : (
      <div className="dft-decide-timer">
        <div className={`dft-pick-fill${timePct < 0.25 ? " low" : ""}`} style={{ width: `${timePct * 100}%` }} />
      </div>
    );

  // ---- not my call, or I've answered every pot: neutral wait ----
  if (!pending) {
    const iOwed = myContests.length > 0;
    return (
      <div className="dft-decide">
        <div className="dft-decide-card">
          <h3>{iOwed ? <>Locked in <span className="tick">✓</span></> : "Run or surrender"}</h3>
          <p className="hint">
            {iOwed
              ? "Your call is in — blind until the reveal."
              : "The contesting players are making their blind run/surrender calls."}
            {" "}{lockedCount}/{owedCount} locked.
          </p>
          <Timer />
        </div>
      </div>
    );
  }

  // ---- my call for `pending` ----
  const amBanker = mySeat != null && pending.surrenderSeats.includes(mySeat);
  const banked = amBanker ? Math.floor(pending.amount / 2) : 0;
  const contested = pending.amount - banked;

  return (
    <div className="dft-decide">
      <div className="dft-decide-card">
        <h3>Board split</h3>
        <p className="hint">
          Each board found a different winner — this pot goes to a Tex flip.
          Decide blind, before a single card shows.
        </p>

        <div className="dft-decide-stakes">
          {amBanker && (
            <div className="dft-decide-banked">
              <span>Banked, safe</span>
              <strong>{fmt(banked)}</strong>
            </div>
          )}
          <div className="dft-decide-contested">
            <span>{amBanker ? "Contested in the flip" : "Winner takes"}</span>
            <strong>{fmt(contested)}</strong>
          </div>
        </div>

        <button className="primary-btn" onClick={() => onDeclare(pending.potIndex, "run")}>
          Run the flip
        </button>

        {amBanker ? (
          <>
            <button className="dft-decide-surrender" onClick={() => onDeclare(pending.potIndex, "surrender")}>
              Surrender
            </button>
            <p className="dft-pick-warn">Surrender: keep your banked {fmt(banked)} and take 30% of the {fmt(contested)} — no flip.</p>
          </>
        ) : (
          <p className="dft-pick-warn">You hold no banked share, so surrender isn’t offered — you must run.</p>
        )}

        <Timer />
        {secsLeft != null && <p className="dft-decide-clock">{secsLeft}s · binding, no take-backs</p>}
      </div>
    </div>
  );
}
