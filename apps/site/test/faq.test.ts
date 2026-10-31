import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/lib/i18n';
import { faq } from '../src/lib/faq';
import { landingData } from '../src/lib/site';

const graph = landingData(new URL('https://tramme.dev'), '/og.jpg', ['Windows'])['@graph'] as { '@type': string; mainEntity?: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[] }[];

describe('the FAQ', () => {
  it('is told to the search engines, question by question', () => {
    const page = graph.find((n) => n['@type'] === 'FAQPage');
    expect(page, 'no FAQPage in the structured data').toBeDefined();
    expect(page!.mainEntity).toEqual(faq('en').map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })));
  });

  it.each(LOCALES)('asks questions, and answers them in plain text (%s)', (locale) => {
    expect(faq(locale).length).toBeGreaterThanOrEqual(8);
    for (const { q, a } of faq(locale)) {
      expect(q.trim().endsWith('?'), q).toBe(true);
      expect(a.trim().length, q).toBeGreaterThan(20);
      expect(a, q).not.toMatch(/[<>]/);
    }
  });

  it('never calls the project open source', () => {
    for (const locale of LOCALES) for (const { a } of faq(locale)) expect(a).not.toMatch(/open[- ]source/i);
  });
});
