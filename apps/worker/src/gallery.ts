// The gallery: the films people publish from their projects, for everyone to
// watch, and to copy when their author allows it. A published film keeps its
// video, its still and the project's .tramme archive beside a small entry; the
// project in the account stays as it is.
//
// In the one R2 bucket, apart from the workspaces:
//   gallery/entries/<id>.json            the entry (its visibility and date in the object's metadata, for the listing)
//   gallery/projects/<id>/…              the film (renders/video.mp4), its still (assets/poster.webp) and the
//                                        archive (renders/project.zip), laid out as a project's files so the
//                                        storage routes read them (ranges, ETags)
//   gallery/reports/<id>/<time>.json     what visitors reported, for the back-office
// and in each workspace, gallery.json: which of its projects is published under which id.
//
// Anyone:
//   GET  /api/gallery?sort=recent|popular&limit=n     the public films (unlisted ones are left out)
//   GET  /api/gallery/<id>                            one, public or unlisted (a link is enough)
//   GET  /api/gallery/<id>/<video.mp4|poster.webp|project.tramme>
//   POST /api/gallery/<id>/report {reason}            report it
// Signed in (cloud.ts):
//   GET    /api/gallery/mine                          what this person published
//   PUT    /api/gallery/mine/<project>/<file>         the film, the still or the archive
//   POST   /api/gallery/mine/<project> {title, description, visibility, reusable, width, height, duration}
//   DELETE /api/gallery/mine/<project>                unpublish: the entry and its files go

import { GALLERY_FILE_LIMIT, HttpError, json, prefixedBucket, purgePrefix, readJson, storageRoute, workspacePrefix, type Bucket, type Edge } from '@tramme/api';
import { termsOf } from '@tramme/plans';
import { internal } from './accounts.ts';
import type { Env } from './http.ts';
import { limitsOn, planLimit } from './limits.ts';

export type Visibility = 'public' | 'unlisted' | 'removed';

/** what the site and the editor read of a published film (apps/site/src/lib/gallery.ts) */
export interface PublicProject {
  id: string;
  title: string;
  description: string;
  author: { name: string; handle: string; avatar?: string };
  video: { mp4?: string; webm?: string };
  poster?: string;
  width: number;
  height: number;
  duration: number;
  reusable: boolean;
  publishedAt: string;
  views?: number;
}

/** an entry as it is kept: what is shown, and who it belongs to (never shown) */
export interface Entry extends Omit<PublicProject, 'video' | 'poster'> {
  visibility: Visibility;
  updatedAt: string;
  owner: { userId: string; workspaceId: string; project: string };
}

export const GALLERY_FILES = ['video.mp4', 'poster.webp', 'project.tramme'] as const;
type GalleryFile = (typeof GALLERY_FILES)[number];
const isFile = (f: string): f is GalleryFile => (GALLERY_FILES as readonly string[]).includes(f);

/** the largest film, still or archive one request may bring: the Worker reads it whole */
export const GALLERY_MAX_BYTES = GALLERY_FILE_LIMIT;

const ENTRY = (id: string) => `gallery/entries/${id}.json`;
/** where each file is kept, as a project's file (the format's places) */
const STORED: Record<GalleryFile, string> = { 'video.mp4': 'renders/video.mp4', 'poster.webp': 'assets/poster.webp', 'project.tramme': 'renders/project.zip' };
const FILE = (id: string, f: GalleryFile) => `gallery/projects/${id}/${STORED[f]}`;
const MINE = 'gallery.json';
const ID = /^[a-z0-9]{12}$/;

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

/** an entry as everyone may see it, its files by their address on this Worker */
export function shown(e: Entry, origin = ''): PublicProject {
  const at = (f: GalleryFile) => `${origin}/api/gallery/${e.id}/${f}`;
  return {
    id: e.id, title: e.title, description: e.description, author: e.author,
    video: { mp4: at('video.mp4') }, poster: at('poster.webp'),
    width: e.width, height: e.height, duration: e.duration, reusable: e.reusable, publishedAt: e.publishedAt,
    ...(e.views !== undefined ? { views: e.views } : {}),
  };
}

