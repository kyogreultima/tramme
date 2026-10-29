// Stock pictures and clips from libraries the browser cannot ask itself.
// Pexels answers its searches with the user's key, which the browser never
// sees. ambientCG sends no CORS headers, so its search and its files pass
// through here (no key). The other free libraries (Poly Haven, Openverse,
// Wikimedia Commons) answer the browser directly.
//
//   GET /api/stock/pexels/<photos|videos>?query=&per_page=   Pexels' search, as it answers it
//   GET /api/stock/ambientcg/search?q=&limit=                ambientCG's search of materials, as it answers it
//   GET /api/stock/ambientcg/zip?file=Concrete048_1K-JPG.zip a material's files, the zip itself

import { providerFailure } from './generate.ts';
import { HttpError, json } from './http.ts';
import type { Reach } from './providers.ts';

const PEXELS = 'https://api.pexels.com';
const SEARCH = { photos: `${PEXELS}/v1/search`, videos: `${PEXELS}/videos/search` } as const;
const AMBIENT = 'https://ambientcg.com';
const AMBIENT_ZIP = /^[A-Za-z0-9_-]{1,80}\.zip$/;

async function pexels(req: Request, { keys, fetch }: Reach, kind: string): Promise<Response> {
  if (!(kind in SEARCH)) throw new HttpError(404, `no such search: stock/pexels/${kind} (photos or videos)`);
  const key = keys.get('pexels');
  if (!key) throw new HttpError(401, `no pexels key: ${keys.how(['pexels'])}`);
  const q = new URL(req.url).searchParams;
  const query = new URLSearchParams({ query: q.get('query') ?? '', per_page: String(Math.min(40, Math.max(1, Number(q.get('per_page')) || 8))) });
  const res = await fetch(`${SEARCH[kind as keyof typeof SEARCH]}?${query}`, { headers: { Authorization: key } });
  if (res.status === 429) throw new HttpError(429, 'pexels: too many requests, try again in a while');
  if (!res.ok) await providerFailure('pexels', res);
  return json(await res.json());
}

async function ambientcg(req: Request, { fetch }: Reach, what: string): Promise<Response> {
  const q = new URL(req.url).searchParams;
  if (what === 'search') {
    const query = new URLSearchParams({ type: 'Material', q: q.get('q') ?? '', limit: String(Math.min(40, Math.max(1, Number(q.get('limit')) || 8))), include: 'downloadData,previewData' });
    const res = await fetch(`${AMBIENT}/api/v2/full_json?${query}`);
    if (!res.ok) await providerFailure('ambientcg', res);
    return json(await res.json());
  }
  if (what === 'zip') {
    const file = q.get('file') ?? '';
    if (!AMBIENT_ZIP.test(file)) throw new HttpError(400, 'ambientcg: a file name such as Concrete048_1K-JPG.zip is expected');
    const res = await fetch(`${AMBIENT}/get?file=${file}`);
    if (!res.ok) await providerFailure('ambientcg', res);
    return new Response(res.body, { headers: { 'content-type': 'application/zip', 'cache-control': 'no-store' } });
  }
  throw new HttpError(404, `no such route: stock/ambientcg/${what} (search or zip)`);
}

export async function stock(req: Request, reach: Reach, parts: string[]): Promise<Response> {
  const [library, what] = parts;
  if (library === 'pexels') return pexels(req, reach, what);
  if (library === 'ambientcg') return ambientcg(req, reach, what);
  throw new HttpError(404, `no such library: stock/${parts.join('/')} (pexels or ambientcg)`);
}
