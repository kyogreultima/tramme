// Moving between the editor's own pages without loading it again: the home page
// and the pages of the account (/login, /signup, /forgot, /space). A project
// (/p/<id>) is not one of them: the editor of a film starts its engine from
// nothing, so it is a page of its own, loaded whole.
//
// `go` (nav.ts) takes this way for these addresses, and a click on a link to
// one of them is taken here too, so that plain links in the pages work as they
// are written. The back and forward buttons follow.

import { signal } from '@preact/signals';

/** the pages that change without a load */
export const SPA_PATHS: ReadonlySet<string> = new Set(['/', '/login', '/signup', '/forgot', '/space']);

export const normalize = (path: string): string => path.replace(/\/+$/, '') || '/';

export interface Route { path: string; search: string }

const here = (): Route => (typeof location === 'undefined' ? { path: '/', search: '' } : { path: normalize(location.pathname), search: location.search });

/** the page being shown */
export const route = signal<Route>(here());

let started = false;

/** whether an address is one of these pages, on this origin */
export function isSpaUrl(url: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin && SPA_PATHS.has(normalize(u.pathname));
  } catch { return false; }
}

/** to another of these pages: the address changes, the page is drawn, nothing is loaded */
export function navigate(url: string, replace = false): void {
  const u = new URL(url, location.href);
  const next = { path: normalize(u.pathname), search: u.search };
  if (replace) history.replaceState(null, '', u.pathname + u.search + u.hash);
  else if (u.pathname + u.search !== location.pathname + location.search) history.pushState(null, '', u.pathname + u.search + u.hash);
  route.value = next;
  if (!replace) scrollTo(0, 0);
}

/** a click on a link to one of these pages, without a modifier and not meant for another tab, is taken here */
function intercept(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || a.getAttribute('target') || a.hasAttribute('download') || !isSpaUrl(a.getAttribute('href')!)) return;
  e.preventDefault();
  navigate(a.getAttribute('href')!);
}

/** from now on these pages change without a load */
export function startRouter(): void {
  if (started) return;
  started = true;
  route.value = here();
  addEventListener('popstate', () => { route.value = here(); });
  document.addEventListener('click', intercept);
}

export const routerStarted = () => started;
