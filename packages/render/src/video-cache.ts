// Small preview copies can be read completely without pinning the large
// original in memory. Finished blobs are shared weakly between the preview
// and storyboard; their server version is checked whenever they reopen.
const LIMIT = 64 * 1024 * 1024;
const PART = 256 * 1024;
const pending = new Map<string, Promise<Blob | null>>();
const ready = new Map<string, { version: string; size: number; blob: WeakRef<Blob> }>();

export function previewVideoBlob(url: string): Promise<Blob | null> {
  const existing = pending.get(url);
  if (existing) return existing;
  const promise = read(url).finally(() => pending.delete(url));
  pending.set(url, promise);
  return promise;
}

async function read(url: string): Promise<Blob | null> {
  const abort = new AbortController();
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-cache', signal: abort.signal });
    const size = Number(head.headers.get('content-length'));
    if (!head.ok || !Number.isSafeInteger(size) || size <= 0 || size > LIMIT || head.headers.get('accept-ranges') !== 'bytes') return null;
    const etag = head.headers.get('etag');
    const version = etag ?? head.headers.get('last-modified') ?? '';
    const previous = ready.get(url);
    const cached = previous?.blob.deref();
    if (cached && version && previous?.version === version && previous.size === size) return cached;
    const chunks: ArrayBuffer[] = new Array(Math.ceil(size / PART));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (next < chunks.length) {
        const index = next++, from = index * PART, to = Math.min(size, from + PART) - 1;
        const response = await fetch(url, { headers: { range: `bytes=${from}-${to}`, ...(etag ? { 'if-match': etag } : {}) }, signal: abort.signal });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${from}-${to}/${size}`) {
          await response.body?.cancel();
          throw new Error('preview ranges unavailable');
        }
        const data = await response.arrayBuffer();
        if (data.byteLength !== to - from + 1) throw new Error('incomplete preview range');
        chunks[index] = data;
      }
    }));
    const blob = new Blob(chunks, { type: head.headers.get('content-type') ?? 'application/octet-stream' });
    ready.set(url, { version, size, blob: new WeakRef(blob) });
    if (ready.size > 32) ready.delete(ready.keys().next().value!);
    return blob;
  } catch {
    // A host without usable ranges keeps the existing streaming decoder.
    return null;
  } finally { abort.abort(); }
}
