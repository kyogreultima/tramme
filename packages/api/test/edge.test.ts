import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bucketKeyStore, memoryRecords, prefixedBucket, recordBucket, sealedKeyStore, signEdge, verifyEdge } from '../src/index.ts';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;
const edge = { userId: 'u1', workspaceId: 'abc123def456', sessionVersion: 2, plan: 'plus' as const };

/** a token signed the way the backend signs it (apps/server/app/services/edge_token.ts, node:crypto) */
function backendToken(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }, secret = SECRET) {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
const iat = Math.floor(NOW / 1000);

describe('the edge token', () => {
  it('reads a token the backend signed', async () => {
    const token = backendToken({ sub: 'u1', ws: 'abc123def456', sv: 2, pl: 'plus', iat, exp: iat + 600 });
    expect(await verifyEdge(token, SECRET, NOW)).toEqual({ ...edge, exp: iat + 600 });
    // a token without a plan, or with one that does not exist, is Basic
    expect((await verifyEdge(backendToken({ sub: 'u1', ws: 'abc123def456', sv: 2, iat, exp: iat + 600 }), SECRET, NOW))?.plan).toBe('basic');
    expect((await verifyEdge(backendToken({ sub: 'u1', ws: 'abc123def456', sv: 2, pl: 'gold', iat, exp: iat + 600 }), SECRET, NOW))?.plan).toBe('basic');
  });

  it('signs as the backend does', async () => {
    expect(await signEdge(edge, SECRET, NOW)).toBe(backendToken({ sub: 'u1', ws: 'abc123def456', sv: 2, pl: 'plus', iat, exp: iat + 600 }));
  });

  it('refuses a forged, expired, malformed or incomplete one', async () => {
    const good = { sub: 'u1', ws: 'abc123def456', sv: 2, iat, exp: iat + 600 };
    expect(await verifyEdge(backendToken(good, undefined, 'another'), SECRET, NOW)).toBeNull();
    expect(await verifyEdge(backendToken({ ...good, exp: iat - 1 }), SECRET, NOW)).toBeNull();
    expect(await verifyEdge(backendToken(good, { alg: 'none' }), SECRET, NOW)).toBeNull();
    expect(await verifyEdge(backendToken({ ...good, ws: '../x' }), SECRET, NOW)).toBeNull();
    expect(await verifyEdge(backendToken({ ...good, sv: undefined }), SECRET, NOW)).toBeNull();
    expect(await verifyEdge('a.b', SECRET, NOW)).toBeNull();
    expect(await verifyEdge('***.***.***', SECRET, NOW)).toBeNull();
    expect(await verifyEdge(backendToken(good), '', NOW)).toBeNull();
  });
});

describe('keys sealed in a workspace', () => {
  const keys = { keys: { anthropic: 'sk-ant-secret-value' }, fields: {}, custom: [] };

  it('come back as they were saved, and nothing of them is stored in clear', async () => {
    const shared = recordBucket(memoryRecords());
    const ws = prefixedBucket(shared, 'w/abc123def456/');
    await sealedKeyStore(ws, SECRET, 'abc123def456').save(keys);
    expect(await sealedKeyStore(ws, SECRET, 'abc123def456').load()).toEqual(keys);
    const raw = await (await shared.get('w/abc123def456/config/keys.json'))!.arrayBuffer();
    expect(new TextDecoder().decode(raw)).not.toContain('sk-ant');
  });

  it('do not open for another workspace, another secret, or a key file left in clear', async () => {
    const ws = prefixedBucket(recordBucket(memoryRecords()), 'w/abc123def456/');
    await sealedKeyStore(ws, SECRET, 'abc123def456').save(keys);
    await expect(sealedKeyStore(ws, SECRET, 'zzzzzzzzzzzz').load()).rejects.toThrow('cannot be read');
    await expect(sealedKeyStore(ws, 'other', 'abc123def456').load()).rejects.toThrow('cannot be read');
    await bucketKeyStore(ws).save(keys);
    await expect(sealedKeyStore(ws, SECRET, 'abc123def456').load()).rejects.toThrow('cannot be read');
  });

  it('are empty before the first save', async () => {
    expect(await sealedKeyStore(prefixedBucket(recordBucket(memoryRecords()), 'w/abc123def456/'), SECRET, 'abc123def456').load()).toEqual({ keys: {}, fields: {}, custom: [] });
  });
});
