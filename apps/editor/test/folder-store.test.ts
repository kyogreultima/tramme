import { recordBucket } from '@tramme/api';
import { describe, expect, it } from 'vitest';
import { storageContract } from '../../../packages/api/test/contract.ts';
import { folderRecords, type DirHandle } from '../src/local/folder.ts';

/** a folder in memory, answering as the File System Access API does (NotFoundError, entries, writables) */
function memoryFolder(): DirHandle {
  let clock = 1_700_000_000_000;
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const dir = (): DirHandle => {
    const dirs = new Map<string, DirHandle>(), files = new Map<string, File>();
    return {
      async getDirectoryHandle(name, opts) {
        if (files.has(name)) throw Object.assign(new Error('a file'), { name: 'TypeMismatchError' });
        if (!dirs.has(name)) { if (!opts?.create) throw notFound(); dirs.set(name, dir()); }
        return dirs.get(name)!;
      },
      async getFileHandle(name, opts) {
        if (!files.has(name)) { if (!opts?.create) throw notFound(); files.set(name, new File([], name, { lastModified: clock++ })); }
        return {
          getFile: async () => files.get(name)!,
          createWritable: async () => { const parts: Blob[] = []; return { write: async (d: Blob) => { parts.push(d); }, close: async () => { files.set(name, new File(parts, name, { lastModified: clock++ })); } }; },
        };
      },
      async removeEntry(name) { if (!files.delete(name) && !dirs.delete(name)) throw notFound(); },
      async *entries() { for (const k of dirs.keys()) yield [k, { kind: 'directory' as const }]; for (const k of files.keys()) yield [k, { kind: 'file' as const }]; },
    };
  };
  return dir();
}

storageContract('a folder of the user (File System Access)', () => recordBucket(folderRecords(memoryFolder())));

describe('a folder of plugins', () => {
  it('shows a file dropped in it by hand, and sees it change', async () => {
    const root = memoryFolder(), store = folderRecords(root);
    const lib = await (await root.getDirectoryHandle('library', { create: true })).getDirectoryHandle('plugins', { create: true });
    const w = await (await lib.getFileHandle('charts.js', { create: true })).createWritable();
    await w.write(new Blob(['export const meta = {}']));
    await w.close();
    const first = await store.list('library/plugins/');
    expect(first.map((r) => [r.key, r.contentType])).toEqual([['library/plugins/charts.js', 'text/javascript']]);
    const w2 = await (await lib.getFileHandle('charts.js')).createWritable();
    await w2.write(new Blob(['export const meta = { version: "2" }']));
    await w2.close();
    expect((await store.get('library/plugins/charts.js'))!.etag).not.toBe(first[0].etag);
    // the hidden folder is never listed
    await store.put({ key: 'library/plugins/b.js', data: new Blob(['x']), etag: 'e1', uploaded: new Date(), custom: { a: '1' } });
    expect((await store.list('')).map((r) => r.key)).toEqual(['library/plugins/b.js', 'library/plugins/charts.js']);
  });
});
