// The site's two languages: English at the root, French under /fr/. Interface
// strings live in catalogs (src/i18n/en.json is the reference, fr.json has the
// same keys; a missing key falls back to English, see docs/i18n.md). Long texts
// are per-language data (Localised) in the lib/ module that owns them.

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';

export type Locale = 'en' | 'fr';
export const LOCALES: Locale[] = ['en', 'fr'];
export const DEFAULT_LOCALE: Locale = 'en';

export type Localised<T> = Record<Locale, T>;
export const pick = <T>(locale: Locale, v: Localised<T>): T => v[locale];

export type Catalog = { [key: string]: string | Catalog };
export const CATALOGS: Localised<Catalog> = { en, fr };

const lookup = (catalog: Catalog, key: string): string | undefined => {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
};

/** a text of a catalog, {names} replaced; the English one when the language has none, the key when neither does */
export function translate(catalogs: Localised<Catalog>, locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const text = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? key;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export const t = (locale: Locale, key: string, vars?: Record<string, string | number>) => translate(CATALOGS, locale, key, vars);

/** the language of a page, from its address: /fr/… is French. (Astro's own i18n routing is not used: Starlight refuses it beside its docs, which stay English; the pages/[...lang]/ segment does the same job.) */
export const localeOf = (pathname: string): Locale => (pathname === '/fr' || pathname.startsWith('/fr/') ? 'fr' : 'en');

/** an address of the site in a language: French pages live under /fr/; the docs (English only) and other sites do not move */
export function pathIn(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE || !path.startsWith('/') || path === '/docs' || path.startsWith('/docs/')) return path;
  return `/fr${path}`;
}

/** the address of the current page in a language, from its address in any */
export function pathFor(locale: Locale, current: string): string {
  const bare = current === '/fr' || current.startsWith('/fr/') ? current.slice(3) || '/' : current;
  return pathIn(locale, bare);
}

/** getStaticPaths of every page that exists in both languages (pages/[...lang]/) */
export const localePaths = () => LOCALES.map((l) => ({ params: { lang: l === DEFAULT_LOCALE ? undefined : l } }));
