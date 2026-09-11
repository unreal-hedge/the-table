"use client";
// ============================================================
// Showdown — the slow, sequential replay everyone watches (Part 3.3).
//
// buildFrame() turns (state, step) into ONE description the whole scene
// shares: what the panel says, which board is live, which five cards lift,
// what each seat shows. TableView uses it for the felt + seats; the panel
// below renders the narrative. Nobody skips: spectators and folded players
// get the same frames.
//
// Double Flop:  BOARD A (every involved Hand A, winner named, its five lifted)
//               BOARD B (same)  →  each FLIP, one at a time, smallest pot
//               first (Tex hands, fresh board dealt card by card, winner named)
//               →  pots decided without a flip (a surrender, a tied rep flip)
//               →  the pot slides to the winner(s).
// Hold'em:      every involved hand named, the winner's five lifted → pot.
// ============================================================

import { Card, GameState, DftFlipView, HandResultShare } from "@/engine/types";
import { fmt } from "@/engine/manager";
import { CardFace } from "./CardFace";
import { labelHand, boardWinners, cardKey } from "@/lib/handLabel";
import type { Step } from "@/hooks/use-presentation";

export interface SeatFrame {
  active: "a" | "b" | "tex" | null;  // which of the seat's hands this step is about
  cards: Card[];                     // the two cards of that hand (for the seat)
  used: Set<string>;                 // hole cards among the winning five
  won: boolean;
  label: string | null;
}
export interface FrameRow {
  seat: number; name: string; cards: Card[]; label: string | null; won: boolean; note?: string; used: Set<string>;
}
export interface Frame {
  kind: Step["kind"];
  heading: string;
  chip?: "A" | "B";                  // board chip on the heading
  sub?: string;
  rows: FrameRow[];
  boardLift: Set<string>;            // board cards to lift ("A-spades" keys)
  liveBoard: "a" | "b" | null;       // DFT: the board this step is about (the other dims)
  seats: Map<number, SeatFrame>;
  runout?: Card[];                   // flip: the fresh five
  runoutShown?: number;              // how many of them are face-up right now
  foot?: string;
}

export const FLIP_DEAL_MS = 350;     // per runout card
const FLIP_START_MS = 500;

export function potName(potIndex: number, potCount: number): string {
  if (potCount <= 1) return "the pot";
  return potIndex === 0 ? "main pot" : `side pot ${potIndex}`;
}

function nameOf(s: GameState, seat: number): string {
  return s.seats.find((x) => x.seat === seat)?.name ?? `Seat ${seat + 1}`;
}

/** A showdown seat's three hands from its public arrangement. */
function hands(s: GameState, seat: number): { a: Card[]; b: Card[]; tex: Card[] } | null {
  const v = s.seats.find((x) => x.seat === seat);
  if (!v || !v.holeCards || !v.arrangement || v.holeCards.length !== 6) return null;
  const o = v.arrangement;
  const h = v.holeCards;
  return { a: [h[o[0]], h[o[1]]], b: [h[o[2]], h[o[3]]], tex: [h[o[4]], h[o[5]]] };
}