export async function readEntry(files: Bucket, id: string): Promise<Entry | null> {
  if (!ID.test(id)) return null;
  const o = await files.get(ENTRY(id));
  return o ? (await o.json<Entry>()) : null;
}

async function writeEntry(files: Bucket, e: Entry) {
  await files.put(ENTRY(e.id), JSON.stringify(e), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { visibility: e.visibility, publishedAt: e.publishedAt },
  });
}

/** every entry, page by page, with what the listing needs */
export async function allEntries(files: Bucket): Promise<{ id: string; visibility: string; publishedAt: string }[]> {
  const out: { id: string; visibility: string; publishedAt: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: 'gallery/entries/', cursor, include: ['customMetadata'] });
    for (const o of page.objects) out.push({ id: o.key.slice('gallery/entries/'.length, -'.json'.length), visibility: o.customMetadata?.visibility ?? 'public', publishedAt: o.customMetadata?.publishedAt ?? '' });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** the gallery's routes anyone may call: undefined when the request is not one of them */
export async function galleryRoute(req: Request, files: Bucket): Promise<Response | undefined> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').slice(3);
  if (url.pathname.split('/')[2] !== 'gallery' || parts[0] === 'mine') return undefined;
  const m = req.method;
  if (!parts[0] && m === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 48, 1), 200);
    const listed = (await allEntries(files)).filter((e) => e.visibility === 'public').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
    const entries = (await Promise.all(listed.map((e) => readEntry(files, e.id)))).filter((e): e is Entry => !!e);
    return json(entries.map((e) => shown(e)));
  }
  const id = parts[0];
  if (!ID.test(id)) throw new HttpError(404, 'not found');
  if (parts.length === 2 && parts[1] === 'report' && m === 'POST') {
    if (!(await readEntry(files, id))) throw new HttpError(404, 'not found');
    const { reason } = await readJson<{ reason?: unknown }>(req);
    const text = typeof reason === 'string' ? reason.slice(0, 2000) : '';
    await files.put(`gallery/reports/${id}/${new Date().toISOString().replace(/[:.]/g, '-')}-${newId().slice(0, 4)}.json`, JSON.stringify({ reason: text, at: new Date().toISOString() }), { httpMetadata: { contentType: 'application/json' } });
    return new Response(null, { status: 204 });
  }
  const entry = await readEntry(files, id);
  if (!entry || entry.visibility === 'removed') throw new HttpError(404, 'not found');
  if (parts.length === 1 && m === 'GET') return json(shown(entry));
  if (parts.length === 2 && isFile(parts[1]) && (m === 'GET' || m === 'HEAD')) {
    if (parts[1] === 'project.tramme' && !entry.reusable) throw new HttpError(404, 'not found');
    // the storage routes serve it, ranges and ETags included, from the gallery's own view of the bucket
    const view = prefixedBucket(files, 'gallery/');
    const at = new URL(`/api/projects/${id}/files/${STORED[parts[1]]}`, url);
    const res = await storageRoute(new Request(at, req), view, at);
    if (!res) throw new HttpError(404, 'not found');
    const headers = new Headers(res.headers);
    // public and unchanging until republished: kept a little by browsers and the site
    headers.set('cache-control', 'public, max-age=300');
    if (parts[1] === 'project.tramme') headers.set('content-disposition', `attachment; filename="${id}.tramme"`);
    return new Response(res.body, { status: res.status, headers });
  }
  throw new HttpError(404, 'not found');
}

