// The plugins' marketplace: packages (.trammeplugin, packages/project) published
// by their authors under their public name, checked, reviewed when they ask for
// the network or keys, listed for everyone, revoked when they must be. The
// editor's settings browse it, install from it through the same question as an
// import, check the installed ones for updates and revocations.
//
// In the one R2 bucket:
//   market/plugins/<handle>/<name>.json                  the plugin: who, and its versions with their state
//   market/packages/<handle>/<name>/<version>.trammeplugin
//   market/reports/<handle>/<name>/<time>.json
//
// Anyone:
//   GET  /api/market                                     the listed plugins (their newest listed version)
//   GET  /api/market/revoked                             the revoked versions, for the installed ones' check
//   GET  /api/market/<handle>/<name>                     one, with its listed versions
//   GET  /api/market/<handle>/<name>/<version>           its package
//   POST /api/market/<handle>/<name>/report {reason}
// Signed in:
//   POST /api/market/publish   body: the package         a new version, under the author's public name
// The back-office (moderation.ts): the versions waiting for a review, approve, revoke.

import { HttpError, json, readJson, type Bucket, type Edge } from '@tramme/api';
import { manifestOf, readPluginPackage, type PluginManifest } from '@tramme/project';
import { internal } from './accounts.ts';
import type { Env } from './http.ts';

export type VersionState = 'pending' | 'listed' | 'revoked';
export interface PluginVersion {
  version: string;
  state: VersionState;
  publishedAt: string;
  permissions: PluginManifest['permissions'];
  kinds: string[];
  size: number;
  /** the package's SHA-256: the editor checks the bytes it downloads against it */
  sha256: string;
  changelog?: string;
}
export interface PluginRecord {
  id: string;
  name: string;
  description?: string;
  licence?: string;
  homepage?: string;
  author: { name: string; handle: string };
  owner: string;
  versions: PluginVersion[];
}

/** the largest package taken (packages/project reads up to its own limit) */
export const MARKET_MAX_BYTES = 32 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const RECORD = (handle: string, name: string) => `market/plugins/${handle}/${name}.json`;
const PACKAGE = (handle: string, name: string, version: string) => `market/packages/${handle}/${name}/${version}.trammeplugin`;

/** a version's order: numbers compared one by one (1.10.0 after 1.9.0) */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((n) => Number(n) || 0), pb = b.split(/[.+-]/).map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** what needs a review before it is listed: a plugin that reaches the network or the person's keys */
export const needsReview = (p: PluginManifest['permissions']) => p.network.length > 0 || p.providers.length > 0;

export async function readRecord(files: Bucket, handle: string, name: string): Promise<PluginRecord | null> {
  if (!SLUG.test(handle) || !SLUG.test(name)) return null;
  const o = await files.get(RECORD(handle, name));
  return o ? await o.json<PluginRecord>() : null;
}
export const writeRecord = (files: Bucket, r: PluginRecord) => {
  const [handle, name] = r.id.split('/');
  return files.put(RECORD(handle, name), JSON.stringify(r), { httpMetadata: { contentType: 'application/json' } });
};

/** every plugin's record */
export async function allRecords(files: Bucket): Promise<PluginRecord[]> {
  const out: PluginRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: 'market/plugins/', cursor });
    for (const o of page.objects) { const b = await files.get(o.key); if (b) out.push(await b.json<PluginRecord>()); }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** a plugin as the catalogue shows it: its newest listed version; none when no version is listed */
