import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordBucket, storageRoute } from '@tramme/api';
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
    const list = await localProjects();
    const steps: number[] = [];
    const r = await bring(list, (done) => steps.push(done));
    expect(imported).toHaveLength(2);
    expect(imported.every((b) => b.size > 0)).toBe(true);
    expect(r.brought).toHaveLength(1);
    expect(r.failed.map((f) => f.error)).toEqual(['quota']);
    expect(steps).toEqual([0, 1, 2]);
    expect(await localProjects()).toHaveLength(2);
  });

  it('is offered once per person in this browser', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    expect(wasOffered('u1')).toBe(false);
    markOffered('u1');
    expect(wasOffered('u1')).toBe(true);
    expect(wasOffered('u2')).toBe(false);
  });
});
