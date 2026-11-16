// Export in the cloud: a project rendered on a server as the desktop export
// renders it (the command line, in the renderer container, apps/renderer), its
// film kept with the project (renders/cloud-<job>.mp4). A signed-in person asks
// for it; the job waits in the queue (RenderQueue, one at a time, the plans with
// a priority first) and says where it is until the film is there.
//
//   POST /api/projects/<id>/renders {comp?}     a job (above 1080p, a 4K export: the plans that have it)
//   GET  /api/renders                                                  this person's jobs, the newest first
//   GET  /api/renders/<job>                                            one, and where it is
//
// In the workspace: renders/<job>.json, the job's record. A server of one (`pnpm dev`, the private mode) has the
// same routes on its own projects, rendered by the renderer started on this machine (RENDERER_URL). Once a
// job of an account is over, the backend mails its owner (the page may be closed).

import { internal } from './accounts.ts';

import { DurableObject } from 'cloudflare:workers';
import { HttpError, json, prefixedBucket, readJson, storageRoute, workspacePrefix, type Bucket, type Edge } from '@tramme/api';
import { termsOf } from '@tramme/plans';
import type { Env } from './http.ts';
import { limitsOn } from './limits.ts';

export type Quality = '1080p' | '4k';
export interface Job {
  id: string;
  project: string;
  quality: Quality;
  comp?: string;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  createdAt: string;
  updatedAt: string;
  /** the film, a file of the project, once done */
  file?: string;
  error?: string;
  /** a plan whose jobs go first (Pro) */
  priority: boolean;
  /** the account that asked for it (none on a server of one): told by mail when it is over */
  userId?: string;
}

const JOB = (id: string) => `renders/${id}.json`;
const newJob = () => `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6)}`;

export async function readJob(files: Bucket, id: string): Promise<Job | null> {
  if (!/^[0-9]{14}-[a-z0-9]{1,8}$/.test(id)) return null;
  const o = await files.get(JOB(id));
  return o ? await o.json<Job>() : null;
}
const writeJob = (files: Bucket, job: Job) => files.put(JOB(job.id), JSON.stringify(job), { httpMetadata: { contentType: 'application/json' } });

/** the export routes of a signed-in person: undefined when the request is not one of them */
export async function renderRoute(req: Request, env: Env, edge: Pick<Edge, 'workspaceId' | 'plan'> & { userId?: string }, files: Bucket, queue: (ws: string, job: Job) => Promise<void>): Promise<Response | undefined> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').slice(2);
  const m = req.method;
  if (parts[0] === 'projects' && parts[2] === 'renders' && parts.length === 3 && m === 'POST') {
    const project = parts[1];
    // the project must be there (its manifest), read through the storage routes
    const info = await storageRoute(new Request(new URL(`/api/projects/${project}`, url)), files, new URL(`/api/projects/${project}`, url)).catch(() => null);
    if (!info?.ok) throw new HttpError(404, 'project not found');
    const body = await readJson<{ comp?: unknown }>(req);
    // the film is rendered at the project's size: above 1080p, it is a 4K export
    const { manifest } = (await info.json()) as { manifest: { width?: number; height?: number } };
    const quality: Quality = (manifest.width ?? 0) * (manifest.height ?? 0) > 1920 * 1080 ? '4k' : '1080p';
    const terms = termsOf(edge.plan);
    if (quality === '4k' && limitsOn(env) && !terms.export4k) return json({ error: 'plan_limit', limit: 'export4k', max: false }, 403);
    const now = new Date().toISOString();
    const job: Job = {
      id: newJob(), project, quality, ...(typeof body.comp === 'string' && /^[\w-]{1,64}$/.test(body.comp) ? { comp: body.comp } : {}),
      status: 'queued', createdAt: now, updatedAt: now, priority: terms.priorityQueue, ...(edge.userId ? { userId: edge.userId } : {}),
    };
    await writeJob(files, job);
    await queue(edge.workspaceId, job);
    return json(job, 202);
  }
  if (parts[0] !== 'renders') return undefined;
  if (parts.length === 1 && m === 'GET') {
    const list = await files.list({ prefix: 'renders/' });
    const jobs = (await Promise.all(list.objects.map((o) => readJob(files, o.key.slice('renders/'.length, -'.json'.length))))).filter((j): j is Job => !!j);
    return json(jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50));
  }
  if (parts.length === 2 && m === 'GET') {
    const job = await readJob(files, parts[1]);
    if (!job) throw new HttpError(404, 'not found');
    return json(job);
  }
  throw new HttpError(404, 'unknown route');
}

/** what renders a project: its archive in, its film out (the renderer container, or a stand-in in the tests) */
export type Renderer = (archive: ArrayBuffer, job: Job) => Promise<ArrayBuffer>;