export function listed(r: PluginRecord) {
  const versions = r.versions.filter((v) => v.state === 'listed').sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
  if (!versions.length) return null;
  const { owner: _owner, versions: _all, ...shown } = r;
  void _owner; void _all;
  return { ...shown, version: versions[0], versions: versions.map((v) => v.version) };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** the marketplace's routes anyone may call */
export async function marketRoute(req: Request, files: Bucket): Promise<Response | undefined> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').slice(3);
  if (url.pathname.split('/')[2] !== 'market' || parts[0] === 'publish') return undefined;
  const m = req.method;
  if (!parts[0] && m === 'GET') return json((await allRecords(files)).map(listed).filter(Boolean));
  if (parts[0] === 'revoked' && parts.length === 1 && m === 'GET') {
    return json((await allRecords(files)).flatMap((r) => r.versions.filter((v) => v.state === 'revoked').map((v) => ({ id: r.id, version: v.version }))));
  }
  const [handle, name] = parts;
  const record = await readRecord(files, handle, name);
  if (!record) throw new HttpError(404, 'not found');
  if (parts.length === 2 && m === 'GET') {
    const shown = listed(record);
    if (!shown) throw new HttpError(404, 'not found');
    return json(shown);
  }
  if (parts.length === 3 && parts[2] === 'report' && m === 'POST') {
    const { reason } = await readJson<{ reason?: unknown }>(req);
    await files.put(`market/reports/${handle}/${name}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ reason: typeof reason === 'string' ? reason.slice(0, 2000) : '', at: new Date().toISOString() }));
    return new Response(null, { status: 204 });
  }
  if (parts.length === 3 && m === 'GET') {
    const v = record.versions.find((x) => x.version === parts[2]);
    if (!v || v.state !== 'listed') throw new HttpError(404, 'not found');
    const pkg = await files.get(PACKAGE(handle, name, v.version));
    if (!pkg) throw new HttpError(404, 'not found');
    return new Response(pkg.body, { headers: { 'content-type': 'application/zip', 'x-tramme-sha256': v.sha256, 'cache-control': 'public, max-age=300', 'content-disposition': `attachment; filename="${name}-${v.version}.trammeplugin"` } });
  }
  throw new HttpError(404, 'not found');
}

/** a version published by a signed-in author: the package read and checked, its id under the author's public name */
export async function publishRoute(req: Request, env: Env, edge: Edge, files: Bucket): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== '/api/market/publish' || req.method !== 'POST') return undefined;
  if (Number(req.headers.get('content-length')) > MARKET_MAX_BYTES) throw new HttpError(413, 'package too large');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MARKET_MAX_BYTES) throw new HttpError(413, 'package too large');
  let manifest: PluginManifest;
  try {
    const pkg = readPluginPackage(new Uint8Array(bytes));
    manifest = manifestOf(pkg.module, 'plugin.trammeplugin');
  } catch (e) { throw new HttpError(400, (e as Error).message); }
  const res = await internal(env, '/internal/profile', { body: { userId: edge.userId } });
  if (!res.ok) throw new HttpError(502, 'the author could not be read');
  const author = (await res.json()) as { name: string; handle: string };
  const [idAuthor, name] = manifest.id.split('/');
  // the id names its author: a plugin is published under one's own public name only
  if (idAuthor !== author.handle) throw new HttpError(400, `the plugin's id must start with your public name: ${author.handle}/${name ?? ''}`);
  if (!SLUG.test(name) || !/^\d+\.\d+\.\d+([+-][\w.]+)?$/.test(manifest.version)) throw new HttpError(400, 'the plugin needs an id author/name and a version x.y.z');
  const before = await readRecord(files, author.handle, name);
  if (before && before.owner !== edge.userId) throw new HttpError(403, 'this plugin is another account\'s');
  const latest = before?.versions.reduce<string | null>((top, v) => (!top || newer(v.version, top) ? v.version : top), null);
  if (latest && !newer(manifest.version, latest)) throw new HttpError(409, `a newer version than ${latest} is expected`);
  const version: PluginVersion = {
    version: manifest.version, state: needsReview(manifest.permissions) ? 'pending' : 'listed', publishedAt: new Date().toISOString(),
    permissions: manifest.permissions, kinds: manifest.kinds, size: bytes.byteLength, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)),
    ...(req.headers.get('x-tramme-changelog') ? { changelog: decodeURIComponent(req.headers.get('x-tramme-changelog')!).slice(0, 4000) } : {}),
  };
  await files.put(PACKAGE(author.handle, name, manifest.version), bytes, { httpMetadata: { contentType: 'application/zip' } });
  const record: PluginRecord = {
    id: `${author.handle}/${name}`, name: manifest.name, author,
    ...(manifest.description ? { description: manifest.description } : {}), ...(manifest.licence ? { licence: manifest.licence } : {}), ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    owner: edge.userId, versions: [...(before?.versions ?? []), version],
  };
  await writeRecord(files, record);
  return json({ id: record.id, ...version }, 201);
}