export function buildFrame(s: GameState, step: Step, elapsed: number): Frame {
  const frame: Frame = { kind: step.kind, heading: "", rows: [], boardLift: new Set(), liveBoard: null, seats: new Map() };
  const results: HandResultShare[] = s.lastHandResult ?? [];

  if ((step.kind === "boardA" || step.kind === "boardB") && s.dft) {
    const tag: "a" | "b" = step.kind === "boardA" ? "a" : "b";
    const board = s.dft.boards[tag];
    frame.chip = tag.toUpperCase() as "A" | "B";
    frame.heading = `Board ${frame.chip}`;
    frame.liveBoard = tag;
    const pots = s.pots.length ? s.pots : [{ size: 0, eligibleSeats: s.seats.filter((x) => x.revealed).map((x) => x.seat) }];
    const seen = new Set<number>();
    pots.forEach((pot, pi) => {
      const entries = pot.eligibleSeats
        .map((seat) => ({ seat, h: hands(s, seat) }))
        .filter((e): e is { seat: number; h: NonNullable<ReturnType<typeof hands>> } => !!e.h);
      if (entries.length === 0) return;
      const winners = new Set(boardWinners(entries.map((e) => ({ seat: e.seat, hole: e.h[tag] })), board));
      for (const e of entries) {
        const hole = e.h[tag];
        const label = labelHand(hole, board);
        const won = winners.has(e.seat);
        const used = new Set(label ? label.used.map(cardKey) : []);
        if (won && label) for (const c of label.used) frame.boardLift.add(cardKey(c));
        const holeUsed = new Set([...used].filter((k) => hole.some((c) => cardKey(c) === k)));
        if (!seen.has(e.seat)) {
          seen.add(e.seat);
          frame.seats.set(e.seat, { active: tag, cards: hole, used: holeUsed, won, label: label?.name ?? null });
        }
        const tagNote = won ? (winners.size > 1 ? "chop" : "wins") : "";
        frame.rows.push({
          seat: e.seat, name: nameOf(s, e.seat), cards: hole, label: label?.name ?? null, won, used: holeUsed,
          note: pots.length > 1 ? `${potName(pi, pots.length)}${tagNote ? " · " + tagNote : ""}` : (tagNote || undefined),
        });
      }
    });
    return frame;
  }

  if (step.kind === "flip" && s.dft) {
    const flip: DftFlipView | undefined = s.dft.flips[step.index];
    if (!flip) return frame;
    const potCount = s.pots.length;
    frame.heading = flip.stage === "representation"
      ? `Board ${flip.boardTag} — representation flip`
      : flip.stage === "guaranteed" ? "Flip for the other half" : "Final flip";
    frame.chip = flip.boardTag ?? undefined;
    frame.sub = `${potName(flip.potIndex, potCount)} · ${fmt(flip.amount)} at stake${flip.stage === "representation" ? ` · who represents Board ${flip.boardTag}` : ""}`;
    frame.runout = flip.runout;
    const shown = Math.max(0, Math.min(5, Math.floor((elapsed - FLIP_START_MS) / FLIP_DEAL_MS) + 1));
    frame.runoutShown = elapsed < FLIP_START_MS ? 0 : shown;
    const done = frame.runoutShown >= 5;
    const board = flip.runout.slice(0, frame.runoutShown);
    for (const h of flip.hands) {
      const label = done ? labelHand(h.tex, flip.runout) : null;
      const won = done && flip.winners.includes(h.seat);
      const used = new Set(label && won ? label.used.map(cardKey) : []);
      if (won && label) for (const c of label.used) frame.boardLift.add(cardKey(c));
      const holeUsed = new Set([...used].filter((k) => h.tex.some((c) => cardKey(c) === k)));
      frame.rows.push({ seat: h.seat, name: nameOf(s, h.seat), cards: h.tex, label: label?.name ?? (board.length >= 3 ? labelHand(h.tex, board)?.name ?? null : null), won, used: holeUsed });
      frame.seats.set(h.seat, { active: "tex", cards: h.tex, used: holeUsed, won, label: label?.name ?? null });
    }
    if (done) {
      frame.foot = flip.winners.length > 1
        ? `Tied — ${fmt(flip.amount)} splits ${flip.winners.length} ways`
        : `${nameOf(s, flip.winners[0])} takes ${fmt(flip.amount)}`;
    }
    return frame;
  }

  if (step.kind === "outcome" && s.dft) {
    const c = (s.dft.contests ?? [])[step.index];
    if (!c) return frame;
    const potCount = s.pots.length;
    frame.heading = `${potName(c.potIndex, potCount)} · ${fmt(c.amount)}`.replace(/^./, (m) => m.toUpperCase());
    const decl = (seat: number) => s.seats.find((x) => x.seat === seat)?.declarations?.find((d) => d.potIndex === c.potIndex)?.decision ?? "run";
    const parties = s.seats.filter((x) => !x.empty && x.declarations?.some((d) => d.potIndex === c.potIndex)).map((x) => x.seat);
    if (c.kind === "boardSplit") {
      frame.sub = "A representation flip tied";
      frame.foot = "No final flip: each board's half splits evenly among that board's tied representatives.";
    } else if (c.kind === "gtdHeadsUp" && c.banker != null) {
      const banker = c.banker;
      frame.sub = `${nameOf(s, banker)} owned half outright`;
      frame.foot = decl(banker) === "surrender"
        ? `${nameOf(s, banker)} surrendered the other half — keeps the banked 50% plus 30% of the rest; the challenger takes 70% of it.`
        : `${nameOf(s, banker)} ran it.`;
      frame.rows.push({ seat: banker, name: nameOf(s, banker), cards: [], label: decl(banker) === "surrender" ? "SURRENDER" : "RUN", won: false, used: new Set() });
    } else {
      const surr = parties.filter((p) => decl(p) === "surrender");
      const runs = parties.filter((p) => decl(p) === "run");
      frame.sub = "Each board found a different winner";
      if (surr.length >= 2) frame.foot = "Both surrendered — the pot chops 50/50, no flip.";
      else if (surr.length === 1 && runs.length === 1) frame.foot = `${nameOf(s, surr[0])} surrendered — ${nameOf(s, runs[0])} takes 70%, ${nameOf(s, surr[0])} keeps 30%. No flip.`;
      else frame.foot = "Both ran it.";
      for (const p of parties) {
        frame.rows.push({ seat: p, name: nameOf(s, p), cards: [], label: decl(p).toUpperCase(), won: false, used: new Set() });
      }
    }
    return frame;
  }

  if (step.kind === "reveal") {
    frame.heading = "Showdown";
    const board = s.communityCards;
    const winners = new Set(results.filter((r) => r.amountWon > 0).map((r) => r.seat));
    for (const v of s.seats) {
      if (v.empty || !v.revealed || !v.holeCards || v.holeCards.length !== 2 || v.folded) continue;
      const label = labelHand(v.holeCards, board);
      const won = winners.has(v.seat);
      const used = new Set(label && won ? label.used.map(cardKey) : []);
      if (won && label) for (const c of label.used) frame.boardLift.add(cardKey(c));
      const holeUsed = new Set([...used].filter((k) => v.holeCards!.some((c) => cardKey(c) === k)));
      frame.rows.push({ seat: v.seat, name: v.name, cards: v.holeCards, label: label?.name ?? null, won, used: holeUsed, note: won ? (winners.size > 1 ? "chop" : "wins") : undefined });
      frame.seats.set(v.seat, { active: null, cards: v.holeCards, used: holeUsed, won, label: label?.name ?? null });
    }
    return frame;
  }

  if (step.kind === "foldwin") {
    frame.heading = "Everyone folded";
    const w = results.find((r) => r.amountWon > 0);
    frame.foot = w ? `${w.name} takes ${fmt(w.amountWon)}` : "Pot settled";
    return frame;
  }

  // pot: the final tally
  frame.heading = results.length > 1 ? "Pot split" : "Pot";
  for (const r of results) {
    frame.rows.push({ seat: r.seat, name: r.name, cards: [], label: `+${fmt(r.amountWon)}`, won: true, used: new Set() });
  }
  return frame;
}

