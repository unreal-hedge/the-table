import { Card } from "@/engine/types";

const PIPS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;

export function CardFace({ card, small }: { card: Card | null; small?: boolean }) {
  const cls = `card${small ? " sm" : ""}`;
  if (!card) return <div className={`${cls} back`} aria-label="Face-down card" />;
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div className={`${cls}${red ? " red" : ""}`} aria-label={`${card.rank} of ${card.suit}`}>
      <span className="rank">{card.rank === "T" ? "10" : card.rank}</span>
      <span className="pip">{PIPS[card.suit]}</span>
    </div>
  );
}
