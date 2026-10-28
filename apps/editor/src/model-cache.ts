// The models in this browser's cache (docs/editing-roadmap.md, step 1): what
// is there and how much it weighs, a model downloaded ahead of its tool with
// its progress, a model deleted to free the space. The cache is the one
// transformers.js uses ('transformers-cache'), where the cut-out keeps its
// matte networks too.

import { cachePrefix, MODELS, type ModelEntry } from './models.ts';

export const CACHE = 'transformers-cache';

export interface CachedFile { url: string; bytes: number }

/** what the cache holds for a model, or for a repository the catalogue does not know */
export interface CachedModel { id: string; name: string; bytes: number; urls: string[] }

/** the model hub repository a file's URL belongs to ("owner/name"), or null */
export function repoOf(url: string): string | null {
  return /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\//.exec(url)?.[1] ?? null;
}

/**
 * The cached files grouped by model: the catalogue's models first (a file
 * belongs to the first whose prefix it starts with), then the other model hub
 * repositories (a model the user named, an older version), then whatever else.
 */
export function groupCache(files: CachedFile[], models: ModelEntry[] = MODELS): CachedModel[] {
  const out = new Map<string, CachedModel>();
  const add = (id: string, name: string, f: CachedFile) => {
    const g = out.get(id) ?? { id, name, bytes: 0, urls: [] };
    g.bytes += f.bytes;
    g.urls.push(f.url);
    out.set(id, g);
  };
  for (const f of files) {
    const known = models.find((m) => (m.adapter.kind !== 'pipeline' ? f.url === m.source : f.url.startsWith(cachePrefix(m))));
    if (known) { add(known.id, known.name, f); continue; }
    const repo = repoOf(f.url);
    add(repo ? `hub:${repo}` : 'other', repo ?? 'other', f);
  }
  return [...out.values()];
}

/** the files of a model in the cache and their weight (a file two rows share, the small U²-Net, counts for both) */
export function cachedOf(m: ModelEntry, files: CachedFile[]): { bytes: number; urls: string[] } {
  const mine = files.filter((f) => (m.adapter.kind !== 'pipeline' ? f.url === m.source : f.url.startsWith(cachePrefix(m))));
  return { bytes: mine.reduce((n, f) => n + f.bytes, 0), urls: mine.map((f) => f.url) };
}

/** the files of the cache with their sizes; none where the browser has no Cache API (private windows, tests) */
export async function cachedFiles(): Promise<CachedFile[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(CACHE).catch(() => null);
  if (!cache) return [];
  const out: CachedFile[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res) continue;
    const told = Number(res.headers.get('content-length'));
    out.push({ url: req.url, bytes: told > 0 ? told : (await res.blob()).size });
  }
  return out;
}

/** removes these files from the cache; the model downloads again the next time its tool runs */
export async function deleteCached(urls: string[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(CACHE);
  await Promise.all(urls.map((u) => cache.delete(u)));
}

export type DownloadProgress = (loaded: number, total: number) => void;

/** a model's files fetched into the cache ahead of its tool, with their progress (bytes of all its files) */
export async function downloadModel(m: ModelEntry, progress?: DownloadProgress): Promise<void> {
  // one file read with onnxruntime (a matte, a voice detector): fetched into the cache as it is
  if (m.adapter.kind !== 'pipeline') {
    const cache = await caches.open(CACHE);
    if (await cache.match(m.source)) return;
    const res = await fetch(m.source);
    if (!res.ok || !res.body) throw new Error(`${m.source}: ${res.status} ${res.statusText}`);
    const total = Number(res.headers.get('content-length')) || 0, parts: Uint8Array[] = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      progress?.(loaded, total || loaded);
    }
    await cache.put(m.source, new Response(new Blob(parts as BlobPart[]), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded) } }));
    return;
  }
  // a pipeline model: transformers.js fetches its files into the same cache, in the precision its tool would take here
  const a = m.adapter;
  const { pipeline } = await import('@huggingface/transformers');
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const p = await pipeline(a.pipeline, m.source, { revision: m.revision, dtype: gpu ? a.gpu[0] : a.cpu, ...(progress ? { progress_callback: progressCallback(progress) } : {}) } as never);
  await (p as unknown as { dispose?: () => Promise<void> }).dispose?.();
}

/** transformers.js's progress_callback, its files' bytes added up into one progress */
export function progressCallback(progress: DownloadProgress) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.status !== 'progress' || !e.file) return;
    files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    progress(loaded, total);
  };
}
