import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryRecords, recordBucket, signEdge } from '@tramme/api';
import { writePluginPackage } from '@tramme/project';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';
import { newer } from '../src/market.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';
const ADA = { userId: 'ua', workspaceId: 'aaaaaaaaaaaa', sessionVersion: 1 };
const BOSS = { userId: 'ub', workspaceId: 'bbbbbbbbbbbb', sessionVersion: 1, admin: true };

function setup() {
  const files = recordBucket(memoryRecords());
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example', ASSETS: { fetch: async () => new Response('') },
    ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: SECRET, INTERNAL_SECRET: 'i', KEYS_SECRET: 'k',
  } as unknown as Env;
  vi.stubGlobal('fetch', async () => Response.json({ name: 'Ada', handle: 'ada' }));
  return { env, files };
}
const as = async (who: typeof ADA & { admin?: boolean }) => `__Host-tramme-edge=${await signEdge(who, SECRET)}`;
const call = (env: Env, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return worker.fetch(new Request(`${APP}${path}`, { ...init, headers }), env);
};
/** a package whose meta says an id, a version and, when asked, the network */
const pkg = (id: string, version: string, network = false) => writePluginPackage({
  module: `export const meta = { id: '${id}', name: 'Glow', version: '${version}', description: 'A glow'${network ? ", permissions: { network: ['https://api.example'] }" : ''} };\nexport default {};`,
  files: new Map(),
});

afterEach(() => vi.unstubAllGlobals());

describe('worker: the plugins\' marketplace', () => {
  it('lists a published plugin for everyone, with its package checked by its hash', async () => {
    const { env } = setup();
    const res = await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.0.0'), cookie: await as(ADA) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'ada/glow', version: '1.0.0', state: 'listed' });
    const list = await (await call(env, '/api/market')).json() as { id: string; author: { handle: string }; version: { version: string; sha256: string } }[];
    expect(list.map((p) => [p.id, p.author.handle, p.version.version])).toEqual([['ada/glow', 'ada', '1.0.0']]);
    const download = await call(env, '/api/market/ada/glow/1.0.0');
    expect(download.status).toBe(200);
    const bytes = await download.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hash).toBe(list[0].version.sha256);
  });

  it('publishes under one\'s own public name only, and newer versions only', async () => {
    const { env } = setup();
    const cookie = await as(ADA);
    expect((await call(env, '/api/market/publish', { method: 'POST', body: pkg('bea/glow', '1.0.0'), cookie })).status).toBe(400);
    await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.2.0'), cookie });
    expect((await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.1.9'), cookie })).status).toBe(409);
    expect((await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.10.0'), cookie })).status).toBe(201);
    expect((await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '2.0.0') })).status).toBe(401);
  });

  it('holds a plugin that reaches the network for a review, then lists or revokes it', async () => {
    const { env } = setup();
    await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.0.0', true), cookie: await as(ADA) });
    expect(await (await call(env, '/api/market')).json()).toEqual([]);
    expect((await call(env, '/api/market/ada/glow/1.0.0')).status).toBe(404);
    const boss = await as(BOSS);
    const waiting = await (await call(env, '/api/moderation/plugins', { cookie: boss })).json() as { id: string }[];
    expect(waiting.map((p) => p.id)).toEqual(['ada/glow']);
    expect((await call(env, '/api/moderation/plugins/ada/glow/1.0.0/approve', { method: 'POST', cookie: boss })).status).toBe(200);
    expect(await (await call(env, '/api/market')).json()).toHaveLength(1);
    await call(env, '/api/moderation/plugins/ada/glow/1.0.0/revoke', { method: 'POST', cookie: boss });
    expect(await (await call(env, '/api/market/revoked')).json()).toEqual([{ id: 'ada/glow', version: '1.0.0' }]);
    expect((await call(env, '/api/market/ada/glow/1.0.0')).status).toBe(404);
    expect((await call(env, '/api/moderation/plugins', { cookie: await as(ADA) })).status).toBe(404);
  });

  it('takes reports, and orders versions by their numbers', async () => {
    const { env, files } = setup();
    await call(env, '/api/market/publish', { method: 'POST', body: pkg('ada/glow', '1.0.0'), cookie: await as(ADA) });
    expect((await call(env, '/api/market/ada/glow/report', { method: 'POST', body: JSON.stringify({ reason: 'it mines' }) })).status).toBe(204);
    expect((await files.list({ prefix: 'market/reports/ada/glow/' })).objects).toHaveLength(1);
    expect(newer('1.10.0', '1.9.0')).toBe(true);
    expect(newer('1.0.0', '1.0.0')).toBe(false);
  });
});
