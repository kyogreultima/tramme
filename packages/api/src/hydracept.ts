// Hydracept durable jobs for OpenAI images and ElevenLabs SFX/voice (quote, then job, receipt id).

import { HttpError } from './http.ts';
import type { HydraceptMedia } from './media.ts';

const CLIENT = 'tramme-api hydracept/1';
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled']);
const POLL_CAP_MS = 120_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface JobPayload {
  jobId?: string;
  id?: string;
  status?: string;
  receiptId?: string;
  artifacts?: { artifactId?: string; id?: string; mediaType?: string; mimeType?: string }[];
  pollAfterSeconds?: number;
  error?: { message?: string; code?: string };
}

export interface HydraceptRun {
  bytes: ArrayBuffer;
  type: string;
  model: string;
  receiptId: string;
  quoteId: string;
  voice?: string;
}

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function authHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-hydracept-client': CLIENT, ...extra };
}

function url(base: string, path: string): string {
  const p = path.startsWith('/v1/') ? path : `/v1${path.startsWith('/') ? path : `/${path}`}`;
  return `${base.replace(/\/+$/, '')}${p}`;
}

async function hydraceptFailure(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  try {
    const j = await res.json() as { detail?: { message?: string } | string; error?: { message?: string } | string; message?: string; code?: string };
    const d = j.detail, e = j.error;
    message = (typeof d === 'string' ? d : typeof d === 'object' && d && 'message' in d ? d.message : undefined)
      ?? (typeof e === 'string' ? e : typeof e === 'object' && e && 'message' in e ? e.message : undefined)
      ?? j.message ?? j.code ?? message;
  } catch { /* not JSON */ }
  throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400, `hydracept: ${message}`);
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) await hydraceptFailure(res);
  return res.json() as Promise<T>;
}

function context(media: HydraceptMedia) {
  return { productId: media.productId, projectId: media.projectId, environment: media.environment };
}

function execution(media: HydraceptMedia) {
  return {
    executionPreference: 'automatic',
    ...(media.billingMode ? { billingMode: media.billingMode } : {}),
  };
}

function quoteIdOf(q: Record<string, unknown>): string {
  const top = q.quoteId ?? q.estimateId;
  if (typeof top === 'string' && top) return top;
  const pricing = q.pricing as { quote?: { quoteId?: string; estimateId?: string } } | undefined;
  const nested = pricing?.quote?.quoteId ?? pricing?.quote?.estimateId;
  if (typeof nested === 'string' && nested) return nested;
  throw new HttpError(502, 'hydracept: no quote id in the quote answer');
}

async function quote(media: HydraceptMedia, capability: string, input: Record<string, unknown>, fetch: Fetch): Promise<string> {
  const body = { context: context(media), input, execution: execution(media) };
  const res = await fetch(url(media.apiUrl, `/capabilities/${encodeURIComponent(capability)}/quote`), {
    method: 'POST', headers: authHeaders(media.apiKey), body: JSON.stringify(body),
  });
  const q = await readJson<Record<string, unknown>>(res);
  return quoteIdOf(q);
}

async function submitJob(media: HydraceptMedia, capability: string, input: Record<string, unknown>, fetch: Fetch): Promise<string> {
  const body = {
    context: context(media),
    input,
    execution: execution(media),
    idempotencyKey: idempotencyKey(),
  };
  const res = await fetch(url(media.apiUrl, `/capabilities/${encodeURIComponent(capability)}/jobs`), {
    method: 'POST', headers: authHeaders(media.apiKey), body: JSON.stringify(body),
  });
  const j = await readJson<JobPayload>(res);
  const jobId = j.jobId ?? j.id;
  if (!jobId) throw new HttpError(502, 'hydracept: no job id in the submit answer');
  return jobId;
}

async function getJob(media: HydraceptMedia, jobId: string, fetch: Fetch): Promise<JobPayload> {
  const res = await fetch(url(media.apiUrl, `/jobs/${encodeURIComponent(jobId)}`), { headers: authHeaders(media.apiKey) });
  return readJson(res);
}

