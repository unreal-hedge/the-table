"use client";
// ============================================================
// Dialog — the in-app replacement for window.prompt / window.confirm
// (KABIR-TODO #6). One modal, two flavours:
//   confirm:  title + message + Confirm / Cancel
//   number:   the same, plus a chip-amount input (rebuy, edit stack)
// Enter confirms, Escape cancels, the input is focused on open. Styled
// like every other card on the table (dark plate, gold accents).
// ============================================================

import { useEffect, useRef, useState } from "react";

export interface DialogSpec {
  title: string;
  message?: string;
  /** Number prompt: shows a chip input pre-filled with `initial`. Confirm
   *  receives the value; it's refused while the value is outside min..max. */
  input?: { label: string; initial: number; min?: number; max?: number; step?: number };
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button — for destructive calls (restart / end). */
  danger?: boolean;
  onConfirm: (value?: number) => void;
}

interface Props {
  spec: DialogSpec;
  onClose: () => void; // called after confirm OR cancel
}

export function Dialog({ spec, onClose }: Props) {
  const [raw, setRaw] = useState(spec.input ? String(spec.input.initial) : "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    (spec.input ? inputRef.current : confirmRef.current)?.focus();
    inputRef.current?.select();
  }, [spec.input]);

  const value = spec.input ? Number(raw) : undefined;
  const valid = !spec.input || (
    Number.isFinite(value) && (value as number) > 0 &&
    (spec.input.min == null || (value as number) >= spec.input.min) &&
    (spec.input.max == null || (value as number) <= spec.input.max)
  );

  const confirm = () => {
    if (!valid) return;
    spec.onConfirm(spec.input ? Math.floor(value as number) : undefined);
    onClose();
  };

  return (
    <div className="dialog-veil" onClick={onClose} role="presentation">
      <div
        className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      >
        <h3 id="dialog-title">{spec.title}</h3>
        {spec.message && <p className="dialog-msg">{spec.message}</p>}
        {spec.input && (
          <label className="dialog-field">
            <span>{spec.input.label}</span>
            <input
              ref={inputRef} type="number" inputMode="numeric"
              min={spec.input.min} max={spec.input.max} step={spec.input.step ?? 50}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button className="dialog-btn ghost" onClick={onClose}>{spec.cancelLabel ?? "Cancel"}</button>
          <button
            ref={confirmRef}
            className={`dialog-btn${spec.danger ? " danger" : " primary"}`}
            disabled={!valid} onClick={confirm}
          >
            {spec.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
