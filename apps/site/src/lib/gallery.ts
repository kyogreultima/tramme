// The community's public projects, as the site reads them: through listProjects
// and getProject only. They are the films published in the app's gallery
// (GET /api/gallery of the app of this environment, apps/worker/src/gallery.ts),
// read when a page is asked; nothing else is shown, so an app without a gallery
// (no accounts) or that does not answer leaves the gallery empty.
// No view count is invented: `views` stays unset until it is real.

import { APP } from './links';

export interface PublicProject {
  id: string;
  title: string;
  description: string;
  author: { name: string; handle: string; avatar?: string };
  video: { mp4?: string; webm?: string };
  /** a still of the film */
  poster?: string;
  width: number;
  height: number;
  duration: number;
  /** whether "Open in Tramme" copies the project's .tramme */
  reusable: boolean;
  /** ISO date */
  publishedAt: string;
  views?: number;
}

export interface ListOptions { sort?: 'recent' | 'popular'; limit?: number }

/** the app's answer, its files' addresses made whole; null when the app has no gallery or does not answer */
async function fromApp<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${APP}${path}`, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch { return null; }
}

/** a published film with its files at the app's address */
const whole = (p: PublicProject): PublicProject => {
  const at = (u?: string) => (u && u.startsWith('/') ? `${APP}${u}` : u);
  return { ...p, video: { mp4: at(p.video.mp4), webm: at(p.video.webm) }, poster: at(p.poster) };
};

/** the public projects, most recent first (or most viewed, once views are counted) */
export async function listProjects({ sort = 'recent', limit }: ListOptions = {}): Promise<PublicProject[]> {
  const byDate = (a: PublicProject, b: PublicProject) => b.publishedAt.localeCompare(a.publishedAt);
  const byViews = (a: PublicProject, b: PublicProject) => (b.views ?? 0) - (a.views ?? 0) || byDate(a, b);
  const published = ((await fromApp<PublicProject[]>('/api/gallery?limit=200')) ?? []).map(whole);
  const sorted = published.sort(sort === 'popular' ? byViews : byDate);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export async function getProject(id: string): Promise<PublicProject | undefined> {
  if (!/^[a-z0-9]{12}$/.test(id)) return undefined;
  const p = await fromApp<PublicProject>(`/api/gallery/${id}`);
  return p ? whole(p) : undefined;
}
