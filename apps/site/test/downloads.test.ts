import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTALLERS, OFFERED_INSTALLERS, OFFERED_SYSTEMS, SYSTEMS, WITHHELD, systemsLine } from '../../desktop/downloads';
import { faq } from '../src/lib/faq';
import { menus } from '../src/lib/nav';
import { LOCALES } from '../src/lib/i18n';
import { read } from './sources';

afterEach(() => vi.unstubAllGlobals());

describe('the systems the app is offered for', () => {
  it('leave macOS out while its app cannot be installed (it is not signed)', () => {
    expect(WITHHELD).toEqual(['mac']);
    expect(OFFERED_SYSTEMS).toEqual(['windows', 'linux', 'android']);
    expect(OFFERED_INSTALLERS.map((i) => i.os)).toEqual(['windows', 'linux', 'linux', 'android']);
  });

  it('are still all built: the release carries every installer, so that offering one again is a change of one line', () => {
    expect(INSTALLERS.some((i) => i.os === 'mac')).toBe(true);
    expect(Object.keys(SYSTEMS)).toEqual(['windows', 'mac', 'linux', 'android']);
  });

  it('are named in a line, in each language', () => {
    expect(systemsLine('en')).toBe('Windows, Linux and Android');
    expect(systemsLine('fr')).toBe('Windows, Linux et Android');
  });
});

describe('the Android app', () => {
  it('is the signed .apk of the release, under its stable name, named by the CI that built it', () => {
    expect(OFFERED_INSTALLERS.some((i) => i.file === 'tramme-android.apk')).toBe(true);
    const apk = INSTALLERS.find((i) => i.os === 'android')!;
    expect(apk).toMatchObject({ suffix: '.apk', kind: 'APK', built: '' });
    expect(SYSTEMS.android).toBe('Android');
  });
});

describe('the release the site offers', () => {
  it('has no macOS installer, even when GitHub\'s release has one', async () => {
    const assets = INSTALLERS.map((i) => ({ name: i.file, size: 1_000_000 }));
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ tag_name: 'v1.2.3', html_url: 'https://example.test/r', assets }), { status: 200 }));
    const { latestRelease } = await import('../src/lib/download');
    const release = await latestRelease(() => {});
    expect(release?.installers.map((i) => i.os)).toEqual(['windows', 'linux', 'linux', 'android']);
    expect(release?.installers.every((i) => !/macos|\.dmg/i.test(i.href))).toBe(true);
  });
});

describe('the release the beta site offers', () => {
  const assets = INSTALLERS.map((i) => ({ name: i.file, size: 1_000_000 }));
  const release = (tag: string, over: object = {}) => ({ tag_name: tag, html_url: `https://example.test/${tag}`, assets, draft: false, prerelease: false, ...over });
  const serve = (list: unknown[], latest: unknown) => vi.stubGlobal('fetch', async (url: string) => (String(url).endsWith('/releases/latest')
    ? new Response(JSON.stringify(latest), { status: 200 })
    : new Response(JSON.stringify(list), { status: 200 })));

  it('is the latest prerelease, reached by its tag, not GitHub\'s "latest"', async () => {
    serve([release('v1.3.0-beta.7', { prerelease: true }), release('v1.3.0-beta.6', { prerelease: true }), release('v1.2.3')], release('v1.2.3'));
    const { latestRelease } = await import('../src/lib/download');
    const found = await latestRelease(() => {}, 'beta');
    expect(found?.version).toBe('1.3.0-beta.7');
    expect(found?.installers.every((i) => i.href.includes('/releases/download/v1.3.0-beta.7/'))).toBe(true);
  });

  it('skips a draft and a prerelease with no installer', async () => {
    serve([release('v1.3.0-beta.9', { prerelease: true, draft: true }), release('v1.3.0-beta.8', { prerelease: true, assets: [] }), release('v1.3.0-beta.5', { prerelease: true })], release('v1.2.3'));
    const { latestRelease } = await import('../src/lib/download');
    expect((await latestRelease(() => {}, 'beta'))?.version).toBe('1.3.0-beta.5');
  });

  it('is the latest release while there is no beta build yet', async () => {
    serve([release('v1.2.3')], release('v1.2.3'));
    const { latestRelease } = await import('../src/lib/download');
    const found = await latestRelease(() => {}, 'beta');
    expect(found?.version).toBe('1.2.3');
    expect(found?.installers.every((i) => i.href.includes('/releases/latest/download/'))).toBe(true);
  });

  it('is never offered by the stable site, which keeps GitHub\'s latest release', async () => {
    serve([release('v1.3.0-beta.7', { prerelease: true })], release('v1.2.3'));
    const { latestRelease } = await import('../src/lib/download');
    expect((await latestRelease(() => {}))?.version).toBe('1.2.3');
  });
});

describe('what the site says of the systems', () => {
  it('names only the ones it offers', () => {
    for (const locale of LOCALES) {
      const hint = menus(locale).flatMap((m) => m.links).find((l) => l.href.endsWith('/download/'))?.hint;
      expect(hint, `${locale} menu`).toMatch(/Windows/);
      expect(hint, `${locale} menu`).not.toMatch(/mac/i);
      const answer = faq(locale).find((f) => /Windows/.test(f.a))?.a ?? '';
      expect(answer, `${locale} faq`).toMatch(/Windows/);
      expect(answer, `${locale} faq`).not.toMatch(/macOS/);
    }
  });

  it('writes the download page and llms.txt from the same line', () => {
    expect(read('pages/[...lang]/download.astro')).toContain('systemsLine');
    expect(read('pages/llms.txt.ts')).toContain('systemsLine');
  });

  it('tells a visitor on a Mac why there is no app for them, and where to go instead', () => {
    const page = read('pages/[...lang]/download.astro');
    expect(page).toContain("data-os='mac'");
    expect(page).toContain('mac-note');
  });
});
