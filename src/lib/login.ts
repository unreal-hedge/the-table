// ============================================================
// Stored login (1E.4): a refresh mid-session rejoins the same room and
// seat without re-typing anything. Lives in localStorage for the life
// of the session; cleared when the player leaves the room or the
// session ends without a restart. (The keyword is a placeholder
// per-character word, not a real secret — Parth's spec.)
// ============================================================

import type { GameConfig, Variant } from "@/engine/types";

const KEY = "the-table-login";

export interface StoredLogin {
  room: string;
  myId: string;
  keyword: string;
  create?: { config: GameConfig; mode: Variant };
  at: number;
}

export function readStoredLogin(): StoredLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredLogin;
    if (!v || typeof v.room !== "string" || typeof v.myId !== "string" || typeof v.keyword !== "string") return null;
    return v;
  } catch { return null; }
}

export function storeLogin(login: Omit<StoredLogin, "at">): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...login, at: Date.now() })); } catch { /* private mode etc. */ }
}

export function clearStoredLogin(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
