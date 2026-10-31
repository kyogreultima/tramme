import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/lib/i18n';
import { PLANS, PLAN_IDS, ROWS, formatPrice, plan } from '../src/lib/plans';
import { faq } from '../src/lib/faq';

describe('the plans', () => {
  it('cost what the spec says', () => {
    expect(plan('basic').price).toEqual({ month: 0, year: 0 });
    expect(plan('plus').price).toEqual({ month: 12, year: 10 });
    expect(plan('pro').price).toEqual({ month: 35, year: 29 });
    expect(PLANS.map((p) => p.credits)).toEqual([0, 1000, 4000]);
  });

  it('are priced in euros, in both languages', () => {
    expect(formatPrice('en', 12)).toBe('12 €');
    expect(formatPrice('fr', 35)).toBe('35 €');
  });

  it('have a value for every plan in every row', () => {
    for (const row of ROWS) for (const id of PLAN_IDS) expect(row.values[id], `${row.id}/${id}`).not.toBeUndefined();
  });

  it('have both languages for every label and every worded cell', () => {
    for (const row of ROWS) {
      for (const l of LOCALES) expect(row.label[l].trim(), row.id).not.toBe('');
      for (const id of PLAN_IDS) {
        const cell = row.values[id];
        if (typeof cell === 'object') for (const l of LOCALES) expect(cell[l].trim(), `${row.id}/${id}`).not.toBe('');
      }
    }
  });

  it('say the same credits in the table and in the FAQ', () => {
    const ai = ROWS.find((r) => r.id === 'ai')!;
    const credits = (v: unknown) => (typeof v === 'object' ? (v as { en: string }).en : '');
    expect(credits(ai.values.plus)).toContain('1 000');
    expect(credits(ai.values.pro)).toContain('4 000');
    const answer = faq('en', ['credits'])[0].a;
    expect(answer).toContain('1 000');
    expect(answer).toContain('4 000');
  });
});
