// The desktop app, as the site offers it: the installers of a release on
// GitHub (.github/workflows/desktop.yml, and desktop-beta.yml for the beta),
// looked up once at each site build (astro.config.mjs) and handed to the pages
// as __RELEASE__. Production offers the latest release, under GitHub's address
// of "latest" with each file's stable name (apps/desktop/downloads.ts), so a
// newer release is offered before the site is built again. The beta offers its
// own latest build, a prerelease, by its tag; with none yet it offers the
// latest release. Without a release, or with GitHub out of reach, the links
// stay out and the download page says so.

import { OFFERED_INSTALLERS, type Installer } from '../../../desktop/downloads.ts';
import { REPO, REPO_NAME } from './links';

export interface Offered extends Installer {
  href: string;
  /** in bytes */
  size: number;
}

export interface Release {
  version: string;
  /** the release's page, with its notes */
  page: string;
  installers: Offered[];
}

interface GitHubRelease { tag_name: string; html_url: string; assets: { name: string; size: number }[]; draft?: boolean; prerelease?: boolean }

/** which releases a site offers: the stable ones, or the beta's latest build */
export type Channel = 'stable' | 'beta';

const hasInstaller = (r: GitHubRelease) => r.assets.some((a) => OFFERED_INSTALLERS.some((i) => i.file === a.name));

export async function latestRelease(log: (s: string) => void, channel: Channel = 'stable'): Promise<Release | null> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'tramme-site' };
  // GitHub's limit without a token is 60 requests an hour per address
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const get = (path: string) => fetch(`https://api.github.com/repos/${REPO_NAME}/${path}`, { headers, signal: AbortSignal.timeout(10_000) });
  try {
    let release: GitHubRelease | undefined;
    let beta = false;
    // the release a workflow has just published (desktop.yml, desktop-beta.yml), read by its tag: GitHub's list
    // and its "latest" can still show the one before for a minute, and the site would offer that one
    const tag = process.env.RELEASE_TAG;
    if (tag) {
      const r = await get(`releases/tags/${encodeURIComponent(tag)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} for the release ${tag}`);
      const just = (await r.json()) as GitHubRelease;
      if (!just.draft && hasInstaller(just) && Boolean(just.prerelease) === (channel === 'beta')) {
        release = just;
        beta = channel === 'beta';
      }
    }
    if (!release && channel === 'beta') {
      // the newest first: the latest prerelease that carries an installer
      const r = await get('releases?per_page=30');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      release = ((await r.json()) as GitHubRelease[]).find((x) => !x.draft && x.prerelease && hasInstaller(x));
      beta = release !== undefined;
      if (!release) log('site: no beta build of the desktop app yet: the latest release is offered');
    }
    if (!release) {
      const r = await get('releases/latest');
      if (r.status === 404) {
        log('site: no release of the desktop app yet: the download links are left out');
        return null;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      release = (await r.json()) as GitHubRelease;
    }
    // a beta build is reached by its tag, "latest" being the stable release
    const base = beta ? `${REPO}/releases/download/${release.tag_name}` : `${REPO}/releases/latest/download`;
    const installers = OFFERED_INSTALLERS.flatMap((i): Offered[] => {
      const asset = release.assets.find((a) => a.name === i.file);
      return asset ? [{ ...i, href: `${base}/${i.file}`, size: asset.size }] : [];
    });
    if (!installers.length) {
      log(`site: the release ${release.tag_name} has no installer: the download links are left out`);
      return null;
    }
    return { version: release.tag_name.replace(/^v/, ''), page: release.html_url, installers };
  } catch (e) {
    log(`site: the latest release could not be read (${(e as Error).message}): the download links are left out`);
    return null;
  }
}
