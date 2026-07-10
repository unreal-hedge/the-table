// ============================================================
// Browser stand-in for Node's "crypto" module — client bundles
// only (wired in next.config.mjs). poker-ts shuffles the deck
// with crypto.randomInt, which doesn't exist in browsers; without
// this shim, local (hot-seat) mode crashes on the first deal.
//
// Only the one function poker-ts uses is provided, matching
// Node's one-argument signature: randomInt(max) → [0, max).
// Backed by Web Crypto with rejection sampling so the deal stays
// uniform — it's a card shuffle, biased RNG is not acceptable.
// ============================================================

const UINT32_RANGE = 0x1_0000_0000;

export function randomInt(max: number): number {
  const range = Math.floor(max);
  if (!Number.isFinite(range) || range <= 0 || range > UINT32_RANGE) {
    throw new RangeError(`randomInt: max out of range: ${max}`);
  }
  // rejection sampling: retry the draw instead of taking a biased modulo
  const limit = UINT32_RANGE - (UINT32_RANGE % range);
  const buf = new Uint32Array(1);
  let draw: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    draw = buf[0];
  } while (draw >= limit);
  return draw % range;
}
