import { describe, expect, it } from 'vitest';
import { amountDue, isInterval, isPaid, PLAN_TERMS, termsOf } from '../src/index.ts';

describe('plans', () => {
  it('lists basic, plus and pro, the first being free', () => {
    expect(PLAN_TERMS.map((p) => p.id)).toEqual(['basic', 'plus', 'pro']);
    expect(termsOf('basic').price).toEqual({ month: 0, year: 0 });
  });

  it('knows what is paid and what is a billing interval', () => {
    expect([isPaid('basic'), isPaid('plus'), isPaid('pro'), isPaid('x')]).toEqual([false, true, true, false]);
    expect([isInterval('month'), isInterval('year'), isInterval('week')]).toEqual([true, true, false]);
  });

  it('charges twelve months at the yearly monthly price for a year', () => {
    expect(amountDue('plus', 'month')).toBe(termsOf('plus').price.month);
    expect(amountDue('plus', 'year')).toBe(termsOf('plus').price.year * 12);
  });
});
