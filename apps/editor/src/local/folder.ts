// Records in a real folder of the user's (docs/installed-plugins-roadmap.md,
// step 1): a folder picked once with the File System Access API (Chrome and
// Edge on a computer), the same one the desktop app keeps its plugins in, so
// what is dropped there by hand or synced by the user's own cloud appears.
// A key is a path: `library/plugins/charts.js` is that file. What a folder
// cannot hold beside a file (its custom metadata, a sound's description) is
// kept in a hidden `.tramme` folder, with the etag the file was written
// with; a file changed by hand (its size or time no longer those written
// down) takes its size and modification time as its etag instead.

import type { RecordStore, StoredRecord } from '@tramme/api';

/** the part of FileSystemDirectoryHandle used here (a fake one runs the contract suite in the tests) */
export interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
}

const META = '.tramme';
const TYPES: Record<string, string> = { js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg', zip: 'application/zip' };

const missing = (e: unknown) => (e as { name?: string })?.name === 'NotFoundError' || (e as { name?: string })?.name === 'TypeMismatchError';

export function folderRecords(root: DirHandle): RecordStore {
  /** the folder of a key's file, made on the way when `create` */
  const dirOf = async (parts: string[], create: boolean): Promise<DirHandle | null> => {
    let d = root;
    for (const p of parts) {
      try { d = await d.getDirectoryHandle(p, { create }); } catch (e) { if (missing(e)) return null; throw e; }
    }
    return d;
  };
  // an upload under way is a record and the folder of its parts at once: its parts are kept flat beside it (`.uploads/id~1`)
  const UP = '.uploads/';
  const pathOf = (key: string) => (key.startsWith(UP) ? UP + key.slice(UP.length).replace(/\//g, '~') : key);
  const keyOf = (path: string) => (path.startsWith(UP) ? UP + path.slice(UP.length).replace(/~/g, '/') : path);
  const split = (key: string) => { const parts = pathOf(key).split('/').filter(Boolean); return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] }; };
  const sideKey = (key: string) => `${META}/${pathOf(key)}.json`;

  const readFile = async (key: string): Promise<File | null> => {
    const { dirs, name } = split(key);
    const d = await dirOf(dirs, false);
    if (!d || !name) return null;
    try { return await (await d.getFileHandle(name)).getFile(); } catch (e) { if (missing(e)) return null; throw e; }
  };
  const writeFile = async (key: string, data: Blob) => {
    const { dirs, name } = split(key);
    const d = (await dirOf(dirs, true))!;
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  };
  const removeFile = async (key: string) => {
    const { dirs, name } = split(key);
    const d = await dirOf(dirs, false);
    if (d) try { await d.removeEntry(name); } catch (e) { if (!missing(e)) throw e; }
  };

  const recordOf = async (key: string, file: File): Promise<StoredRecord> => {
    const side = key.startsWith(`${META}/`) ? null : await readFile(sideKey(key));
    const extra = side ? JSON.parse(await side.text()) as { etag?: string; size?: number; modified?: number; contentType?: string; custom?: Record<string, string> } : {};
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    // the etag written down, while the file is the one written then
    const same = extra.etag && extra.size === file.size && extra.modified === file.lastModified;
    return {
      key, data: file, etag: same ? extra.etag! : `${file.size.toString(36)}-${Math.round(file.lastModified).toString(36)}`, uploaded: new Date(file.lastModified),
      ...(extra.contentType ?? TYPES[ext] ? { contentType: extra.contentType ?? TYPES[ext] } : {}),
      ...(extra.custom ? { custom: extra.custom } : {}),
    };
  };

  /** every file under a folder, by key, the hidden one left out */
  const walk = async (d: DirHandle, prefix: string, out: string[]) => {
    for await (const [name, h] of d.entries()) {
      if (!prefix && name === META) continue;
      if (h.kind === 'directory') await walk(await d.getDirectoryHandle(name), `${prefix}${name}/`, out);
      else out.push(`${prefix}${name}`);
    }
  };

  return {
    async get(key) {
      const f = await readFile(key);
      return f ? recordOf(key, f) : undefined;
    },
    async put(record, check) {
      if (check) {
        const f = await readFile(record.key);
        if (!check(f ? await recordOf(record.key, f) : undefined)) return false;
      }
      await writeFile(record.key, record.data);
      const f = (await readFile(record.key))!;
      await writeFile(sideKey(record.key), new Blob([JSON.stringify({ etag: record.etag, size: f.size, modified: f.lastModified, contentType: record.contentType, custom: record.custom })]));
      return true;
    },
    async delete(keys) {
      for (const k of keys) { await removeFile(k); await removeFile(sideKey(k)); }
    },
    async list(prefix) {
      // the folder the prefix lies in, then every file under it
      const parts = pathOf(prefix).split('/');
      const d = await dirOf(parts.slice(0, -1).filter(Boolean), false);
      if (!d) return [];
      const paths: string[] = [];
      await walk(d, parts.slice(0, -1).filter(Boolean).map((p) => `${p}/`).join(''), paths);
      const out: StoredRecord[] = [];
      for (const k of paths.map(keyOf).filter((x) => x.startsWith(prefix)).sort()) { const f = await readFile(k); if (f) out.push(await recordOf(k, f)); }
      return out;
    },
  };
}
