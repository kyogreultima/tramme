import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordBucket, storageRoute } from '@tramme/api';
import { DOCUMENT } from '@tramme/project';
import { idbRecords } from '../src/local/idb.ts';

const imported: Blob[] = [];
vi.mock('../src/importer.ts', () => ({
  importArchive: vi.fn(async (blob: Blob) => {
    if (imported.length === 1) { imported.push(blob); throw new Error('quota'); }
    imported.push(blob);
    return { id: `cloud-${imported.length}`, name: 'brought' };
  }),
}));

const { bring, localProjects, markOffered, wasOffered } = await import('../src/bring.ts');
const { api, ApiError } = await import('../src/api.ts');
const { importArchive } = await import('../src/importer.ts');

/** a project made in this browser's personal mode, in the database the service worker uses */
async function made(name: string) {
  const url = new URL('http://local/api/projects');
  const res = await storageRoute(new Request(url, { method: 'POST', body: JSON.stringify({ name }) }), recordBucket(idbRecords()), url);
  return (await res!.json()) as { id: string; name: string };
}

afterEach(() => { imported.length = 0; });

describe('bringing this browser\'s projects into the account', () => {
  it('lists the projects kept in this browser', async () => {
    await made('First');
    await made('Second');
    expect((await localProjects()).map((p) => p.name).sort()).toEqual(['First', 'Second']);
  });

  it('brings each chosen one through its archive, goes on after a failure, and keeps the local copies', async () => {
    const remote = vi.spyOn(api, 'list').mockResolvedValue([]);
    const list = await localProjects();
    const steps: number[] = [];
    const r = await bring(list, (done) => steps.push(done));
    expect(imported).toHaveLength(2);
    expect(imported.every((b) => b.size > 0)).toBe(true);
    expect(r.brought).toHaveLength(1);
    expect(r.failed.map((f) => f.error)).toEqual(['quota']);
    expect(steps).toEqual([0, 1, 2]);
    expect(await localProjects()).toHaveLength(2);
    remote.mockRestore();
  });

  it('is offered once per person in this browser', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    expect(wasOffered('u1')).toBe(false);
    markOffered('u1');
    expect(wasOffered('u1')).toBe(true);
    expect(wasOffered('u2')).toBe(false);
  });

  it('does not copy a project again when its cloud copy already has the same origin', async () => {
    const source = await made('One local film');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValueOnce([]).mockResolvedValueOnce([
      { ...local, id: 'older-cloud-copy' },
    ]);
    const url = new URL(`http://local/api/projects/${local.id}/files/${DOCUMENT}`);
    const original = await storageRoute(new Request(url), recordBucket(idbRecords()), url);
    const document = await original!.text();
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: document, etag: '' });
    try {
      await bring([local], () => {});
      const repeated = await bring([local], () => {});
      expect(imported).toHaveLength(1);
      expect(repeated.skipped.map((p) => p.id)).toEqual([local.id]);
    } finally { list.mockRestore(); read.mockRestore(); }
  });

  it('does not confuse two projects sharing a name and creation date when their documents differ', async () => {
    const source = await made('Same name');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValue([{ ...local, id: 'another-film' }]);
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: '{"different":true}', etag: '' });
    try {
      const result = await bring([local], () => {});
      expect(result.skipped).toHaveLength(0);
      expect(result.brought).toHaveLength(1);
    } finally { list.mockRestore(); read.mockRestore(); }
  });

  it('hides a local copy only after the matching account project has its document', async () => {
    const source = await made('Interrupted transfer');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValue([{ ...local }]);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: [] });
    try {
      expect((await localProjects()).some((p) => p.id === local.id)).toBe(true);
      const result = await bring([local], () => {});
      expect(result.skipped).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      info.mockResolvedValue({ manifest: local, files: [{ path: DOCUMENT, size: 1, etag: '', modified: '' }] });
      expect((await localProjects()).some((p) => p.id === local.id)).toBe(false);
    } finally { list.mockRestore(); info.mockRestore(); }
  });

  it('treats a completed import in another window as already copied', async () => {
    const source = await made('Two windows');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...local }]);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: [{ path: DOCUMENT, size: 1, etag: '', modified: '' }] });
    vi.mocked(importArchive).mockRejectedValueOnce(new ApiError(409, 'project already exists'));
    try {
      const result = await bring([local], () => {});
      expect(result.skipped.map((p) => p.id)).toEqual([local.id]);
      expect(result.failed).toHaveLength(0);
    } finally { list.mockRestore(); info.mockRestore(); }
  });
});
