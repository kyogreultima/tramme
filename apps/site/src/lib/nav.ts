// Where the site leads, written once: the top bar's menus and links, and the
// footer's columns, in each language. A test (test/nav.test.ts) checks that
// every internal link reaches a page that exists.

import { APP, REPO, repoFile, logIn, signUp } from './links';
import { systemsLine } from '../../../desktop/downloads.ts';
import { docHref } from './docs';
import { pathIn, t, type Locale } from './i18n';

export interface NavLink { label: string; href: string; hint?: string; /** it leads to the app: it opens in a tab of its own */ app?: true }
export interface NavMenu { id: string; label: string; links: NavLink[] }

/** a link to a page of the site, in the language, its label and hint from the catalog (`nav.<key>`, `nav.<key>Hint`) */
const page = (locale: Locale, key: string, href: string, hint = false): NavLink => ({
  label: t(locale, `nav.${key}`),
  href: pathIn(locale, href),
  ...(hint && { hint: t(locale, `nav.${key}Hint`, { systems: systemsLine(locale) }) }),
});

/** the menus of the top bar */
export function menus(locale: Locale): NavMenu[] {
  return [
    {
      id: 'product',
      label: t(locale, 'nav.product'),
      links: [
        { label: t(locale, 'nav.openApp'), href: APP, hint: t(locale, 'nav.openAppHint'), app: true },
        page(locale, 'download', '/download/', true),
        page(locale, 'assistant', '/features/#assistant', true),
      ],
    },
    {
      id: 'features',
      label: t(locale, 'nav.features'),
      links: [
        page(locale, 'studio', '/features/#studio', true),
        page(locale, 'atelier', '/features/#editor', true),
        page(locale, 'assistant', '/features/#assistant', true),
        page(locale, 'packs', '/features/#packs', true),
        page(locale, 'export', '/features/#render', true),
      ],
    },
  ];
}

/** the links of the top bar that open a page, after the menus */
export function barLinks(locale: Locale): NavLink[] {
  return [page(locale, 'explore', '/explore/'), page(locale, 'pricing', '/pricing/'), { label: t(locale, 'nav.docs'), href: docHref('') }];
}

/** the two buttons at the bar's end: log in, and start */
export function barButtons(locale: Locale): { logIn: NavLink; start: NavLink } {
  return {
    logIn: { label: t(locale, 'common.logIn'), href: logIn(locale), app: true },
    start: { label: t(locale, 'common.startFree'), href: signUp({ lang: locale }), app: true },
  };
}

/** the footer's columns */
export function footerColumns(locale: Locale): NavMenu[] {
  const f = (key: string) => t(locale, `footer.${key}`);
  return [
    {
      id: 'product',
      label: t(locale, 'nav.product'),
      links: [
        { label: t(locale, 'nav.openApp'), href: APP, app: true },
        page(locale, 'features', '/features/'),
        page(locale, 'download', '/download/'),
        page(locale, 'pricing', '/pricing/'),
      ],
    },
    {
      id: 'community',
      label: f('community'),
      links: [page(locale, 'explore', '/explore/'), barButtons(locale).logIn, barButtons(locale).start],
    },
    {
      id: 'resources',
      label: f('resources'),
      links: [
        { label: t(locale, 'nav.docs'), href: docHref('') },
        { label: f('changelog'), href: docHref('changelog') },
        { label: f('roadmap'), href: pathIn(locale, '/roadmap/') },
        page(locale, 'pricing', '/pricing/'),
      ],
    },
    {
      id: 'company',
      label: f('company'),
      links: [
        { label: f('about'), href: pathIn(locale, '/about/') },
        { label: f('terms'), href: pathIn(locale, '/terms/') },
        { label: f('privacy'), href: pathIn(locale, '/privacy/') },
        { label: f('security'), href: repoFile('SECURITY.md') },
        { label: f('licence'), href: repoFile('LICENSE') },
        { label: f('repository'), href: REPO },
      ],
    },
  ];
}
