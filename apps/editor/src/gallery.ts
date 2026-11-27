// The gallery from the editor: a film just exported published with its still
// and the project's archive (the Worker's gallery.ts keeps them), taken off,
// and a published film copied into one's own projects (?remix=<id>).

import { GALLERY_FILE_LIMIT } from '@tramme/api';
import type { Manifest } from '@tramme/project';
import { api, ApiError } from './api.ts';
import { cloudId } from './bring.ts';
import { importArchive, type Progress } from './importer.ts';
import { preview } from './preview.ts';
import { SITE_URL } from './site.ts';
import { t } from './i18n/index.ts';

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

/** the name a project is published under: the account's, so a film published from the desktop app and from the web is one film */
export const publishedAs = (projectId: string) => cloudId(projectId);

/** what is still missing before a film can be published, the first thing first; null where there is no gallery */
export function galleryNeeds(status: 'unknown' | 'unavailable' | 'out' | 'in', format: string, exported: string | null): 'account' | 'mp4' | 'export' | 'ready' | null {
  if (status === 'unknown' || status === 'unavailable') return null;
  if (status === 'out') return 'account';
  if (exported !== null && canPublishExport(exported, true)) return 'ready';
  return format.startsWith('mp4') ? 'export' : 'mp4';
}

/** The gallery accepts an exported MP4 once an account session can own it. */
export const canPublishExport = (name: string, signedIn: boolean): boolean =>
  signedIn && name.toLowerCase().endsWith('.mp4');

async function sent(r: Response): Promise<Response> {
  if (r.ok) return r;
  let body: { error?: string } = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`);
}

/** what this person published, by project */
export async function myFilms(): Promise<Published[]> {
  return (await (await sent(await fetch(mine()))).json()) as Published[];
}

/**
 * A film published (or published again): its still taken in the middle, the
 * project's archive when it may be copied. The gallery takes files of
 * GALLERY_FILE_LIMIT at most: a film larger than that is refused before
 * anything is sent; an archive larger than that (the project's own footage)
 * stays home, the film is published without it, and `warnings` says so.
 */
export async function publish(input: PublishInput, step: (what: 'still' | 'archive' | 'upload') => void): Promise<{ id: string; url: string; warnings: string[] }> {
  const project = encodeURIComponent(publishedAs(input.projectId)), at = (file: string) => mine(`/${project}/${file}`);
  const mb = (n: number) => Math.round(n / 1e6);
  if (input.video.size > GALLERY_FILE_LIMIT) throw new Error(t('gallery.filmTooLarge', { size: mb(input.video.size), limit: mb(GALLERY_FILE_LIMIT) }));
  const warnings: string[] = [];
  step('still');
  const still = await preview.thumbnail(input.duration / 2, 1280);
  if (!still) throw new Error('no still');
  step('archive');
  let archive = input.reusable ? await (await sent(await fetch(api.exportUrl(input.projectId)))).blob() : null;
  if (archive && archive.size > GALLERY_FILE_LIMIT) {
    warnings.push(t('gallery.archiveTooLarge', { size: mb(archive.size), limit: mb(GALLERY_FILE_LIMIT) }));
    archive = null;
  }
  step('upload');
  await sent(await fetch(at('video.mp4'), { method: 'PUT', body: input.video }));
  await sent(await fetch(at('poster.webp'), { method: 'PUT', body: still }));
  if (archive) await sent(await fetch(at('project.tramme'), { method: 'PUT', body: archive }));
  const { title, description, visibility, width, height, duration } = input;
  const meta = { title, description, visibility, reusable: !!archive, width, height, duration };
  const film = (await (await sent(await fetch(mine(`/${project}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) }))).json()) as { id: string };
  return { id: film.id, url: filmUrl(film.id), warnings };
}

/** a film taken off the gallery */
export async function unpublish(projectId: string) {
  await sent(await fetch(mine(`/${encodeURIComponent(publishedAs(projectId))}`), { method: 'DELETE' }));
}

/** where a published film is shown, on the site */
export const filmUrl = (id: string) => `${SITE_URL}/p/${encodeURIComponent(id)}/`;

/** a published film copied into this person's projects: its code is asked about, as any project from someone else */
export async function remix(id: string, progress?: Progress): Promise<Manifest> {
  const r = await sent(await fetch(`/api/gallery/${encodeURIComponent(id)}/project.tramme`));
  return importArchive(await r.blob(), progress);
}
