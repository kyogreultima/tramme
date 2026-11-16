// A bucket seen through a prefix: what a signed-in person's files are in the
// cloud. Each account's workspace keeps its files under `w/<workspace>/` of
// the one R2 bucket, with the layout of a private server below it; the routes
// of storage.ts and keys.ts run on this view and never see another prefix.
// The separation is by construction: every key that goes in gets the prefix,
// every key that comes back loses it.

import type { Bucket, MultipartUpload, StoredObject } from './bucket.ts';

/** the files of a workspace, in the cloud's bucket */
export const workspacePrefix = (workspaceId: string): string => {
  if (!/^[a-z0-9]{12}$/.test(workspaceId)) throw new Error(`not a workspace id: ${workspaceId}`);
  return `w/${workspaceId}/`;
};

export function prefixedBucket(bucket: Bucket, prefix: string): Bucket {
  if (!prefix.endsWith('/') || prefix === '/') throw new Error(`a prefix ends with "/": ${prefix}`);
  const inside = (key: string) => prefix + key;
  const outside = (key: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : key);
  /** the object with its key seen from inside; its methods (a body's json(), arrayBuffer()) still work */
  const seen = <T extends StoredObject | null>(o: T): T => o && new Proxy(o, {
    get(target, p) {
      if (p === 'key') return outside(target.key);
      const v = Reflect.get(target, p, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  return {
    head: async (key) => seen(await bucket.head(inside(key))),
    get: (async (key: string, options?: { range?: Headers; onlyIf?: Headers }) => seen(await bucket.get(inside(key), options as { range?: Headers; onlyIf: Headers }))) as Bucket['get'],
    put: async (key, value, options) => seen(await bucket.put(inside(key), value, options)),
    delete: (keys) => bucket.delete(Array.isArray(keys) ? keys.map(inside) : inside(keys)),
    async list(options) {
      const l = await bucket.list({ ...options, prefix: inside(options.prefix ?? '') });
      return { ...l, objects: l.objects.map(seen), delimitedPrefixes: l.delimitedPrefixes.map(outside) };
    },
    createMultipartUpload: (key, options) => bucket.createMultipartUpload(inside(key), options),
    resumeMultipartUpload(key, uploadId): MultipartUpload {
      const upload = bucket.resumeMultipartUpload(inside(key), uploadId);
      return {
        uploadPart: (n, value) => upload.uploadPart(n, value),
        complete: async (parts) => seen(await upload.complete(parts)),
        abort: () => upload.abort(),
      };
    },
  };
}

/**
 * Every object under a prefix deleted, page by page, in batches of at most a thousand keys (R2's limit for one
 * delete): the files of a deleted account. Safe to run again on a prefix it left half done. Returns the count.
 */
export async function purgePrefix(bucket: Bucket, prefix: string): Promise<number> {
  if (!prefix.endsWith('/') || prefix === '/') throw new Error(`a prefix ends with "/": ${prefix}`);
  let count = 0;
  for (;;) {
    // always the first page: what was deleted is no longer listed
    const page = await bucket.list({ prefix });
    const keys = page.objects.map((o) => o.key);
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
    count += keys.length;
    if (!page.truncated || !keys.length) return count;
  }
}
