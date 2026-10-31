// The community's public projects, as the site reads them: through listProjects
// and getProject only. Today they are the repository's examples, credited to
// "Tramme"; when the gallery API exists these two functions call it and
// nothing else changes (the shape is the contract, point 2 of the platform
// spec). No view count is invented: `views` stays unset until it is real.

import { IDS, example } from './examples';

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
  anime: { description: 'Frame-by-frame drawings on an exposure sheet, in three shots.', publishedAt: '2026-10-02' },
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

/** the public projects, most recent first (or most viewed, once views are counted) */
export async function listProjects({ sort = 'recent', limit }: ListOptions = {}): Promise<PublicProject[]> {
  const byDate = (a: PublicProject, b: PublicProject) => b.publishedAt.localeCompare(a.publishedAt);
  const byViews = (a: PublicProject, b: PublicProject) => (b.views ?? 0) - (a.views ?? 0) || byDate(a, b);
  const sorted = [...seed].sort(sort === 'popular' ? byViews : byDate);
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export async function getProject(id: string): Promise<PublicProject | undefined> {
  return seed.find((p) => p.id === id);
}
