// Hydracept: OpenAI images and ElevenLabs sound effects, music and voice-overs
// as durable jobs (a quote, then the job, then its receipt), with one key and
// the project it belongs to (Settings, Providers, or the Worker's secrets).

import { providerFailure } from './generate.ts';
import { HttpError } from './http.ts';
import type { Keys } from './keys.ts';

/** what a call to Hydracept needs: the key, and the project and environment it belongs to */
export interface HydraceptMedia {
  apiKey: string;
  apiUrl: string;
  productId: string;
  projectId: string;
  environment: string;
}

export const HYDRACEPT_API = 'https://api.hydracept.com';

/** Hydracept as connected (key and project from the same place), or nothing */
export function hydraceptOf(key: string, keys: Keys): HydraceptMedia {
  const projectId = keys.field('hydracept', 'project');
  if (!projectId) throw new HttpError(503, `no hydracept project: ${keys.how(['hydracept'])}`);
  return { apiKey: key, apiUrl: HYDRACEPT_API, productId: 'tramme', projectId, environment: keys.field('hydracept', 'environment') || 'development' };
}

const CLIENT = 'tramme-api hydracept/1';

/** Hydracept audio.sfx/voice input: mp3_44100_128 → artifact mediaType audio/mpeg (tramme-compatible). */
export const HYDRACEPT_AUDIO_MP3 = 'mp3_44100_128' as const;
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled', 'needs_attention']);
const IMAGE_POLL_MS = 180_000;
const SFX_POLL_MS = 120_000;
const MUSIC_POLL_MS = 360_000;
const VOICE_POLL_MS = 300_000;
/** Hydracept rejects SFX prompts over 450 characters (overflow: reject). */
const SFX_PROMPT_MAX = 450;
/** Hydracept clamps music to 300 seconds. */
const MUSIC_MAX_SECONDS = 300;
/** Voice models Hydracept can execute, as the editor's picker labels them. */
export const HYDRACEPT_VOICE_MODELS: Record<string, string> = {
  eleven_v4: 'Eleven v4',
  eleven_multilingual_v2: 'Multilingual v2',
  eleven_turbo_v2_5: 'Turbo v2.5',
  eleven_flash_v2_5: 'Flash v2.5',
};
const HYDRACEPT_VOICE_MODEL_IDS = new Set(Object.keys(HYDRACEPT_VOICE_MODELS));
const HYDRACEPT_VOICE_DEFAULT = 'eleven_v4';

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

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) await providerFailure('hydracept', res);
  return res.json() as Promise<T>;
}

function context(media: HydraceptMedia) {
  return { productId: media.productId, projectId: media.projectId, environment: media.environment };
}

function execution() {
  return { executionPreference: 'automatic' };
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
  const body = { context: context(media), input, execution: execution() };
  const res = await fetch(url(media.apiUrl, `/capabilities/${encodeURIComponent(capability)}/quote`), {
    method: 'POST', headers: authHeaders(media.apiKey), body: JSON.stringify(body),
  });
  const q = await readJson<Record<string, unknown>>(res);
  if (q.status === 'pricing_inputs_required') {
    const missing = Array.isArray(q.missing) ? (q.missing as unknown[]).map(String).join(', ') : 'more input';
    throw new HttpError(422, `hydracept: quote requires ${missing}`);
  }
  return quoteIdOf(q);
}

async function submitJob(
  media: HydraceptMedia,
  capability: string,
  input: Record<string, unknown>,
  quoteId: string,
  fetch: Fetch,
): Promise<string> {
  const body = {
    context: context(media),
    input,
    execution: { ...execution(), quoteId },
    idempotencyKey: idempotencyKey(),
  };
  const send = () => fetch(url(media.apiUrl, `/capabilities/${encodeURIComponent(capability)}/jobs`), {
    method: 'POST', headers: authHeaders(media.apiKey), body: JSON.stringify(body),
  });
  // Same idempotency key on the retry: a lost response must not start a second job.
  let res: Response;
  try {
    res = await send();
  } catch {
    res = await send();
  }
  const j = await readJson<JobPayload>(res);
  const jobId = j.jobId ?? j.id;
  if (!jobId) throw new HttpError(502, 'hydracept: no job id in the submit answer');
  return jobId;
}

async function getJob(media: HydraceptMedia, jobId: string, fetch: Fetch): Promise<JobPayload> {
  const res = await fetch(url(media.apiUrl, `/jobs/${encodeURIComponent(jobId)}`), { headers: authHeaders(media.apiKey) });
  return readJson(res);
}

