"use client";
// ============================================================
// Sheet — a dismissible panel anchored to the top-right corner: a
// drop-down on desktop, a top sheet on phones. Used for the compact
// table menu (KABIR-TODO #1) and the admin Requests queue (#2), so
// neither ever sits on top of a seat or the action bar. Tapping the
// veil or ✕ closes it; the action bar stays reachable below it.
// ============================================================

import { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ title, onClose, children }: Props) {
  return (
    <div className="sheet-veil" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>{title}</span>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
