// Where the site leads, written once: the top bar's menus and links, and the
// footer's columns. A test (test/nav.test.ts) checks that every internal link
// reaches a page that exists.

import { APP, REPO, repoFile } from './links';
import { docHref } from './docs';

export interface NavLink { label: string; href: string; hint?: string }
export interface NavMenu { id: string; label: string; links: NavLink[] }

const ASSISTANT: NavLink = { label: 'The assistant', href: '/features/#assistant', hint: 'Directs, cuts and dresses the film with you' };

/** the menus of the top bar, and the first two columns of the footer */
export const MENUS: NavMenu[] = [
  {
    id: 'product',
    label: 'Product',
    links: [
      { label: 'Open the app', href: APP, hint: 'In your browser, nothing to install' },
      { label: 'Download', href: '/download/', hint: 'Windows, macOS and Linux, offline' },
      ASSISTANT,
    ],
  },
  {
    id: 'features',
    label: 'Features',
    links: [
      { label: 'Studio', href: '/features/#studio', hint: 'Direct the film in words' },
      { label: 'Atelier', href: '/features/#editor', hint: 'Layers, keyframes and curves' },
      { label: 'Assistant', href: '/features/#assistant', hint: 'The AI edits with your tools' },
      { label: 'Packs', href: '/features/#packs', hint: 'Icons, diagrams, charts, type, physics' },
      { label: 'Export', href: '/features/#render', hint: 'What you see is what you export' },
    ],
  },
];

/** the links of the top bar that open a page, after the menus */
export const BAR_LINKS: NavLink[] = [
  { label: 'Examples', href: '/examples/' },
  { label: 'Docs', href: docHref('') },
  { label: 'Pricing', href: '/pricing/' },
];

/** the footer's columns */
export const FOOTER: NavMenu[] = [
  ...MENUS,
  {
    id: 'resources',
    label: 'Resources',
    links: [
      { label: 'Docs', href: docHref('') },
      { label: 'Changelog', href: docHref('changelog') },
      { label: 'Examples', href: '/examples/' },
      { label: 'Pricing', href: '/pricing/' },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    links: [
      { label: 'About', href: '/about/' },
      { label: 'Repository', href: REPO },
      { label: 'Licence', href: repoFile('LICENSE') },
      { label: 'Privacy', href: '/privacy/' },
      { label: 'Security', href: repoFile('SECURITY.md') },
    ],
  },
];
