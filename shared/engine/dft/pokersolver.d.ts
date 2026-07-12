// Minimal ambient types for pokersolver@2.1.4 — there is no @types package.
// Only the surface DFT uses is declared. Default export mirrors the CJS
// module.exports object, which is the portable interop shape across tsx,
// webpack (Next), and esbuild (wrangler).
declare module "pokersolver" {
  export interface SolvedHand {
    cards: unknown[];
    rank: number;
    name: string;
    descr: string;
  }
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): SolvedHand;
    static winners(hands: SolvedHand[]): SolvedHand[];
  }
  const pokersolver: { Hand: typeof Hand };
  export default pokersolver;
}
