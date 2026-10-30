// The app's version, and the look for a newer one: GitHub's latest release of
// the project, asked on its own every twelve hours (and on demand from the
// settings). A newer version is kept for the settings and the home page, and
// the user is told once per version. Nothing is downloaded or installed: the
// release's page is where the installers are.

import { signal } from '@preact/signals';
import pkg from '../package.json' with { type: 'json' };
import { INSTALLERS, type Os } from '../../desktop/downloads.ts';
import { prefs, setPrefs } from './settings.ts';
import { toast } from './state.ts';
import { t } from './i18n/index.ts';

/** the version this build was made at (the editor's own package, set with the others by scripts/version.ts) */
export const APP_VERSION: string = pkg.version;

/** where the releases are published */
export const REPO_NAME = 'kyogreultima/tramme';
export const RELEASES_URL = `https://github.com/${REPO_NAME}/releases/latest`;

export interface Update { version: string; url: string; notes: string; /** the files of the release, by name */ assets: { name: string; url: string }[] }

/** the system a user agent runs on, among those the app is built for; null for a phone or anything else */
export function osOf(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): Os | null {
  if (/android|iphone|ipad|ipod/i.test(ua)) return null;
  return /windows/i.test(ua) ? 'windows' : /macintosh|mac os x/i.test(ua) ? 'mac' : /linux|x11/i.test(ua) ? 'linux' : null;
}

/** where the Download button of an update goes: the installer of this system on the release, which starts to download; else the release's page */
export function downloadOf(u: Update, ua?: string): { href: string; direct: boolean } {
  const os = osOf(ua);
  const file = os ? INSTALLERS.find((i) => i.os === os) : undefined;
  const asset = file && u.assets.find((a) => a.name === file.file);
  return asset ? { href: asset.url, direct: true } : { href: u.url, direct: false };
}

/** the newer version found, or null */
export const update = signal<Update | null>(null);

const parts = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())?.slice(1).map(Number);

/** whether `a` is a later version than `b` (numbers, left to right; anything that is not a version is not later) */
export function isNewer(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** a release as GitHub gives it, or null for a draft, a prerelease or something that is not one */
export function parseRelease(j: unknown): Update | null {
  const r = j as { tag_name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown } | null;
  if (!r || typeof r.tag_name !== 'string' || r.draft || r.prerelease || !parts(r.tag_name)) return null;
  return { version: r.tag_name.replace(/^v/, ''), url: typeof r.html_url === 'string' ? r.html_url : RELEASES_URL, notes: typeof r.body === 'string' ? r.body : '',
    assets: (Array.isArray(r.assets) ? r.assets : []).flatMap((a: { name?: unknown; browser_download_url?: unknown }) => (typeof a?.name === 'string' && typeof a.browser_download_url === 'string' ? [{ name: a.name, url: a.browser_download_url }] : [])) };
}

/** the latest release when it is newer than this app, else null; throws a sentence when it cannot be asked */
export async function checkForUpdate(current = APP_VERSION): Promise<Update | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO_NAME}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
  } catch (e) { throw new Error(t('update.unreachable', { error: (e as Error).message })); }
  if (!res.ok) throw new Error(t('update.unreachable', { error: `HTTP ${res.status}` }));
  const latest = parseRelease(await res.json().catch(() => null));
  return latest && isNewer(latest.version, current) ? latest : null;
}

/** the automatic look is due twelve hours after the last one, when it is turned on */
export const isDue = (now: number, last: number, on: boolean) => on && now - last >= 12 * 3600_000;

/** looks for an update when it is due: the day is noted, the update kept, the user told once per version; a failure is silent and tried again later */
export async function autoCheck(): Promise<void> {
  const { checkUpdates, lastUpdateCheck, updateNotified } = prefs.peek();
  if (!isDue(Date.now(), lastUpdateCheck, checkUpdates)) return;
  try {
    const found = await checkForUpdate();
    setPrefs({ lastUpdateCheck: Date.now() });
    update.value = found;
    if (found && found.version !== updateNotified) {
      setPrefs({ updateNotified: found.version });
      toast(t('update.available', { version: found.version }), 'info', 9000);
    }
  } catch { /* offline, or GitHub busy: nothing to say, the next start tries again */ }
}
