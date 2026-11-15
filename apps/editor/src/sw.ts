// The personal mode's service worker. Its storage: it answers the editor's
// storage routes (/api/projects, /api/library, /api/sounds) from IndexedDB, in
// this browser, with the same code the Worker runs on R2 (@tramme/api). The
// editor does not know the difference; nothing reaches the server. And the
// installed app: it keeps the editor's own files (the shell build.ts names),
// so the app opens without a network — the projects are here already.
// Registered by mode.ts only in personal mode.

import { failure, json, recordBucket, STORAGE, storageRoute } from '@tramme/api';
import { idbRecords } from './local/idb.ts';

// what this file needs of the service worker's scope (the DOM's types are the editor's)
interface ExtendableEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(r: Response | Promise<Response>): void }
interface MessageEvent extends ExtendableEvent { data: unknown }
const scope = self as unknown as {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
};

/** the editor's files of this build (build.ts), and the cache that keeps them; none in dev */
declare const __SHELL__: string[];
declare const __BUILD__: string;
const CACHE = `tramme-${__BUILD__}`;
const keeps = __BUILD__ !== 'dev';

const bucket = recordBucket(idbRecords());

scope.addEventListener('install', (e) => e.waitUntil((async () => {
  // offline at install: the files are kept as they are fetched instead
  if (keeps) await caches.open(CACHE).then((c) => c.addAll(__SHELL__)).catch(() => {});
  await scope.skipWaiting();
})()));
scope.addEventListener('activate', (e) => e.waitUntil((async () => {
  // the files of the builds before this one go
  for (const k of await caches.keys()) if (k.startsWith('tramme-') && k !== CACHE) await caches.delete(k);
  await scope.clients.claim();
})()));
// a page opened without the worker (first visit, forced reload) asks to be taken over
scope.addEventListener('message', (e) => { if (e.data === 'claim') e.waitUntil(scope.clients.claim()); });

/** a whole answer of this origin, worth keeping (not a part of a file, not an error, not a signed-in person's page) */
const keepable = (r: Response) => r.status === 200 && r.type === 'basic' && !r.headers.has('x-tramme-account');

/** the network first, its answer kept; the kept one when there is no network. Pages all share the shell's page (/). */
async function networkFirst(req: Request, key: Request | string = req): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (keepable(r)) void cache.put(key, r.clone());
    return r;
  } catch (e) {
    const kept = await cache.match(key);
    if (kept) return kept;
    throw e;
  }
}

/** a bundle: its name carries its content's hash, a kept copy is always right */
async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(req);
  if (kept) return kept;
  const r = await fetch(req);
  if (keepable(r)) void cache.put(req, r.clone());
  return r;
}

scope.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!STORAGE.includes(url.pathname.split('/')[2])) return;
    e.respondWith(storageRoute(req, bucket, url).then((r) => r ?? json({ error: `unknown route: ${req.method} ${url.pathname}` }, 404)).catch(failure));
    return;
  }
  if (!keeps || req.method !== 'GET' || req.headers.has('range')) return;
  if (req.mode === 'navigate') e.respondWith(networkFirst(req, '/'));
  else if (url.pathname.startsWith('/assets/')) e.respondWith(cacheFirst(req));
  else e.respondWith(networkFirst(req));
});
