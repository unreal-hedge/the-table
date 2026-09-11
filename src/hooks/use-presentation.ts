"use client";
// ============================================================
// usePresentation — the table's sense of TIME (Part 3).
//
// The server sends instantaneous snapshots: a new hand arrives with every
// card already dealt, a street arrives fully revealed, a finished hand
// arrives already settled. This hook turns those jumps into a timeline the
// scene plays through:
//   - hole cards fly out of the dealer one at a time, rotating
//   - board cards land one at a time: Board A's, then Board B's; a turn or
//     river gets a beat; an all-in runout reveals one card, pauses, reveals
//   - a finished hand replays slowly: Board A → Board B → each flip →
//     outcomes → the pot sliding to the winner(s); stacks stay frozen at
//     their pre-settlement values until the pot has moved
// Pacing comes from shared/engine/timing.ts — the same numbers the server
// uses to hold the hand on the table, so the next deal never cuts it short.
//
// A viewer who joins mid-hand sees the current state at once (nothing to
// replay); only transitions we witnessed are animated.
// ============================================================

import { useEffect, useRef, useState } from "react";
import type { GameState, PotView } from "@/engine/types";
import { TIMING as T } from "@/engine/timing";

export type StepKind = "boardA" | "boardB" | "flip" | "outcome" | "reveal" | "foldwin" | "pot";
export interface Step { kind: StepKind; index: number; startAt: number; endAt: number }
export interface Flight { key: string; seat: number; at: number }
export interface Frozen { stacks: Map<number, number>; pot: number; pots: PotView[] }

export interface Presentation {
  dealt: Map<number, number> | null;          // seat → hole cards landed so far; null = show all
  flights: Flight[];                          // cards in the air right now
  boards: { a: number; b: number; c: number }; // cards revealed so far (c = Hold'em community)
  ready: boolean;                             // deal + reveals done → betting may open
  step: Step | null;                          // current showdown step
  stepElapsed: number;                        // ms into that step
  frozen: Frozen | null;                      // pre-settlement stacks/pot (until the pot moves)
  active: boolean;                            // something is animating
}

interface Reveal { board: "a" | "b" | "c"; index: number; at: number }
interface Timeline {
  hand: number;
  fresh: boolean;                 // we saw this hand from its first snapshot → animate it
  deal: { seat: number; idx: number; at: number }[];
  dealEnd: number;
  reveals: Reveal[];
  revealEnd: number;
  known: { a: number; b: number; c: number };
  steps: Step[];
  frozen: Frozen | null;
}

function blank(hand: number, fresh: boolean, now: number): Timeline {
  return { hand, fresh, deal: [], dealEnd: now, reveals: [], revealEnd: now, known: { a: 0, b: 0, c: 0 }, steps: [], frozen: null };
}

