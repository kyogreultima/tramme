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

const { bring, localProjects, markOffered, missingFiles, wasOffered } = await import('../src/bring.ts');
const { api, ApiError } = await import('../src/api.ts');
const { importArchive } = await import('../src/importer.ts');

/** a project made in this browser's personal mode, in the database the service worker uses */
async function made(name: string) {
  const url = new URL('http://local/api/projects');
  const res = await storageRoute(new Request(url, { method: 'POST', body: JSON.stringify({ name }) }), recordBucket(idbRecords()), url);
  return (await res!.json()) as { id: string; name: string };
}

afterEach(() => { imported.length = 0; });

/** what a whole copy in the account holds: a project made here has its manifest and its document */
const whole = [{ path: 'tramme.json', size: 1, etag: '', modified: '' }, { path: DOCUMENT, size: 1, etag: '', modified: '' }];
/** whether this browser still stores a project (localProjects hides one the account holds whole) */
const kept = async (id: string) => {
  const url = new URL('http://local/api/projects');
  const list = (await (await storageRoute(new Request(url), recordBucket(idbRecords()), url))!.json()) as { id: string }[];
  return list.some((p) => p.id === id);
};

describe('bringing this browser\'s projects into the account', () => {
  it('lists the projects kept in this browser', async () => {
    await made('First');
    await made('Second');
    expect((await localProjects()).map((p) => p.name).sort()).toEqual(['First', 'Second']);
  });

  it('moves each chosen one through its archive, goes on after a failure, and removes here only what is in the account', async () => {
    const remote = vi.spyOn(api, 'list').mockResolvedValue([]);
    const info = vi.spyOn(api, 'info').mockImplementation(async (id) => ({ manifest: { id } as never, files: whole }));
    const list = await localProjects();
    const steps: number[] = [];
    try {
      const r = await bring(list, (done) => steps.push(done));
      expect(imported).toHaveLength(2);
      expect(imported.every((b) => b.size > 0)).toBe(true);
      expect(r.brought).toHaveLength(1);
      expect(r.failed.map((f) => f.error)).toEqual(['quota']);
      expect(steps).toEqual([0, 1, 2]);
      // the one in the account left here; the one that failed stays
      expect(await localProjects()).toHaveLength(1);
      expect((await localProjects())[0].id).toBe(r.failed[0].id);
    } finally { remote.mockRestore(); info.mockRestore(); }
  });

  it('keeps a project here when its copy in the account lacks a file', async () => {
    const source = await made('Half copied');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const remote = vi.spyOn(api, 'list').mockResolvedValue([]);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: [whole[1]] });
    try {
      const r = await bring([local], () => {});
      expect(r.failed.map((f) => f.id)).toEqual([local.id]);
      expect(await kept(local.id)).toBe(true);
    } finally { remote.mockRestore(); info.mockRestore(); }
  });

  it('keeps a project here when the account holds an older copy whose document differs', async () => {
    const source = await made('Edited since');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const remote = vi.spyOn(api, 'list').mockResolvedValue([{ ...local }]);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: whole });
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: '{"older":true}', etag: '' });
    try {
      const r = await bring([local], () => {});
      expect(imported).toHaveLength(0);
      expect(r.failed.map((f) => f.id)).toEqual([local.id]);
      expect(await kept(local.id)).toBe(true);
    } finally { remote.mockRestore(); info.mockRestore(); read.mockRestore(); }
  });

  it('finds what a copy lacks: a file, or one of another size; the manifest and the document only by presence', () => {
    const from = [{ path: 'tramme.json', size: 10 }, { path: DOCUMENT, size: 50 }, { path: 'assets/a.mp4', size: 100 }, { path: 'renders/f.mp4', size: 7 }];
    expect(missingFiles(from, [{ path: 'tramme.json', size: 11 }, { path: DOCUMENT, size: 52 }, { path: 'assets/a.mp4', size: 100 }, { path: 'renders/f.mp4', size: 7 }])).toEqual([]);
    expect(missingFiles(from, [{ path: 'tramme.json', size: 10 }, { path: DOCUMENT, size: 50 }, { path: 'assets/a.mp4', size: 99 }])).toEqual(['assets/a.mp4', 'renders/f.mp4']);
  });

  it('is offered once per person in this browser', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    expect(wasOffered('u1')).toBe(false);
    markOffered('u1');
    expect(wasOffered('u1')).toBe(true);
    expect(wasOffered('u2')).toBe(false);
  });

  it('does not copy a project again when its cloud copy already has the same origin, and removes it here', async () => {
    const source = await made('One local film');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValue([{ ...local, id: 'older-cloud-copy' }]);
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: whole });
    const url = new URL(`http://local/api/projects/${local.id}/files/${DOCUMENT}`);
    const original = await storageRoute(new Request(url), recordBucket(idbRecords()), url);
    const document = await original!.text();
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: document, etag: '' });
    try {
      const repeated = await bring([local], () => {});
      expect(imported).toHaveLength(0);
      expect(repeated.skipped.map((p) => p.id)).toEqual([local.id]);
      expect(await kept(local.id)).toBe(false);
    } finally { list.mockRestore(); read.mockRestore(); info.mockRestore(); }
  });

  it('does not confuse two projects sharing a name and creation date when their documents differ', async () => {
    const source = await made('Same name');
    const local = (await localProjects()).find((p) => p.id === source.id)!;
    const list = vi.spyOn(api, 'list').mockResolvedValue([{ ...local, id: 'another-film' }]);
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: '{"different":true}', etag: '' });
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: whole });
    try {
      const result = await bring([local], () => {});
      expect(result.skipped).toHaveLength(0);
      expect(result.brought).toHaveLength(1);
    } finally { list.mockRestore(); read.mockRestore(); info.mockRestore(); }
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
    const info = vi.spyOn(api, 'info').mockResolvedValue({ manifest: local, files: whole });
    vi.mocked(importArchive).mockRejectedValueOnce(new ApiError(409, 'project already exists'));
    const url = new URL(`http://local/api/projects/${local.id}/files/${DOCUMENT}`);
    const document = await (await storageRoute(new Request(url), recordBucket(idbRecords()), url))!.text();
    const read = vi.spyOn(api, 'readText').mockResolvedValue({ text: document, etag: '' });
    try {
      const result = await bring([local], () => {});
      expect(result.skipped.map((p) => p.id)).toEqual([local.id]);
      expect(result.failed).toHaveLength(0);
    } finally { list.mockRestore(); info.mockRestore(); read.mockRestore(); }
  });
});
