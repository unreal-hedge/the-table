"use client";
// Session-over screen: final ledger table, sorted by net.
import { fmt } from "@/engine/manager";
import { SessionSummary } from "@/engine/types";

interface Props {
  summary: SessionSummary;
  backLabel: string;
  onBack: () => void;
}

export function EndScreen({ summary, backLabel, onBack }: Props) {
  return (
    <div className="end-wrap">
      <div className="end-card">
        <h1>Session over</h1>
        <p className="sub" style={{ color: "var(--muted)", marginBottom: 20 }}>
          {summary.handsPlayed} hands played · saved to the overall ledger
        </p>
        <table className="ledger-table">
          <thead>
            <tr><th>Player</th><th className="num">Bought in</th><th className="num">Final stack</th><th className="num">Net</th></tr>
          </thead>
          <tbody>
            {[...summary.rows].sort((a, b) => b.net - a.net).map((r) => (
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
        <button className="primary-btn" onClick={onBack}>{backLabel}</button>
      </div>
    </div>
  );
}