export function usePresentation(s: GameState): Presentation {
  const tlRef = useRef<Timeline | null>(null);
  const prevRef = useRef<GameState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ---- build / extend the timeline on every snapshot ----
  const tl = (() => {
    const t = Date.now();
    const prev = prevRef.current;
    let tl = tlRef.current;

    if (!tl || tl.hand !== s.handNumber) {
      // a new hand (or our first snapshot). Animate the deal only if we watched
      // it begin — either we saw the previous hand, or our very first snapshot
      // IS the start of a hand (flop just out, nobody has acted yet: the host
      // who just started the table, or a refresh that landed on a fresh deal).
      const atStart = s.phase === "inHand" && s.seats.every((x) => x.empty || x.lastAction == null) &&
        (s.variant === "dft" ? (s.dft?.boards.a.length ?? 0) <= 3 : s.communityCards.length === 0);
      const fresh = s.phase === "inHand" && (prev != null ? prev.handNumber !== s.handNumber : atStart);
      tl = blank(s.handNumber, fresh, t);
      if (fresh) {
        const seats = s.seats.filter((x) => !x.empty && x.inHand);
        const n = s.seats.length;
        const button = s.seats.find((x) => x.isButton)?.seat ?? -1;
        const order = [...seats].sort(
          (p, q) => ((p.seat - button - 1 + n) % n) - ((q.seat - button - 1 + n) % n)
        );
        const each = s.variant === "dft" ? 6 : 2;
        let k = 0;
        for (let idx = 0; idx < each; idx++) {
          for (const seat of order) {
            tl.deal.push({ seat: seat.seat, idx, at: t + k * T.dealCardMs });
            k++;
          }
        }
        tl.dealEnd = t + Math.max(0, k - 1) * T.dealCardMs + T.dealFlightMs;
        tl.revealEnd = tl.dealEnd;
      }
      tlRef.current = tl;
    }

    // board reveals: schedule whatever is new since the last snapshot
    const schedule = (board: "a" | "b" | "c", len: number) => {
      const known = tl!.known[board];
      if (len <= known) { if (len < known) tl!.known[board] = len; return; }
      if (!tl!.fresh) { tl!.known[board] = len; return; } // joined mid-hand: no replay
      const count = len - known;
      const base = Math.max(t, tl!.dealEnd, tl!.revealEnd);
      const flopN = known === 0 ? Math.min(3, count) : 0;
      let last = base;
      for (let i = 0; i < count; i++) {
        let at: number;
        if (i < flopN) at = base + i * T.boardCardMs;
        else if (count === 1) at = base + T.streetBeatMs;
        else at = base + flopN * T.boardCardMs + T.streetBeatMs + (i - flopN) * T.runoutCardMs;
        tl!.reveals.push({ board, index: known + i, at });
        last = at;
      }
      tl!.revealEnd = last + T.boardCardMs;
      tl!.known[board] = len;
    };
    if (s.variant === "dft" && s.dft) {
      schedule("a", s.dft.boards.a.length);
      schedule("b", s.dft.boards.b.length);
    } else {
      schedule("c", s.communityCards.length);
    }

    // the hand just ended: script the replay once — for EVERYONE who watched
    // any of it live (players, folded players, spectators who joined mid-hand)
    const watchedLive = prev != null && prev.handNumber === s.handNumber && prev.phase !== "handEnded";
    if (s.phase === "handEnded" && tl.steps.length === 0 && watchedLive) {
      let cursor = Math.max(t, tl.revealEnd, tl.dealEnd);
      const push = (kind: StepKind, index: number, ms: number) => {
        tl!.steps.push({ kind, index, startAt: cursor, endAt: cursor + ms });
        cursor += ms;
      };
      const showdown = s.variant === "dft"
        ? s.seats.some((x) => !x.empty && x.revealed)
        : (s.lastHandResult ?? []).some((r) => r.handName != null);
      if (s.variant === "dft" && s.dft && showdown) {
        push("boardA", 0, T.boardHoldMs);
        push("boardB", 0, T.boardHoldMs);
        s.dft.flips.forEach((_, i) => push("flip", i, T.flipMs));
        (s.dft.contests ?? []).forEach((c, i) => {
          const flipped = s.dft!.flips.some((f) => f.potIndex === c.potIndex && f.stage !== "representation");
          if (c.kind !== "whole" && !flipped) push("outcome", i, T.outcomeMs);
        });
      } else if (showdown) {
        push("reveal", 0, T.nlheRevealMs);
      } else {
        push("foldwin", 0, T.foldWinMs);
      }
      push("pot", 0, T.potMoveMs);
      // freeze the pre-settlement picture from the last live snapshot
      if (prev && (prev.phase === "inHand" || prev.phase === "paused") && prev.handNumber === s.handNumber) {
        const stacks = new Map<number, number>();
        for (const x of prev.seats) if (!x.empty) stacks.set(x.seat, x.stack + x.betSize);
        tl.frozen = { stacks, pot: prev.totalPot, pots: prev.pots };
      }
    }
    prevRef.current = s;
    return tl;
  })();

  // ---- tick while anything is in motion ----
  const potStep = tl.steps.find((st) => st.kind === "pot");
  const endOfMotion = Math.max(tl.dealEnd, tl.revealEnd, potStep?.endAt ?? 0);
  const active = now < endOfMotion;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 60);
    return () => clearInterval(id);
  }, [active, tl.hand]);

  // ---- derive the picture for `now` ----
  let dealt: Map<number, number> | null = null;
  const flights: Flight[] = [];
  if (tl.deal.length && now < tl.dealEnd) {
    dealt = new Map();
    for (const d of tl.deal) {
      if (d.at + T.dealFlightMs <= now) dealt.set(d.seat, (dealt.get(d.seat) ?? 0) + 1);
      else if (d.at <= now) flights.push({ key: `${d.seat}-${d.idx}`, seat: d.seat, at: d.at });
      else if (!dealt.has(d.seat)) dealt.set(d.seat, 0);
    }
  }
  const boards = { a: 0, b: 0, c: 0 };
  for (const r of tl.reveals) if (r.at <= now) boards[r.board] = Math.max(boards[r.board], r.index + 1);
  // anything not scheduled (joined mid-hand) shows in full
  const full = { a: s.dft?.boards.a.length ?? 0, b: s.dft?.boards.b.length ?? 0, c: s.communityCards.length };
  for (const k of ["a", "b", "c"] as const) {
    const scheduled = tl.reveals.filter((r) => r.board === k).length;
    if (scheduled === 0) boards[k] = full[k];
    else boards[k] = Math.min(full[k], boards[k]);
  }
  const step = tl.steps.find((st) => st.startAt <= now && now < st.endAt) ?? null;
  const frozen = tl.frozen && potStep && now < potStep.endAt ? tl.frozen : null;

  return {
    dealt, flights, boards,
    ready: now >= tl.dealEnd && now >= tl.revealEnd,
    step, stepElapsed: step ? now - step.startAt : 0,
    frozen, active,
  };
}
