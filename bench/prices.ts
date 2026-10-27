// What a model costs, in dollars per million tokens (Anthropic's own prices,
// cached 2026-10-06: check them against the live pricing page before relying
// on a figure). A model that is not here has no price: its cost is unknown, not
// zero. Only Claude is priced; another provider's models are added when someone
// needs them.

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** a cache write kept 5 minutes, and one kept an hour */
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** the turn's cost is at least this: a rate that changes with the size of the prompt cannot be applied to a turn's total */
  lowerBound?: boolean;
}

/** a cache write costs 1.25 times the input for 5 minutes, twice for an hour */
const claude = (input: number, cacheRead: number, output: number, lowerBound = false): Price => ({
  input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, ...(lowerBound ? { lowerBound } : {}),
});

export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': claude(4, 0.2, 20),
  'claude-sonnet-5-5': claude(2, 0.2, 10),
  // usage is kept per turn, not per request: Haiku 5.5's higher rate past 100 K tokens of prompt cannot be applied
  'claude-haiku-5-5': claude(0.1, 0.01, 0.5, true),
  'claude-haiku-4-5-20251001': claude(1, 0.1, 5),
};