interface PanelProps { frame: Frame; free: boolean }

export function ShowdownPanel({ frame, free }: PanelProps) {
  const isFlip = frame.kind === "flip";
  return (
    <div className={`sd-panel${free ? " free" : ""}`}>
      <div className="sd-head">
        {frame.chip && <span className={`sd-chip ${frame.chip.toLowerCase()}`}>{frame.chip}</span>}
        <span className="sd-title">{frame.heading}</span>
        {frame.sub && <span className="sd-sub">{frame.sub}</span>}
      </div>
      {isFlip && frame.runout && (
        <div className="sd-runout">
          {frame.runout.map((c, i) => (
            <CardFace key={i} card={i < (frame.runoutShown ?? 0) ? c : null} size="sm" lift={frame.boardLift.has(cardKey(c))} />
          ))}
        </div>
      )}
      {frame.rows.length > 0 && (
        <div className="sd-rows">
          {frame.rows.map((r, i) => (
            <div key={`${r.seat}-${i}`} className={`sd-row${r.won ? " won" : ""}`}>
              <span className="sd-name">{r.name}</span>
              {r.cards.length > 0 && (
                <span className="sd-cards">
                  {r.cards.map((c, j) => <CardFace key={j} card={c} size="xs" lift={r.used.has(cardKey(c))} dim={r.won && r.used.size > 0 && !r.used.has(cardKey(c))} />)}
                </span>
              )}
              <span className="sd-label">{r.label ?? ""}</span>
              {r.note && <span className="sd-note">{r.note}</span>}
            </div>
          ))}
        </div>
      )}
      {frame.foot && <div className="sd-foot">{frame.foot}</div>}
    </div>
  );
}
