// The gallery from the editor: a film just exported published with its still
// and the project's archive (the Worker's gallery.ts keeps them), taken off,
// and a published film copied into one's own projects (?remix=<id>).

import type { Manifest } from '@tramme/project';
import { api, ApiError } from './api.ts';
import { importArchive, type Progress } from './importer.ts';
import { preview } from './preview.ts';
import { SITE_URL } from './site.ts';

export interface Published { id: string; project: string; visibility: 'public' | 'unlisted'; title: string; description: string; reusable: boolean }

export interface PublishInput {
  projectId: string;
  video: Blob;
  title: string;
  description: string;
  visibility: 'public' | 'unlisted';
  reusable: boolean;
  width: number;
  height: number;
  duration: number;
}

const mine = (path = '') => `/api/gallery/mine${path}`;

async function sent(r: Response): Promise<Response> {
  if (r.ok) return r;
  let body: { error?: string } = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`);
}

/** what this person published, by project */
export async function myFilms(): Promise<Published[]> {
  try { return (await (await sent(await fetch(mine()))).json()) as Published[]; } catch { return []; }
}

/** a film published (or published again): its still taken in the middle, the project's archive when it may be copied */
export async function publish(input: PublishInput, step: (what: 'still' | 'archive' | 'upload') => void): Promise<{ id: string; url: string }> {
  const at = (file: string) => mine(`/${encodeURIComponent(input.projectId)}/${file}`);
  step('still');
  const still = await preview.thumbnail(input.duration / 2, 1280);
  if (!still) throw new Error('no still');
  step('archive');
  const archive = input.reusable ? await (await sent(await fetch(api.exportUrl(input.projectId)))).blob() : null;
  step('upload');
  await sent(await fetch(at('video.mp4'), { method: 'PUT', body: input.video }));
  await sent(await fetch(at('poster.webp'), { method: 'PUT', body: still }));
  if (archive) await sent(await fetch(at('project.tramme'), { method: 'PUT', body: archive }));
  const { title, description, visibility, reusable, width, height, duration } = input;
  const meta = { title, description, visibility, reusable, width, height, duration };
  const film = (await (await sent(await fetch(mine(`/${encodeURIComponent(input.projectId)}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) }))).json()) as { id: string };
  return { id: film.id, url: filmUrl(film.id) };
}

/** a film taken off the gallery */
export async function unpublish(projectId: string) {
  await sent(await fetch(mine(`/${encodeURIComponent(projectId)}`), { method: 'DELETE' }));
}

/** where a published film is shown, on the site */
export const filmUrl = (id: string) => `${SITE_URL}/p/${encodeURIComponent(id)}/`;

/** a published film copied into this person's projects: its code is asked about, as any project from someone else */
export async function remix(id: string, progress?: Progress): Promise<Manifest> {
  const r = await sent(await fetch(`/api/gallery/${encodeURIComponent(id)}/project.tramme`));
  return importArchive(await r.blob(), progress);
}
