"use client";
// ============================================================
// DFT FLIP REVEAL — the sequential showdown payoff (Step 6b).
//
// At handEnded, state.dft.flips carries every flip that resolved this
// hand, in order (representation flips first, then the final flip). We
// walk them one at a time: show the tex hands that flipped, deal the
// fresh 5-card runout, then crown the winner + the chips it decided.
// After the last flip, a compact results card.
//
// The flips only ever arrive at handEnded (the engine hides them through
// the blind decisions phase), so nothing here can leak a live decision.
// ============================================================

import { useEffect, useState } from "react";
import { DftFlipView, HandResultShare } from "@/engine/types";
import { fmt } from "@/engine/manager";
import { CardFace } from "./CardFace";

// each flip holds the screen this long before the next; the server's
// hand-end pause is sized to cover the whole sequence (see server.ts).
const STEP_MS = 2400;

interface Props {
  flips: DftFlipView[];
  result: HandResultShare[];
  nameOf: (seat: number) => string;
}

function stageLabel(f: DftFlipView): string {
  if (f.stage === "representation") return `Board ${f.boardTag} flip`;
  if (f.stage === "final") return "Final flip";
  return "Guaranteed flip";
}

export function DftReveal({ flips, result, nameOf }: Props) {
  const [idx, setIdx] = useState(0); // 0..flips.length ; == flips.length -> results

  useEffect(() => {
    if (idx >= flips.length) return;
    const t = setTimeout(() => setIdx((i) => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [idx, flips.length]);

  const flip = idx < flips.length ? flips[idx] : null;

  return (
    <div className="dft-reveal">
      <div className="dft-reveal-card">
        {flip ? (
          <>
            <div className="dft-reveal-head">
              <span className="dft-reveal-stage">{stageLabel(flip)}</span>
              <span className="dft-reveal-count">Flip {idx + 1} / {flips.length}</span>
            </div>

            <div className="dft-reveal-hands">
              {flip.hands.map((h) => {
                const won = flip.winners.includes(h.seat);
                return (
                  <div key={h.seat} className={`dft-reveal-hand${won ? " won" : ""}`}>
                    <div className="dft-reveal-cards">
                      {h.tex.map((c, i) => <CardFace key={i} card={c} small />)}
                    </div>
                    <span className="dft-reveal-name">{nameOf(h.seat)}</span>
                  </div>
                );
              })}
            </div>

            {/* fresh runout, dealt card-by-card (staggered); key by idx so it
                re-animates for each flip */}
            <div className="dft-reveal-runout" key={idx}>
              {flip.runout.map((c, i) => (
                <div key={i} className="dft-reveal-run-card" style={{ animationDelay: `${i * 240}ms` }}>
                  <CardFace card={c} small />
                </div>
              ))}
            </div>

            <div className="dft-reveal-foot">
              {flip.winners.length > 1
                ? <>Chopped · {fmt(flip.amount)}</>
                : <><strong>{nameOf(flip.winners[0])}</strong> takes {fmt(flip.amount)}</>}
            </div>
          </>
        ) : (
          <>
            <h3>Hand complete <span className="tick">✓</span></h3>
            <div className="dft-reveal-results">
              {result.length === 0 ? (
                <p className="hint">Pot settled.</p>
              ) : (
                result.map((r) => (
                  <div key={r.seat} className="dft-reveal-result">
                    <span>{r.name}</span>
                    <strong>+{fmt(r.amountWon)}</strong>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