/** the gallery's routes of a signed-in person: undefined when the request is not one of them */
export async function myGalleryRoute(req: Request, env: Env, edge: Edge, files: Bucket, mine: Bucket): Promise<Response | undefined> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').slice(3);
  if (url.pathname.split('/')[2] !== 'gallery' || parts[0] !== 'mine') return undefined;
  const m = req.method;
  const published = async (): Promise<Record<string, string>> => {
    const o = await mine.get(MINE);
    return o ? await o.json<Record<string, string>>() : {};
  };
  if (parts.length === 1 && m === 'GET') {
    const map = await published();
    const entries = await Promise.all(Object.entries(map).map(async ([project, id]) => {
      const e = await readEntry(files, id);
      return e ? { project, visibility: e.visibility, ...shown(e) } : null;
    }));
    return json(entries.filter(Boolean));
  }
  const project = parts[1];
  if (!project || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(project)) throw new HttpError(400, 'invalid project id');
  const map = await published();
  const idOf = async () => {
    if (map[project]) return map[project];
    map[project] = newId();
    await mine.put(MINE, JSON.stringify(map), { httpMetadata: { contentType: 'application/json' } });
    return map[project];
  };

  if (parts.length === 3 && isFile(parts[2]) && m === 'PUT') {
    const size = Number(req.headers.get('content-length'));
    if (size > GALLERY_MAX_BYTES) throw new HttpError(413, 'too large for the gallery');
    const body = await req.arrayBuffer();
    if (body.byteLength > GALLERY_MAX_BYTES) throw new HttpError(413, 'too large for the gallery');
    const id = await idOf();
    await files.put(FILE(id, parts[2]), body);
    return json({ id, file: parts[2], size: body.byteLength });
  }

  if (parts.length === 2 && m === 'POST') {
    const b = await readJson<Record<string, unknown>>(req);
    const visibility: Visibility = b.visibility === 'unlisted' ? 'unlisted' : 'public';
    // a film kept off the gallery (by its link only) is a private one: the plans that have them
    if (visibility === 'unlisted' && limitsOn(env) && !termsOf(edge.plan).privateProjects) return planLimit('privateProjects', false);
    const id = await idOf();
    for (const f of ['video.mp4', 'poster.webp'] as const) if (!(await files.head(FILE(id, f)))) throw new HttpError(400, `${f} is missing: send it first`);
    const reusable = b.reusable === true;
    if (reusable && !(await files.head(FILE(id, 'project.tramme')))) throw new HttpError(400, 'project.tramme is missing: send it first');
    const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null);
    const width = num(b.width, 8192), height = num(b.height, 8192), duration = num(b.duration, 36_000);
    if (!width || !height || !duration) throw new HttpError(400, 'width, height and duration expected');
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const title = text(b.title, 120);
    if (!title) throw new HttpError(400, 'a title expected');
    const res = await internal(env, '/internal/profile', { body: { userId: edge.userId } });
    if (!res.ok) throw new HttpError(502, 'the author could not be read');
    const author = (await res.json()) as { name: string; handle: string };
    const before = await readEntry(files, id);
    const now = new Date().toISOString();
    if (before?.visibility === 'removed') throw new HttpError(403, 'this film was taken down');
    const entry: Entry = {
      id, title, description: text(b.description, 2000), author: { name: author.name, handle: author.handle },
      width, height, duration, reusable, publishedAt: before?.publishedAt ?? now, updatedAt: now, visibility,
      owner: { userId: edge.userId, workspaceId: edge.workspaceId, project },
    };
    await writeEntry(files, entry);
    return json(shown(entry), before ? 200 : 201);
  }

  if (parts.length === 2 && m === 'DELETE') {
    const id = map[project];
    if (!id) throw new HttpError(404, 'not published');
    await unpublish(files, id);
    delete map[project];
    await mine.put(MINE, JSON.stringify(map), { httpMetadata: { contentType: 'application/json' } });
    return new Response(null, { status: 204 });
  }
  throw new HttpError(404, 'unknown route');
}

/** a workspace's files gone, and the films it published with them (an account deleted or closed) */
export async function forgetWorkspace(files: Bucket, workspaceId: string) {
  const mine = await files.get(`${workspacePrefix(workspaceId)}${MINE}`);
  const published = mine ? Object.values(await mine.json<Record<string, string>>()) : [];
  await Promise.all(published.map((id) => unpublish(files, id)));
  await purgePrefix(files, workspacePrefix(workspaceId));
}

/** a film off the gallery: its entry and its files */
export async function unpublish(files: Bucket, id: string) {
  await files.delete([ENTRY(id), ...GALLERY_FILES.map((f) => FILE(id, f))]);
}
