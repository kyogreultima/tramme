import { beforeEach, describe, expect, it, vi } from 'vitest';

/** a page at an address, with the little of the browser the router uses */
function page(url: string) {
  const u = new URL(url);
  const loc = { origin: u.origin, href: u.href, pathname: u.pathname, search: u.search, assign: vi.fn() };
  const history = {
    pushState: vi.fn((_: unknown, __: string, to: string) => { const n = new URL(to, loc.href); Object.assign(loc, { href: n.href, pathname: n.pathname, search: n.search }); }),
    replaceState: vi.fn((_: unknown, __: string, to: string) => { const n = new URL(to, loc.href); Object.assign(loc, { href: n.href, pathname: n.pathname, search: n.search }); }),
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', history);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('addEventListener', (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; });
  vi.stubGlobal('document', { addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[`doc:${type}`] = fn; } });
  return { loc, history, listeners };
}

const load = async () => { vi.resetModules(); return import('../src/router.ts'); };
beforeEach(() => { vi.unstubAllGlobals(); });

describe('the pages that change without a load', () => {
  it('are the home page and the pages of the account, and not a project', async () => {
    page('http://localhost:8787/');
    const { SPA_PATHS, isSpaUrl } = await load();
    expect([...SPA_PATHS].sort()).toEqual(['/', '/forgot', '/login', '/signup', '/space']);
    for (const url of ['/', '/login', '/signup?prompt=a', '/space/', 'http://localhost:8787/forgot', '/login#top']) expect(isSpaUrl(url), url).toBe(true);
    for (const url of ['/p/abc-123', '/api/auth/github/redirect', 'https://tramme.dev/terms/', 'http://localhost:8790/login', '/assets/main.js']) expect(isSpaUrl(url), url).toBe(false);
  });

  it('are changed by navigating: the address moves, the page follows, nothing loads', async () => {
    const { history, loc } = page('http://localhost:8787/login');
    const { navigate, route } = await load();
    navigate('/signup?prompt=A%20film');
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(loc.pathname + loc.search).toBe('/signup?prompt=A%20film');
    expect(route.value).toEqual({ path: '/signup', search: '?prompt=A%20film' });
    expect(loc.assign).not.toHaveBeenCalled();
  });

  it('does not add a step to the history for the page already shown', async () => {
    const { history } = page('http://localhost:8787/space');
    const { navigate } = await load();
    navigate('/space');
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('can replace the address instead of adding to the history', async () => {
    const { history, loc } = page('http://localhost:8787/?prompt=a');
    const { navigate, route } = await load();
    navigate('/', true);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.pushState).not.toHaveBeenCalled();
    expect(loc.search).toBe('');
    expect(route.value.path).toBe('/');
  });

  it('follow the back button', async () => {
    const { loc, listeners } = page('http://localhost:8787/login');
    const { route, startRouter } = await load();
    startRouter();
    Object.assign(loc, { pathname: '/', search: '', href: 'http://localhost:8787/' });
    listeners.popstate({});
    expect(route.value).toEqual({ path: '/', search: '' });
  });
});

describe('a click on a link', () => {
  const click = (listeners: Record<string, (e: unknown) => void>, href: string, attrs: Record<string, string> = {}, event: Record<string, unknown> = {}) => {
    const a = { getAttribute: (n: string) => (n === 'href' ? href : attrs[n] ?? null), hasAttribute: (n: string) => n in attrs };
    const e = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: Object.assign(Object.create(Element.prototype), { closest: () => a }), preventDefault: vi.fn(), ...event };
    listeners['doc:click'](e);
    return e;
  };

  async function started() {
    const env = page('http://localhost:8787/login');
    vi.stubGlobal('Element', class {});
    const mod = await load();
    mod.startRouter();
    return { ...env, ...mod };
  }

  it('to one of these pages is taken: no load', async () => {
    const { listeners, history } = await started();
    const e = click(listeners, '/signup');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(history.pushState).toHaveBeenCalled();
  });

  it('to anything else is left to the browser', async () => {
    const { listeners } = await started();
    for (const href of ['/p/abc-123', '/api/auth/github/redirect', 'https://tramme.dev/terms/']) expect(click(listeners, href).preventDefault, href).not.toHaveBeenCalled();
  });

  it('meant for another tab, or with a key held, is left to the browser', async () => {
    const { listeners } = await started();
    expect(click(listeners, '/signup', { target: '_blank' }).preventDefault).not.toHaveBeenCalled();
    expect(click(listeners, '/signup', { download: '' }).preventDefault).not.toHaveBeenCalled();
    expect(click(listeners, '/signup', {}, { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(click(listeners, '/signup', {}, { metaKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(click(listeners, '/signup', {}, { button: 1 }).preventDefault).not.toHaveBeenCalled();
  });
});

describe('the editor\'s links to the website', () => {
  it('open in a tab of their own', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(import.meta.dirname, '../src/ui');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      for (const tag of fs.readFileSync(path.join(dir, file), 'utf8').match(/<a\b[^>]*>/g) ?? []) {
        if (/href=(?:"https?:|\{(?:TERMS|SITE_URL))/.test(tag)) expect(tag, `${file}: ${tag}`).toMatch(/target="_blank" rel="noopener/);
      }
    }
  });
});
