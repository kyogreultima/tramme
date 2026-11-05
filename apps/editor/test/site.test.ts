import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** the editor's link to the site, as the page at this address would compute it */
async function siteAt(origin: string | null): Promise<string> {
  if (origin) vi.stubGlobal('location', { origin });
  vi.resetModules();
  return (await import('../src/site.ts')).SITE_URL;
}

describe('the editor\'s link to the website', () => {
  it('is the local site on any localhost, however the editor was built', async () => {
    expect(await siteAt('http://localhost:8787')).toBe('http://localhost:4321');
    expect(await siteAt('http://localhost:8790')).toBe('http://localhost:4321');
    expect(await siteAt('http://127.0.0.1:8787')).toBe('http://localhost:4321');
  });

  it('is the site of the environment the app is served from', async () => {
    expect(await siteAt('https://app.tramme.dev')).toBe('https://tramme.dev');
    expect(await siteAt('https://app.preprod.tramme.dev')).toBe('https://preprod.tramme.dev');
    expect(await siteAt('https://beta.app.tramme.dev')).toBe('https://beta.tramme.dev');
  });

  it('falls back on what the editor was built for at an address nobody knows', async () => {
    vi.stubGlobal('__TRAMME_SITE__', 'https://branch.example');
    expect(await siteAt('https://some-branch.pages.dev')).toBe('https://branch.example');
  });

  it('is the public site where there is no page at all (the tests, a worker)', async () => {
    expect(await siteAt(null)).toBe('https://tramme.dev');
  });
});
