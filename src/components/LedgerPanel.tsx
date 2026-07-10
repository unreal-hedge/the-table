"use client";
import { useState } from "react";
import { LedgerRow } from "@/engine/types";
import { fmt } from "@/engine/manager";

interface Props {
  rows: LedgerRow[];
  canEdit: boolean;              // rebuys apply between hands, host-approved
  maxBuyIn: number;
  onAddChips: (id: string, amount: number) => void;
  onSitToggle: (id: string, out: boolean) => void;
  sittingOut: Record<string, boolean>;
  onClose: () => void;
}

export function LedgerPanel({ rows, canEdit, maxBuyIn, onAddChips, onSitToggle, sittingOut, onClose }: Props) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return (
    <div className="panel">
      <button className="close" onClick={onClose} aria-label="Close">✕</button>
      <h3>Session ledger</h3>
      <table className="ledger-table">
        <thead>
          <tr><th>Player</th><th className="num">Bought in</th><th className="num">Stack</th><th className="num">Net</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="num">{fmt(r.buyInTotal)}</td>
              <td className="num">{fmt(r.stack)}</td>
              <td className={`num ${r.net > 0 ? "pos" : r.net < 0 ? "neg" : ""}`}>
                {r.net > 0 ? "+" : ""}{fmt(r.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit && (
        <div className="section">
          <h3>Rebuys (host approval — applied next hand)</h3>
          {rows.map((r) => (
            <div className="player-row" key={r.id}>
              <span style={{ flex: 1 }}>{r.name}</span>
              <input
                className="buyin" type="number" placeholder="chips"
                value={amounts[r.id] ?? ""}
                onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })}
                style={{ width: 100 }}
              />
              <button className="mini-btn" onClick={() => {
                const n = Number(amounts[r.id]);
                if (n > 0) { onAddChips(r.id, Math.min(n, maxBuyIn)); setAmounts({ ...amounts, [r.id]: "" }); }
              }}>Approve</button>
              <button className="mini-btn" onClick={() => onSitToggle(r.id, !sittingOut[r.id])}>
                {sittingOut[r.id] ? "Sit in" : "Sit out"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