async function pollJob(media: HydraceptMedia, jobId: string, fetch: Fetch, capMs: number): Promise<JobPayload> {
  const deadline = Date.now() + capMs;
  let job = await getJob(media, jobId, fetch);
  while (!TERMINAL.has(String(job.status ?? '').toLowerCase())) {
    if (Date.now() >= deadline) throw new HttpError(504, 'hydracept: the job did not finish in time');
    // the wait Hydracept asks for, never past the deadline
    const wait = Math.min(Math.max(1, Number(job.pollAfterSeconds) || 2) * 1000, deadline - Date.now());
    await new Promise((r) => setTimeout(r, wait));
    job = await getJob(media, jobId, fetch);
  }
  const status = String(job.status ?? '').toLowerCase();
  if (status !== 'succeeded') {
    const msg = job.error?.message ?? job.error?.code
      ?? (status === 'needs_attention' ? 'the job needs attention in Hydracept Studio' : status);
    throw new HttpError(status === 'failed' || status === 'needs_attention' ? 502 : 400, `hydracept: ${msg}`);
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
  if (!res.ok) await providerFailure('hydracept', res);
  return res.arrayBuffer();
}

async function runJob(
  media: HydraceptMedia,
  capability: string,
  input: Record<string, unknown>,
  fetch: Fetch,
  model: string,
  pollCapMs: number,
  voice?: string,
): Promise<HydraceptRun> {
  const quoteId = await quote(media, capability, input, fetch);
  const jobId = await submitJob(media, capability, input, quoteId, fetch);
  const job = await pollJob(media, jobId, fetch, pollCapMs);
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

const IMAGE_MODEL = 'gpt-image-2.5-flare';

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
  return runJob(media, 'image.generate.v1', input, fetch, IMAGE_MODEL, IMAGE_POLL_MS);
}

export async function hydraceptSfx(
  media: HydraceptMedia,
  ask: { prompt: string; duration?: number },
  fetch: Fetch,
): Promise<HydraceptRun> {
  if (ask.prompt.length > SFX_PROMPT_MAX) {
    throw new HttpError(413, `hydracept: sound effects take at most ${SFX_PROMPT_MAX} characters`);
  }
  const durationMs = ask.duration ? Math.round(Math.min(30, Math.max(0.5, ask.duration)) * 1000) : undefined;
  const input: Record<string, unknown> = {
    prompt: ask.prompt,
    modelId: 'eleven_text_to_sound_v2',
    promptInfluence: 0.5,
    outputFormatPreference: HYDRACEPT_AUDIO_MP3,
    ...(durationMs ? { durationMs } : {}),
  };
  return runJob(media, 'audio.sfx.generate.v1', input, fetch, 'eleven_text_to_sound_v2', SFX_POLL_MS);
}

const MUSIC_MODEL = 'music_v2';

export async function hydraceptMusic(
  media: HydraceptMedia,
  ask: { prompt: string; duration?: number },
  fetch: Fetch,
): Promise<HydraceptRun> {
  const durationMs = ask.duration ? Math.round(clampMusicSeconds(ask.duration) * 1000) : undefined;
  const input: Record<string, unknown> = {
    prompt: ask.prompt,
    modelId: MUSIC_MODEL,
    forceInstrumental: true,
    outputFormatPreference: HYDRACEPT_AUDIO_MP3,
    ...(durationMs ? { durationMs } : {}),
  };
  return runJob(media, 'audio.music.generate.v1', input, fetch, MUSIC_MODEL, MUSIC_POLL_MS);
}

function clampMusicSeconds(v: number): number {
  return Math.min(MUSIC_MAX_SECONDS, Math.max(3, v));
}

export async function hydraceptVoice(
  media: HydraceptMedia,
  ask: { prompt: string; voice?: string; style?: string; model?: string },
  fetch: Fetch,
  taggedModels: Set<string>,
  defaultVoice: string,
): Promise<HydraceptRun> {
  const model = ask.model && HYDRACEPT_VOICE_MODEL_IDS.has(ask.model) ? ask.model : HYDRACEPT_VOICE_DEFAULT;
  const [, id] = (ask.voice || defaultVoice).includes('/') ? ask.voice!.split('/', 2) : [null, ask.voice || defaultVoice];
  const voice = id;
  const text = ask.style && taggedModels.has(model) ? `[${ask.style}] ${ask.prompt}` : ask.prompt;
  const input: Record<string, unknown> = { text, voiceId: voice, modelId: model, outputFormatPreference: HYDRACEPT_AUDIO_MP3 };
  return runJob(media, 'audio.voice.generate.v1', input, fetch, model, VOICE_POLL_MS, voice);
}

/** response headers that carry Hydracept ids (never secrets) */
export function hydraceptHeaders(run: HydraceptRun): Record<string, string> {
  return { 'x-tramme-hydracept-receipt': run.receiptId, 'x-tramme-hydracept-quote': run.quoteId };
}

export interface HydraceptVoiceCatalog {
  capabilityKey: string;
  source: 'byok' | 'managed' | 'curated';
  voices: {
    voiceId: string;
    name: string;
    category?: string | null;
    description?: string | null;
    previewUrl?: string | null;
  }[];
}

/** GET /v1/capabilities/audio.voice.generate.v1/voices (OpenAPI: HydraceptVoiceCatalog). */
export async function fetchHydraceptVoices(media: HydraceptMedia, fetch: Fetch): Promise<HydraceptVoiceCatalog> {
  const params = new URLSearchParams({ projectId: media.projectId, environment: media.environment });
  const res = await fetch(url(media.apiUrl, `/capabilities/audio.voice.generate.v1/voices?${params}`), {
    headers: { authorization: `Bearer ${media.apiKey}`, 'x-hydracept-client': CLIENT },
  });
  return readJson(res);
}

/** tramme Voice list from a Hydracept catalog (search filters name and description). */
export function mapHydraceptVoices(
  catalog: HydraceptVoiceCatalog,
  search = '',
): { id: string; name: string; provider: 'hydracept'; source: 'account' | 'library'; description?: string; preview?: string }[] {
  const source = catalog.source === 'curated' ? 'library' as const : 'account' as const;
  const q = search.toLowerCase();
  return catalog.voices
    .filter((v) => !q || v.name.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q))
    .map((v) => ({
      id: v.voiceId,
      name: v.name,
      provider: 'hydracept' as const,
      source,
      ...(v.description ? { description: String(v.description).slice(0, 200) } : {}),
      ...(v.previewUrl ? { preview: v.previewUrl } : {}),
    }));
}
