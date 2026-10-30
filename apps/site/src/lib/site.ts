// What the site says of itself, wherever it is read: the pages' heads, the
// link previews, the search engines' structured data, robots.txt, llms.txt.

import { APP, REPO } from './links';
import { FAQ } from './faq';

export const SITE = {
  /** the public address (SITE_URL overrides it, for a deployment elsewhere) */
  url: 'https://tramme.dev',
  name: 'Tramme',
  title: 'Tramme, motion design directed in words',
  description: 'A free, open-source motion design app: direct the film in words in the studio, refine every keyframe in the atelier, export what you see.',
  docs: 'Documentation of Tramme, the open-source motion design engine and editor.',
  /** the preview of a link to the site (apps/editor/og.jpg, made by scripts/og-image.ts) */
  preview: { width: 1200, height: 630, alt: 'Tramme: motion design, directed in words. The editor, with a composition, its layers and its timeline.' },
};

/** the structured data of the landing page (schema.org): the site, its questions, and the app it presents, on the
 *  web and on the systems of its latest release (lib/download.ts) */
export function landingData(site: URL, preview: string, systems: string[]) {
  const home = site.href;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${home}#site`, url: home, name: SITE.name, description: SITE.description, inLanguage: 'en' },
      {
        '@type': 'SoftwareApplication',
        '@id': `${home}#app`,
        name: SITE.name,
        description: SITE.description,
        url: APP,
        image: preview,
        applicationCategory: 'MultimediaApplication',
        applicationSubCategory: 'Motion design',
        operatingSystem: ['Web browser', ...systems].join(', '),
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        sameAs: [REPO],
        author: { '@type': 'Person', name: 'Aziz Chanou' },
      },
      {
        '@type': 'FAQPage',
        '@id': `${home}#faq`,
        mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${home}#code`,
        name: SITE.name,
        codeRepository: REPO,
        programmingLanguage: ['TypeScript', 'Rust'],
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        targetProduct: { '@id': `${home}#app` },
      },
    ],
  };
}
