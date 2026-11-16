import { describe, expect, it } from 'vitest';
import { memoryRecords, recordBucket, signEdge } from '@tramme/api';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';
import { versionTime } from '../src/limits.ts';

const APP = 'https://app.example';
const SECRET = 'edge-secret';

function setup(limits: boolean) {
  const env = {
    MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example',
    ASSETS: { fetch: async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }) },
    ACCOUNTS_URL: 'http://backend.test', FILES: recordBucket(memoryRecords()), EDGE_SECRET: SECRET, INTERNAL_SECRET: 'i', KEYS_SECRET: 'k',
    ...(limits ? { PLAN_LIMITS: 'on' } : {}),
  } as unknown as Env;
  return env;
}

async function as(plan: 'basic' | 'plus') {
  return `__Host-tramme-edge=${await signEdge({ userId: 'u', workspaceId: 'aaaaaaaaaaaa', sessionVersion: 1, plan }, SECRET)}`;
}
const call = (env: Env, path: string, cookie: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${APP}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } }), env);
const create = (env: Env, cookie: string) => call(env, '/api/projects', cookie, { method: 'POST', body: JSON.stringify({ name: 'P' }) });

describe('the plans\' limits in the cloud', () => {
  it('stop nobody while they are switched off', async () => {
    const env = setup(false);
    const basic = await as('basic');
    for (let i = 0; i < 5; i++) expect((await create(env, basic)).status).toBe(201);
  });

  it('hold Basic to its projects in the cloud, created or duplicated, and let Plus go on', async () => {
    const env = setup(true);
    const basic = await as('basic');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(((await (await create(env, basic)).json()) as { id: string }).id);
    const refused = await create(env, basic);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'plan_limit', limit: 'cloudProjects', max: 3 });
    expect((await call(env, `/api/projects/${ids[0]}/duplicate`, basic, { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await create(env, await as('plus'))).status).toBe(201);
  });

  it('keep Basic\'s versions to its days of history', async () => {
    const env = setup(true);
    const basic = await as('basic');
    const { id } = (await (await create(env, basic)).json()) as { id: string };
    const day = 86_400_000;
    const old = new Date(Date.now() - 10 * day), recent = new Date(Date.now() - day);
    const name = (d: Date) => d.toISOString().replace(/[:.]/g, '-');
    const index = { versions: [{ file: `versions/${name(recent)}.json`, label: 'recent', at: recent.toISOString() }, { file: `versions/${name(old)}.json`, label: 'old', at: old.toISOString() }] };
    const plus = await as('plus');
    await call(env, `/api/projects/${id}/files/versions/index.json`, plus, { method: 'PUT', body: JSON.stringify(index) });
    for (const d of [old, recent]) await call(env, `/api/projects/${id}/files/versions/${name(d)}.json`, plus, { method: 'PUT', body: '{}' });

    const listed = (await (await call(env, `/api/projects/${id}/files/versions/index.json`, basic)).json()) as typeof index;
    expect(listed.versions.map((v) => v.label)).toEqual(['recent']);
    expect((await call(env, `/api/projects/${id}/files/versions/${name(old)}.json`, basic)).status).toBe(404);
    expect((await call(env, `/api/projects/${id}/files/versions/${name(recent)}.json`, basic)).status).toBe(200);
    // Plus keeps 30 days: both
    expect(((await (await call(env, `/api/projects/${id}/files/versions/index.json`, plus)).json()) as typeof index).versions).toHaveLength(2);
  });

  it('read a version\'s moment from its file name', () => {
    expect(versionTime('2026-11-15T10-20-30-400Z')).toBe(Date.parse('2026-11-15T10:20:30.400Z'));
    expect(versionTime('named')).toBeNull();
  });
});
