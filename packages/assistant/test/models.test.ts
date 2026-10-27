import { describe, expect, it } from 'vitest';
import { ADAPTIVE, DEFAULT_MODEL, effortLevels, MODELS, modelLabel, NO_FALLBACK } from '../src/index.ts';

describe('the models offered', () => {
  it('offers Haiku 5.5 between Sonnet 5.5 and Haiku 4.5, the default unchanged', () => {
    const ids = MODELS.map(([id]) => id);
    expect(ids).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5-20251001']);
    expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5');
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(ADAPTIVE.has('claude-haiku-5-5')).toBe(true);
    expect(effortLevels('claude-haiku-5-5')).toHaveLength(5);
    // Haiku 4.5 still has no levels
    expect(effortLevels('claude-haiku-4-5-20251001')).toEqual([]);
  });

  it('has no server-side fallback for Haiku 5.5', () => {
    expect(NO_FALLBACK.has('claude-haiku-5-5')).toBe(true);
    expect(NO_FALLBACK.has('claude-opus-5-5')).toBe(false);
  });
});
