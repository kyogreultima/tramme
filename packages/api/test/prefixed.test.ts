import { describe, expect, it } from 'vitest';
import { failure, memoryRecords, prefixedBucket, purgePrefix, recordBucket, storageRoute, workspacePrefix } from '../src/index.ts';
import { storageContract } from './contract.ts';

storageContract('a workspace in the cloud', () => prefixedBucket(recordBucket(memoryRecords()), 'w/abc123def456/'));

describe('a bucket under a prefix', () => {
  const call = async (bucket: ReturnType<typeof prefixedBucket>, path: string, init: RequestInit = {}) => {
    const url = new URL(`http://localhost${path}`);
    return (await storageRoute(new Request(url, init), bucket, url).catch(failure))!;
  };

  it('never shows one workspace the files of another', async () => {
    const shared = recordBucket(memoryRecords());
    const a = prefixedBucket(shared, workspacePrefix('aaaaaaaaaaaa'));
    const b = prefixedBucket(shared, workspacePrefix('bbbbbbbbbbbb'));
    const made = await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'A' }) })).json() as { id: string };
    expect(await (await call(a, '/api/projects')).json()).toHaveLength(1);
    expect(await (await call(b, '/api/projects')).json()).toEqual([]);
    expect((await call(b, `/api/projects/${made.id}`)).status).toBe(404);
    // in the shared bucket, everything sits under the workspace
    const all = await shared.list({});
    expect(all.objects.length).toBeGreaterThan(0);
    expect(all.objects.every((o) => o.key.startsWith('w/aaaaaaaaaaaa/'))).toBe(true);
  });

  it('gives back keys seen from inside, bodies still readable', async () => {
    const shared = recordBucket(memoryRecords());
    const a = prefixedBucket(shared, 'w/aaaaaaaaaaaa/');
    await a.put('library/x.json', '{"n":1}');
    const o = await a.get('library/x.json');
    expect(o?.key).toBe('library/x.json');
    expect(await o!.json()).toEqual({ n: 1 });
    expect((await a.list({ prefix: 'library/' })).objects.map((x) => x.key)).toEqual(['library/x.json']);
    expect((await a.list({ delimiter: '/' })).delimitedPrefixes).toEqual(['library/']);
  });

  it('refuses a prefix without its slash, and an id that is not a workspace', () => {
    expect(() => prefixedBucket(recordBucket(memoryRecords()), 'w/abc')).toThrow();
    expect(() => workspacePrefix('../etc')).toThrow();
  });
});

describe('purging a prefix', () => {
  it('deletes everything under it in batches, and nothing else; a second run finishes the job', async () => {
    const shared = recordBucket(memoryRecords());
    for (let i = 0; i < 2500; i++) await shared.put(`w/aaaaaaaaaaaa/f${i}`, 'x');
    await shared.put('w/bbbbbbbbbbbb/keep', 'x');
    let deletes = 0;
    const counted = { ...shared, delete: async (keys: string | string[]) => { deletes++; expect([keys].flat().length).toBeLessThanOrEqual(1000); await shared.delete(keys); } };
    expect(await purgePrefix(counted, 'w/aaaaaaaaaaaa/')).toBe(2500);
    expect(deletes).toBe(3);
    expect((await shared.list({ prefix: 'w/aaaaaaaaaaaa/' })).objects).toEqual([]);
    expect(await shared.head('w/bbbbbbbbbbbb/keep')).not.toBeNull();
    expect(await purgePrefix(shared, 'w/aaaaaaaaaaaa/')).toBe(0);
  });
});
