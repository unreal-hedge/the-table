// poker-ts ranking enum → human name.
// Verified: three tens returned ranking 3.
const NAMES = [
  "High card",        // 0
  "Pair",             // 1
  "Two pair",         // 2
  "Three of a kind",  // 3
  "Straight",         // 4
  "Flush",            // 5
  "Full house",       // 6
  "Four of a kind",   // 7
  "Straight flush",   // 8
  "Royal flush",      // 9
];

export function handName(ranking: number): string {
  return NAMES[ranking] ?? "Unknown hand";
}
