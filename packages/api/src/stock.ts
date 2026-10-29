// Stock pictures and clips from libraries that need a key. Pexels answers its
// searches with the user's key, which the browser never sees; the other free
// libraries (Poly Haven, ambientCG, Openverse, Wikimedia Commons) need none and
// are asked from the editor.
//
//   GET /api/stock/pexels/<photos|videos>?query=&per_page=   Pexels' search, as it answers it

import { providerFailure } from './generate.ts';
import { HttpError, json } from './http.ts';
import type { Reach } from './providers.ts';

const PEXELS = 'https://api.pexels.com';
const SEARCH = { photos: `${PEXELS}/v1/search`, videos: `${PEXELS}/videos/search` } as const;

export async function stock(req: Request, { keys, fetch }: Reach, parts: string[]): Promise<Response> {
  const [library, kind] = parts;
  if (library !== 'pexels' || !(kind in SEARCH)) throw new HttpError(404, `no such library: stock/${parts.join('/')} (pexels/photos or pexels/videos)`);
  const key = keys.get('pexels');
  if (!key) throw new HttpError(401, `no pexels key: ${keys.how(['pexels'])}`);
  const q = new URL(req.url).searchParams;
  const query = new URLSearchParams({ query: q.get('query') ?? '', per_page: String(Math.min(40, Math.max(1, Number(q.get('per_page')) || 8))) });
  const res = await fetch(`${SEARCH[kind as keyof typeof SEARCH]}?${query}`, { headers: { Authorization: key } });
  if (res.status === 429) throw new HttpError(429, 'pexels: too many requests, try again in a while');
  if (!res.ok) await providerFailure('pexels', res);
  return json(await res.json());
}
