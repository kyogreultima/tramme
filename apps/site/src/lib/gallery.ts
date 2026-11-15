// The community's public projects, as the site reads them: through listProjects
// and getProject only. They are the films published in the app's gallery
// (GET /api/gallery of the app of this environment, apps/worker/src/gallery.ts),
// read when a page is asked, and the repository's examples, credited to
// "Tramme". An app without a gallery (no accounts) leaves the examples alone.
// No view count is invented: `views` stays unset until it is real.

import { IDS, example } from './examples';
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

const files = import.meta.glob<string>('../videos/*.{webm,mp4,webp}', { eager: true, query: '?url', import: 'default' });
const file = (id: string, ext: string): string | undefined => files[`../videos/${id}.${ext}`];

/** what each example says of itself, and the day it was published */
const SEED: Record<(typeof IDS)[number], { description: string; publishedAt: string }> = {
  'launch-film': { description: '45 seconds cut on the beat: compositions inside compositions, a 2.5D camera, motion that follows the music.', publishedAt: '2026-10-03' },
  anime: { description: 'A paper plane at sunset in four shots, drawn frame by frame: clouds lit from the side, the plane banking, wires and a town.', publishedAt: '2026-10-02' },
  showreel: { description: 'Made by the assistant: kinetic type, shapes, a counter, smoke and a camera look.', publishedAt: '2026-10-01' },
};

const seed: PublicProject[] = IDS.map((id) => {
  const ex = example(id);
  return {
    id,
    title: ex.name,
    description: SEED[id].description,
    author: { name: 'Tramme', handle: 'tramme' },
    video: { mp4: file(id, 'mp4'), webm: file(id, 'webm') },
    poster: file(id, 'webp'),
    width: ex.width,
    height: ex.height,
    duration: ex.duration,
    reusable: true,
    publishedAt: SEED[id].publishedAt,
  };
});

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
  const sorted = [...published, ...seed].sort(sort === 'popular' ? byViews : byDate);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export async function getProject(id: string): Promise<PublicProject | undefined> {
  const shipped = seed.find((p) => p.id === id);
  if (shipped) return shipped;
  if (!/^[a-z0-9]{12}$/.test(id)) return undefined;
  const p = await fromApp<PublicProject>(`/api/gallery/${id}`);
  return p ? whole(p) : undefined;
}