async function pollJob(media: HydraceptMedia, jobId: string, fetch: Fetch): Promise<JobPayload> {
  const deadline = Date.now() + POLL_CAP_MS;
  let job = await getJob(media, jobId, fetch);
  while (!TERMINAL.has(String(job.status ?? '').toLowerCase())) {
    if (Date.now() >= deadline) throw new HttpError(504, 'hydracept: the job did not finish in time');
    const wait = Math.max(1, Number(job.pollAfterSeconds) || 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    job = await getJob(media, jobId, fetch);
  }
  const status = String(job.status ?? '').toLowerCase();
  if (status !== 'succeeded') {
    const msg = job.error?.message ?? job.error?.code ?? status;
    throw new HttpError(status === 'failed' ? 502 : 400, `hydracept: ${msg}`);
  }
  return job;
}

async function receiptIdFor(media: HydraceptMedia, jobId: string, job: JobPayload, fetch: Fetch): Promise<string> {
  if (typeof job.receiptId === 'string' && job.receiptId) return job.receiptId;
  const res = await fetch(url(media.apiUrl, `/jobs/${encodeURIComponent(jobId)}/receipt`), { headers: authHeaders(media.apiKey) });
  const r = await readJson<Record<string, unknown>>(res);
  const id = r.receiptId ?? r.id ?? (r.receipt as { receiptId?: string } | undefined)?.receiptId;
  if (typeof id === 'string' && id) return id;
  throw new HttpError(502, 'hydracept: no receipt id on the finished job');
}

function firstArtifact(job: JobPayload): { artifactId: string; type: string } {
  const list = job.artifacts ?? [];
  const item = list[0];
  const artifactId = item?.artifactId ?? item?.id;
  if (!artifactId) throw new HttpError(502, 'hydracept: no artifact on the finished job');
  const type = (item?.mediaType ?? item?.mimeType ?? 'application/octet-stream').split(';')[0];
  return { artifactId, type };
}

async function downloadArtifact(media: HydraceptMedia, jobId: string, artifactId: string, fetch: Fetch): Promise<ArrayBuffer> {
  const res = await fetch(url(media.apiUrl, `/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`), {
    headers: { authorization: `Bearer ${media.apiKey}`, 'x-hydracept-client': CLIENT },
  });
  if (!res.ok) await hydraceptFailure(res);
  return res.arrayBuffer();
}

async function runJob(
  media: HydraceptMedia,
  capability: string,
  input: Record<string, unknown>,
  fetch: Fetch,
  model: string,
  voice?: string,
): Promise<HydraceptRun> {
  const quoteId = await quote(media, capability, input, fetch);
  const jobId = await submitJob(media, capability, input, fetch);
  const job = await pollJob(media, jobId, fetch);
  const receiptId = await receiptIdFor(media, jobId, job, fetch);
  const { artifactId, type } = firstArtifact(job);
  const bytes = await downloadArtifact(media, jobId, artifactId, fetch);
  return { bytes, type, model, receiptId, quoteId, voice };
}

const WIDE = ['21:9', '16:9', '3:2', '5:4'], TALL = ['9:16', '2:3', '4:5', '3:4'];

export function hydraceptImageSize(ratio: string): { width: number; height: number } {
  if (WIDE.includes(ratio)) return { width: 1536, height: 1024 };
  if (TALL.includes(ratio)) return { height: 1536, width: 1024 };
  return { width: 1024, height: 1024 };
}

const IMAGE_MODEL = 'gpt-image-1';

export async function hydraceptImage(
  media: HydraceptMedia,
  ask: { prompt: string; ratio: string; quality?: 'low' | 'medium' | 'high' },
  fetch: Fetch,
): Promise<HydraceptRun> {
  const { width, height } = hydraceptImageSize(ask.ratio);
  const input: Record<string, unknown> = {
    prompt: ask.prompt,
    width,
    height,
    model: IMAGE_MODEL,
    ...(ask.quality ? { quality: ask.quality } : {}),
  };
  return runJob(media, 'image.generate.v1', input, fetch, IMAGE_MODEL);
}

export async function hydraceptSfx(
  media: HydraceptMedia,
  ask: { prompt: string; duration?: number },
  fetch: Fetch,
): Promise<HydraceptRun> {
  const durationMs = ask.duration ? Math.round(Math.min(30, Math.max(0.5, ask.duration)) * 1000) : undefined;
  const input: Record<string, unknown> = {
    prompt: ask.prompt,
    modelId: 'eleven_text_to_sound_v2',
    promptInfluence: 0.5,
    ...(durationMs ? { durationMs } : {}),
  };
  return runJob(media, 'audio.sfx.generate.v1', input, fetch, 'eleven_text_to_sound_v2');
}

export async function hydraceptVoice(
  media: HydraceptMedia,
  ask: { prompt: string; voice?: string; style?: string; model?: string },
  fetch: Fetch,
  voiceModels: Record<string, string>,
  taggedModels: Set<string>,
  defaultVoice: string,
  defaultModel: string,
): Promise<HydraceptRun> {
  const model = ask.model && ask.model in voiceModels ? ask.model : defaultModel;
  const [, id] = (ask.voice || defaultVoice).includes('/') ? ask.voice!.split('/', 2) : [null, ask.voice || defaultVoice];
  const voice = id;
  const text = ask.style && taggedModels.has(model) ? `[${ask.style}] ${ask.prompt}` : ask.prompt;
  const input: Record<string, unknown> = { text, voiceId: voice, modelId: model };
  return runJob(media, 'audio.voice.generate.v1', input, fetch, model, voice);
}

/** response headers that carry Hydracept ids (never secrets) */
export function hydraceptHeaders(run: HydraceptRun): Record<string, string> {
  return { 'x-tramme-hydracept-receipt': run.receiptId, 'x-tramme-hydracept-quote': run.quoteId };
}
