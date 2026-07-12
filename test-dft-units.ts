// Unit tests for the DFT pure modules (cards / deck / eval).
// Run: npx tsx test-dft-units.ts
import type { Card } from "./shared/engine/types";
import { cardToStr, strToCard, fullDeck, sameCard } from "./shared/engine/dft/cards";
import { makeRng, shuffle, Deck, freshDeckMinus } from "./shared/engine/dft/deck";
import { bestHand, winnerIndices } from "./shared/engine/dft/eval";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}
const mk = (arr: [Card["rank"], Card["suit"]][]): Card[] =>
  arr.map(([rank, suit]) => ({ rank, suit }));

console.log("cards:");
let rt = true;
for (const c of fullDeck()) if (!sameCard(strToCard(cardToStr(c)), c)) rt = false;
check("all 52 round-trip {rank,suit} <-> string", rt);
check("full deck is 52 unique", new Set(fullDeck().map(cardToStr)).size === 52);
check("ten maps to 'Th' not '10h'", cardToStr({ rank: "T", suit: "hearts" }) === "Th");
check("bad string throws", (() => { try { strToCard("Zx"); return false; } catch { return true; } })());

console.log("\ndeck (seeded RNG):");
const s1 = [makeRng(123), makeRng(123), makeRng(999)] as const;
const a1 = [s1[0](), s1[0](), s1[0]()];
const a2 = [s1[1](), s1[1](), s1[1]()];
const a3 = [s1[2](), s1[2](), s1[2]()];
check("same seed -> identical stream", JSON.stringify(a1) === JSON.stringify(a2));
check("different seed -> different stream", JSON.stringify(a1) !== JSON.stringify(a3));
const shufA = shuffle(fullDeck(), makeRng(42)).map(cardToStr);
const shufB = shuffle(fullDeck(), makeRng(42)).map(cardToStr);
const shufC = shuffle(fullDeck(), makeRng(43)).map(cardToStr);
check("shuffle deterministic per seed", JSON.stringify(shufA) === JSON.stringify(shufB));
check("shuffle actually permutes", JSON.stringify(shufA) !== JSON.stringify(fullDeck().map(cardToStr)));
check("shuffle keeps all 52", new Set(shufA).size === 52);
check("different seed -> different order", JSON.stringify(shufA) !== JSON.stringify(shufC));

const deck = new Deck(makeRng(7));
const drawn = deck.draw(6);
check("draw pulls requested count", drawn.length === 6);
check("draw advances the deck", deck.remaining === 46);
check("over-draw throws", (() => { const d = new Deck(makeRng(1)); try { d.draw(53); return false; } catch { return true; } })());

const excl = mk([["A", "spades"], ["K", "spades"]]);
const fresh = freshDeckMinus(excl, makeRng(5));
const freshCards: Card[] = [];
while (fresh.remaining > 0) freshCards.push(...fresh.draw(1));
check("freshDeckMinus removes excluded + keeps the rest",
  freshCards.length === 50 && !freshCards.some((c) => excl.some((e) => sameCard(c, e))));

console.log("\neval:");
const boardRF = mk([["A", "spades"], ["K", "spades"], ["Q", "spades"], ["J", "spades"], ["T", "spades"]]);
const e1 = bestHand(mk([["2", "clubs"], ["3", "diamonds"]]), boardRF);
const e2 = bestHand(mk([["4", "hearts"], ["6", "hearts"]]), boardRF);
check("play the board: both reach the same hand", e1.name === e2.name, e1.name);
check("play the board: chop returns 2 winners", winnerIndices([e1, e2]).length === 2);
const board2 = mk([["A", "hearts"], ["9", "hearts"], ["2", "hearts"], ["5", "clubs"], ["K", "diamonds"]]);
const flush = bestHand(mk([["Q", "hearts"], ["7", "hearts"]]), board2);
const trips = bestHand(mk([["K", "clubs"], ["K", "spades"]]), board2);
check("flush ranks above trips", flush.rank > trips.rank, `${flush.name} vs ${trips.name}`);
check("winnerIndices picks the flush alone", (() => {
  const w = winnerIndices([flush, trips]);
  return w.length === 1 && w[0] === 0;
})());

console.log(failures === 0 ? "\nDFT UNIT TESTS PASS" : `\nDFT UNIT TESTS FAIL (${failures} failing)`);
process.exit(failures === 0 ? 0 : 1);
