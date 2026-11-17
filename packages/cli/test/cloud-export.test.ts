import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryRecords, recordBucket } from '@tramme/api';
import { DOCUMENT, MANIFEST, newProject } from '@tramme/project';
import { cloudExport } from '../src/cloud-export.ts';

// the Worker itself answers (its types are the Workers runtime's, checked with apps/worker's own configuration)
const WORKER = '../../../apps/worker/src/';
const worker: { fetch(req: Request, env: unknown): Promise<Response> } = (await import(`${WORKER}index.ts`)).default;
const { runJob } = await import(`${WORKER}renders.ts`) as { runJob(files: unknown, ws: string, job: string, render: unknown, every?: number): Promise<unknown> };
/** a renderer whose render is over as soon as it starts */
const instant = { start: vi.fn(async (_archive: ArrayBuffer, _job: { profile?: string }) => 'r'), state: async () => ({ status: 'done' }), film: async () => new Uint8Array([7, 7, 7]).buffer, drop: async () => {} };
type Env = unknown;

const APP = 'https://app.example';
const TOKEN = `tr_${'a'.repeat(43)}`;

afterEach(() => vi.unstubAllGlobals());

describe('tramme cloud-export', () => {
  it('sends the project to the account, has it rendered in the cloud, and writes the film', async () => {
    const files = recordBucket(memoryRecords());
    const env = {
      MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: 'https://vault.example', ASSETS: { fetch: async () => new Response('') },
      ACCOUNTS_URL: 'http://backend.test', FILES: files, EDGE_SECRET: 's', INTERNAL_SECRET: 'i', KEYS_SECRET: 'k',
      // the queue renders at once, with a stand-in renderer
      RENDER_QUEUE: { idFromName: () => 'q', get: () => ({ fetch: async (r: Request) => { const w = await r.json() as { workspaceId: string; job: string }; await runJob(files, w.workspaceId, w.job, instant, 1); return new Response(null, { status: 202 }); } }) },
    } as unknown as Env;
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      // the backend says what the token stands for
      if (req.url.endsWith('/internal/token')) return Response.json({ userId: 'u', workspaceId: 'aaaaaaaaaaaa', plan: 'pro', sessionVersion: 1 });
      if (req.url.startsWith(APP)) return worker.fetch(req, env);
      return real(input, init);
    });
    const made = newProject({ name: 'Scripted', width: 320, height: 180, fps: 30, duration: 1 });
    const text = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    const project = { files: new Map([[MANIFEST, text(made.manifest)], [DOCUMENT, text(made.doc)]]) };
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-export-')), 'film.mp4');
    const lines: string[] = [];
    await cloudExport(project.files, { app: APP, token: TOKEN, out, profile: 'master', wait: async () => {}, log: (l) => lines.push(l) });
    expect(instant.start.mock.calls[0][1].profile).toBe('master');
    expect([...fs.readFileSync(out)]).toEqual([7, 7, 7]);
    expect(lines.some((l) => l.includes(': done'))).toBe(true);
  });
});
