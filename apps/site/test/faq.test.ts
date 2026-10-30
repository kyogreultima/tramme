import { describe, expect, it } from 'vitest';
import { FAQ } from '../src/lib/faq';
import { landingData } from '../src/lib/site';

const graph = landingData(new URL('https://tramme.dev'), '/og.jpg', ['Windows'])['@graph'] as { '@type': string; mainEntity?: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[] }[];

describe('the FAQ', () => {
  it('is told to the search engines, question by question', () => {
    const page = graph.find((n) => n['@type'] === 'FAQPage');
    expect(page, 'no FAQPage in the structured data').toBeDefined();
    expect(page!.mainEntity).toEqual(FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })));
  });

  it('asks questions, and answers them in plain text', () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(6);
    for (const { q, a } of FAQ) {
      expect(q.endsWith('?'), q).toBe(true);
      expect(a.trim().length, q).toBeGreaterThan(20);
      expect(a, q).not.toMatch(/[<>]/);
    }
  });
});
