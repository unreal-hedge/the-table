import { Card } from "@/engine/types";

// ============================================================
// CardFace — the one card renderer, used everywhere a card shows.
// Legibility first (the DFT playtest died on unreadable cards):
//   - a BIG centre suit pip is the main suit signal, plus the classic
//     corner index (rank over a small pip) for scanning a row
//   - four-colour suits: spades black, hearts red, diamonds blue,
//     clubs green — no more squinting at a 10px ♦ vs ♥ on a phone
//   - every dimension is derived from one width variable (--w), so a
//     size is one class and rank/pip scale with it
// States: `dim` (not part of the winning five), `lift` (IS part of it).
// ============================================================

export type CardSize = "xs" | "sm" | "md" | "lg";

const PIPS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
const SUIT_WORD = { clubs: "clubs", diamonds: "diamonds", hearts: "hearts", spades: "spades" } as const;
const RANK_WORD: Record<Card["rank"], string> = {
  "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  T: "10", J: "J", Q: "Q", K: "K", A: "A",
};

interface Props {
  card: Card | null;      // null = face-down back
  size?: CardSize;
  dim?: boolean;          // fade: not part of the hand being shown
  lift?: boolean;         // raise + gold ring: one of the five cards that won
  delay?: number;         // ms — staggers the deal-in animation
  className?: string;
  /** @deprecated use size="sm" — kept so older call sites still compile */
  small?: boolean;
}

export function CardFace({ card, size, dim, lift, delay, className, small }: Props) {
  const sz = size ?? (small ? "sm" : "md");
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  const extra = `${dim ? " dim" : ""}${lift ? " lift" : ""}${className ? " " + className : ""}`;
  if (!card) {
    return <div className={`card ${sz} back${extra}`} style={style} aria-label="Face-down card" />;
  }
  const pip = PIPS[card.suit];
  return (
    <div
      className={`card ${sz} s-${card.suit}${extra}`}
      style={style}
      aria-label={`${RANK_WORD[card.rank]} of ${SUIT_WORD[card.suit]}`}
    >
      <span className="card-index">
        <span className="rank">{RANK_WORD[card.rank]}</span>
        <span className="pip-sm">{pip}</span>
      </span>
      <span className="pip-big" aria-hidden="true">{pip}</span>
    </div>
  );
}
