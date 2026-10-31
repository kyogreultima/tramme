import { describe, expect, it } from 'vitest';
import { PLANS } from '../src/lib/plans';
import { landingData } from '../src/lib/site';
import { read } from './sources';

type Node = { '@type': string; inLanguage?: string; offers?: { price: string; priceCurrency: string }[] };
const graph = (locale: 'en' | 'fr') => landingData(new URL('https://tramme.dev'), '/og.jpg', ['Windows'], locale)['@graph'] as Node[];

describe('what the search engines read', () => {
  it('offers the three plans at the prices of the plans data, in euros', () => {
    const app = graph('en').find((n) => n['@type'] === 'SoftwareApplication')!;
    expect(app.offers!.map((o) => o.price)).toEqual(PLANS.map((p) => String(p.price.month)));
    expect(app.offers!.every((o) => o.priceCurrency === 'EUR')).toBe(true);
  });

  it('follows the language of the page', () => {
    expect(graph('fr').find((n) => n['@type'] === 'WebSite')!.inLanguage).toBe('fr');
  });

  it('lists the platform\'s pages in llms.txt', () => {
    const llms = read('pages/llms.txt.ts');
    for (const page of ['/explore/', '/pricing/', '/roadmap/', '/terms/']) expect(llms).toContain(`'${page}'`);
  });
});
