// What a turn costs in dollars, how much of it came from the cache, and two
// series of turns side by side. Pure functions of the usage lines the
// conversations keep (apps/editor/src/api.ts, TurnUsage); the files are read in
// usage.ts. Costs live here, in the bench: the chat never shows them.

import type { Usage } from '@tramme/assistant';
import type { TurnUsage } from '../apps/editor/src/api.ts';
import { PRICES } from './prices.ts';

const M = 1e6;

/** the dollars of a turn, and whether they are a lower bound; null when the model has no price or the route reported no usage */
/** the dollars of some tokens at a model's price, and whether they are a lower bound; null when the model has none */
function priced(u: Usage, model: string): { dollars: number; lowerBound: boolean } | null {
  const price = PRICES[model];
  if (!price) return null;
  // a line kept before the lifetimes were told has no hour of writes
  const hour = Math.min(u.cacheWrite, u.cacheWrite1h || 0);
  const dollars = (u.input * price.input + u.cacheRead * price.cacheRead + (u.cacheWrite - hour) * price.cacheWrite5m + hour * price.cacheWrite1h + u.output * price.output) / M;
  return { dollars, lowerBound: !!price.lowerBound };
}

/** the dollars of a turn (its critic's consults included, each at its own model's price), and whether they are a lower bound; null when a model has no price or the route reported no usage */
export function costOf(u: TurnUsage): { dollars: number; lowerBound: boolean } | null {
  if (u.unknown) return null;
  const own = priced(u, u.model), critic = u.consults ? priced(u.consults, u.consults.model) : { dollars: 0, lowerBound: false };
  return own && critic ? { dollars: own.dollars + critic.dollars, lowerBound: own.lowerBound || critic.lowerBound } : null;
}

/** how many consults the critic made in these turns, and what they cost (what the unknown ones would add is not counted) */
export function criticOf(turns: TurnUsage[]): { n: number; dollars: number } {
  let n = 0, dollars = 0;
  for (const u of turns) if (u.consults) { n += u.consults.n; dollars += priced(u.consults, u.consults.model)?.dollars ?? 0; }
  return { n, dollars };
}

/** the share of what the model read that came from the cache (0 when it read nothing) */
export function cacheShare(u: Usage): number {
  const read = u.input + u.cacheRead + u.cacheWrite;
  return read > 0 ? u.cacheRead / read : 0;
}

/** whether some cost of these turns is a lower bound */
export const lowerBound = (turns: TurnUsage[]): boolean => turns.some((u) => costOf(u)?.lowerBound);

export interface Totals { dollars: number | null; cacheShare: number; output: number; ms: number }

/** the turns added up; dollars is null as soon as one turn has none (a total that skipped it would be wrong) */
export function totalsOf(turns: TurnUsage[]): Totals {
  const sum = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  let dollars: number | null = 0, ms = 0;
  for (const u of turns) {
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += u[key] || 0;
    ms += u.ms || 0;
    const c = costOf(u);
    dollars = c && dollars !== null ? dollars + c.dollars : null;
  }
  return { dollars, cacheShare: cacheShare(sum), output: sum.output, ms };
}

/** two series of turns (before and after a change, on the same briefs): each one's totals and what changed */
export function compare(before: TurnUsage[], after: TurnUsage[]): { before: Totals; after: Totals; change: Totals } {
  const a = totalsOf(before), b = totalsOf(after);
  return {
    before: a,
    after: b,
    change: { dollars: a.dollars === null || b.dollars === null ? null : b.dollars - a.dollars, cacheShare: b.cacheShare - a.cacheShare, output: b.output - a.output, ms: b.ms - a.ms },
  };
}
