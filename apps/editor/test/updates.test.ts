// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { APP_VERSION, isNewer, parseRelease, checkForUpdate, isDue, autoCheck, update, osOf, downloadOf } = await import('../src/version.ts');
const { prefs, setPrefs } = await import('../src/settings.ts');
const { S } = await import('../src/state.ts');

const release = (tag: string, extra: object = {}) => new Response(JSON.stringify({ tag_name: tag, html_url: `https://example.test/releases/${tag}`, body: 'notes', draft: false, prerelease: false, ...extra }), { status: 200 });

beforeEach(() => { setPrefs({ checkUpdates: true, lastUpdateCheck: 0, updateNotified: '' }); update.value = null; S.toasts.value = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the version', () => {
  it('is a semantic version', () => { expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/); });

  it('compares versions by number, not by text, and ignores a leading v', () => {
    expect(isNewer('0.16.0', '0.15.1')).toBe(true);
    expect(isNewer('0.15.10', '0.15.9')).toBe(true);
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.15.1', '0.15.1')).toBe(false);
    expect(isNewer('0.15.0', '0.15.1')).toBe(false);
    expect(isNewer('nonsense', '0.15.1')).toBe(false);
  });

  it('reads a release: its version, address and notes; a draft or a prerelease is none', () => {
    expect(parseRelease({ tag_name: 'v0.16.0', html_url: 'https://x/y', body: 'n' })).toEqual({ version: '0.16.0', url: 'https://x/y', notes: 'n', assets: [] });
    expect(parseRelease({ tag_name: 'v0.16.0', html_url: 'https://x/y', prerelease: true })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.16.0', draft: true })).toBeNull();
    expect(parseRelease({ nothing: 1 })).toBeNull();
  });
});

describe('the download of an update', () => {
  const assets = [{ name: 'tramme-windows-x64-setup.exe', browser_download_url: 'https://dl/win.exe' }, { name: 'tramme-macos-universal.dmg', browser_download_url: 'https://dl/mac.dmg' }, { name: 'tramme-linux-x86_64.AppImage', browser_download_url: 'https://dl/linux.AppImage' }, { name: 'notes.txt', browser_download_url: 'https://dl/notes' }];
  const found = parseRelease({ tag_name: 'v1.0.0', html_url: 'https://page', assets })!;

  it('reads the computer from its user agent: a phone is none', () => {
    expect(osOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(osOf('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(osOf('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBeNull();
    expect(osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBeNull();
  });

  it('is the installer of this system on the release when there is one: the file starts to download', () => {
    expect(downloadOf(found, 'Mozilla/5.0 (Windows NT 10.0)')).toEqual({ href: 'https://dl/win.exe', direct: true });
    expect(downloadOf(found, 'Mozilla/5.0 (Macintosh)')).toEqual({ href: 'https://dl/mac.dmg', direct: true });
  });

  it('is the release page when the system has none, the release holds no such file, or this is a phone', () => {
    expect(downloadOf({ ...found, assets: [] }, 'Mozilla/5.0 (Windows NT 10.0)')).toEqual({ href: 'https://page', direct: false });
    expect(downloadOf(found, 'Mozilla/5.0 (Linux; Android 14)')).toEqual({ href: 'https://page', direct: false });
  });
});

describe('looking for an update', () => {
  it('gives the newer release, and null when the app is up to date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => release('v99.0.0')));
    expect(await checkForUpdate()).toMatchObject({ version: '99.0.0' });
    vi.stubGlobal('fetch', vi.fn(async () => release(`v${APP_VERSION}`)));
    expect(await checkForUpdate()).toBeNull();
  });

  it('fails with a sentence when GitHub does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    await expect(checkForUpdate()).rejects.toThrow(/503/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(checkForUpdate()).rejects.toThrow(/offline/);
  });
});

describe('the automatic look', () => {
  it('is due twelve hours after the last, never when turned off', () => {
    const now = 1_000_000_000_000;
    expect(isDue(now, 0, true)).toBe(true);
    expect(isDue(now, now - 11 * 3600_000, true)).toBe(false);
    expect(isDue(now, now - 13 * 3600_000, true)).toBe(true);
    expect(isDue(now, 0, false)).toBe(false);
  });

  it('notes the day it looked, keeps the update and tells the user once per version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => release('v99.0.0')));
    await autoCheck();
    expect(update.value?.version).toBe('99.0.0');
    expect(prefs.peek().lastUpdateCheck).toBeGreaterThan(0);
    expect(S.toasts.value).toHaveLength(1);
    // twelve hours later, the same version: kept, not told again
    setPrefs({ lastUpdateCheck: 1 });
    await autoCheck();
    expect(S.toasts.value).toHaveLength(1);
    expect(prefs.peek().updateNotified).toBe('99.0.0');
  });

  it('does not look when it is not due, or when turned off', async () => {
    const fetchMock = vi.fn(async () => release('v99.0.0'));
    vi.stubGlobal('fetch', fetchMock);
    setPrefs({ lastUpdateCheck: Date.now() });
    await autoCheck();
    setPrefs({ lastUpdateCheck: 0, checkUpdates: false });
    await autoCheck();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says nothing and notes the failure quietly when offline: the next look is tried again later', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await autoCheck();
    expect(S.toasts.value).toHaveLength(0);
    expect(update.value).toBeNull();
    expect(prefs.peek().lastUpdateCheck).toBe(0);
  });
});

describe('the about pane of the settings', () => {
  it('shows the version, finds an update on demand and offers the release', async () => {
    const { h, render } = await import('preact');
    const { act } = await import('preact/test-utils');
    await import('../src/ai/index.ts');
    const { SettingsDialog } = await import('../src/ui/Settings.tsx');
    const { openSettings } = await import('../src/settings.ts');
    vi.stubGlobal('fetch', vi.fn(async () => release('v99.0.0')));
    const host = document.createElement('div');
    document.body.appendChild(host);
    openSettings('about');
    await act(() => { render(h(SettingsDialog, {}), host); });
    expect(host.textContent).toContain(APP_VERSION);
    const check = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check now')!;
    await act(async () => { check.click(); await new Promise((r) => setTimeout(r, 10)); });
    expect(update.value?.version).toBe('99.0.0');
    expect(host.textContent).toContain('Version 99.0.0 is available');
    // the release has no installers here: the link goes to its page
    expect(host.querySelector('a[href^="https://example.test/releases/v99.0.0"]')).toBeTruthy();
    render(null, host);
  });
});