/** a server of one keeps its projects at the bucket's root: its jobs have no workspace */
export const SERVER = '';

/** the files of a workspace, or the server's own */
const filesOf = (bucket: Bucket, workspaceId: string) => (workspaceId === SERVER ? bucket : prefixedBucket(bucket, workspacePrefix(workspaceId)));

/** one job done: the project's archive rendered, the film kept with the project, the record saying so */
export async function runJob(bucket: Bucket, workspaceId: string, jobId: string, render: Renderer): Promise<Job | null> {
  const files = filesOf(bucket, workspaceId);
  const job = await readJob(files, jobId);
  if (!job || job.status === 'done') return job;
  const step = async (change: Partial<Job>) => { Object.assign(job, change, { updatedAt: new Date().toISOString() }); await writeJob(files, job); };
  await step({ status: 'rendering' });
  try {
    const at = new URL(`https://render/api/projects/${job.project}/export`);
    const archive = await storageRoute(new Request(at), files, at);
    if (!archive?.ok) throw new Error('the project cannot be read');
    const film = await render(await archive.arrayBuffer(), job);
    const file = `renders/cloud-${job.id}.mp4`;
    await files.put(`projects/${job.project}/${file}`, film, { httpMetadata: { contentType: 'video/mp4' } });
    await step({ status: 'done', file });
  } catch (e) {
    await step({ status: 'failed', error: (e as Error).message.slice(0, 500) });
  }
  return job;
}

interface Waiting { workspaceId: string; job: string; priority: boolean; at: string }

/**
 * The queue of the exports: the jobs wait here in order, the plans with a priority first, and are rendered one at
 * a time (one renderer). An alarm takes the next one; a job's record in its workspace says where it is.
 */
export class RenderQueue extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const waiting: Waiting = await req.json();
    const list = ((await this.ctx.storage.get<Waiting[]>('waiting')) ?? []).concat(waiting);
    await this.ctx.storage.put('waiting', list);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 202 });
  }

  async alarm() {
    const list = (await this.ctx.storage.get<Waiting[]>('waiting')) ?? [];
    if (!list.length || !this.env.FILES) return;
    const next = nextJob(list);
    await this.ctx.storage.put('waiting', list.filter((w) => w !== next));
    const job = await runJob(this.env.FILES, next.workspaceId, next.job, rendererOf(this.env));
    if (list.length > 1) await this.ctx.storage.setAlarm(Date.now());
    if (job) await tellOwner(this.env, job);
  }
}

/** the next job: the oldest of the plans with a priority, else the oldest */
export const nextJob = (list: Waiting[]): Waiting => list.find((w) => w.priority) ?? list[0];

/** whether this deployment renders: a queue, and a renderer (the container, or one started on this machine) */
export const renders = (env: Env) => !!env.RENDER_QUEUE && (!!env.RENDERER || !!env.RENDERER_URL);

/** what renders here: the container behind the Worker (container.ts, RendererContainer), else the renderer at RENDERER_URL (`pnpm renderer`) */
export function rendererOf(env: Env): Renderer {
  return async (archive, job) => {
    const q = new URLSearchParams({ quality: job.quality, ...(job.comp ? { comp: job.comp } : {}) });
    const req = (base: string) => new Request(`${base}/render?${q}`, { method: 'POST', body: archive });
    let res: Response;
    if (env.RENDERER) res = await env.RENDERER.get(env.RENDERER.idFromName('renderer')).fetch(req('http://renderer'));
    else if (env.RENDERER_URL) {
      try { res = await fetch(req(env.RENDERER_URL.replace(/\/+$/, ''))); } catch { throw new Error('the renderer is not running on this machine: start it with pnpm renderer'); }
    } else throw new Error('no renderer in this deployment');
    if (!res.ok) throw new Error(`the renderer said ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.arrayBuffer();
  };
}

/** the owner of a job of an account told it is over, by mail (the backend's); a mail that cannot leave changes nothing */
export async function tellOwner(env: Env, job: Job): Promise<void> {
  if (!job.userId || (job.status !== 'done' && job.status !== 'failed') || !(env.ACCOUNTS || env.ACCOUNTS_URL)) return;
  await internal(env, '/internal/notify/render', { body: { userId: job.userId, project: job.project, job: job.id, status: job.status } }).catch(() => {});
}

/** a job handed to the queue of this deployment */
export const enqueue = (env: Env) => async (workspaceId: string, job: Job) => {
  if (!env.RENDER_QUEUE) throw new HttpError(503, 'no export in the cloud on this deployment');
  await env.RENDER_QUEUE.get(env.RENDER_QUEUE.idFromName('queue')).fetch(new Request('http://queue/enqueue', {
    method: 'POST', body: JSON.stringify({ workspaceId, job: job.id, priority: job.priority, at: job.createdAt } satisfies Waiting),
  }));
};
