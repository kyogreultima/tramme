import { describe, expect, it } from 'vitest';
import type { TurnUsage } from '../apps/editor/src/api.ts';
import { cacheShare, compare, costOf, lowerBound, totalsOf } from './cost.ts';

const turn = (patch: Partial<TurnUsage> = {}): TurnUsage => ({
  requests: 1, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, tools: 0, images: 0, ms: 0, model: 'claude-opus-5-5', route: 'server', ...patch,
});

describe('costOf', () => {
  it('prices each part', () => {
    // 4 (input) + 0.2 (read) + 0.6 x 5 (5 min writes) + 0.4 x 8 (1 h writes) + 0.1 x 20 (output)
    const c = costOf(turn({ input: 1e6, cacheRead: 1e6, cacheWrite: 1e6, cacheWrite1h: 4e5, output: 1e5 }));
    expect(c!.dollars).toBeCloseTo(12.4, 6);
    expect(c!.lowerBound).toBe(false);
  });

  it('gives null for an unknown model or an unknown usage, never zero', () => {
    expect(costOf(turn({ model: 'openai:gpt-5', input: 1000 }))).toBeNull();
    expect(costOf(turn({ input: 1000, unknown: true }))).toBeNull();
  });

  it('says Haiku 5.5 is a lower bound', () => {
    const c = costOf(turn({ model: 'claude-haiku-5-5', input: 1e6 }));
    expect(c!.dollars).toBeCloseTo(0.1, 6);
    expect(c!.lowerBound).toBe(true);
    expect(lowerBound([turn(), turn({ model: 'claude-haiku-5-5' })])).toBe(true);
    expect(lowerBound([turn()])).toBe(false);
  });

  it('prices the cache writes of a usage that never said their lifetime as 5 minutes', () => {
    const c = costOf(turn({ cacheWrite: 1e6 }));
    expect(c!.dollars).toBeCloseTo(5, 6);
    // a line kept before the split of the lifetimes has no cacheWrite1h at all
    const old = { ...turn({ cacheWrite: 1e6 }), cacheWrite1h: undefined } as unknown as TurnUsage;
    expect(costOf(old)!.dollars).toBeCloseTo(5, 6);
  });
});

describe('cacheShare', () => {
  it('is what was read from the cache of what was read', () => {
    expect(cacheShare(turn({ input: 100, cacheRead: 300, cacheWrite: 100 }))).toBeCloseTo(0.6, 6);
    expect(cacheShare(turn())).toBe(0);
  });
});

describe('compare', () => {
  it('sums and subtracts', () => {
    const before = [turn({ input: 1e6, output: 1e5, ms: 1000 }), turn({ cacheRead: 1e6, ms: 500 })];
    const after = [turn({ input: 5e5, cacheRead: 5e5, output: 5e4, ms: 700 })];
    const r = compare(before, after);
    expect(r.before.dollars).toBeCloseTo(4 + 2 + 0.2, 6);
    expect(r.after.dollars).toBeCloseTo(2 + 0.1 + 1, 6);
    expect(r.change.dollars).toBeCloseTo(r.after.dollars! - r.before.dollars!, 6);
    expect(r.before.output).toBe(1e5);
    expect(r.change.output).toBe(5e4 - 1e5);
    expect(r.change.ms).toBe(700 - 1500);
    expect(r.before.cacheShare).toBeCloseTo(1e6 / 2e6, 6);
    expect(r.change.cacheShare).toBeCloseTo(r.after.cacheShare - r.before.cacheShare, 6);
  });

  it('keeps null dollars null on either side', () => {
    const known = [turn({ input: 1e6 })], unknown = [turn({ input: 1e6 }), turn({ model: 'openai:gpt-5', input: 1e6 })];
    expect(totalsOf(unknown).dollars).toBeNull();
    const r = compare(known, unknown);
    expect(r.before.dollars).toBeCloseTo(4, 6);
    expect(r.after.dollars).toBeNull();
    expect(r.change.dollars).toBeNull();
    expect(compare(unknown, known).change.dollars).toBeNull();
  });
});
