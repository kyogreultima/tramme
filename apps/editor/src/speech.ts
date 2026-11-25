// What a sound or a video says, word by word: its audio decoded here (never
// the whole file at once), cut into chunks of 28 s overlapping by 2 s, each
// chunk turned to words by the server (Whisper on Workers AI, or with the
// OpenAI key: api.reach) or, when it has none, by the local companion, or
// else by Whisper in this browser (the desktop app, the personal deployment):
// the companion and the browser run the model chosen in the settings (Models,
// Transcription). The transcript becomes a JSON asset of the project, beside the media. Nothing
// is transcribed on its own: the user starts it (ui/Transcribe.tsx), or says
// yes when the assistant asks.

import { signal } from '@preact/signals';
import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny';
import { asrWords, mergeChunks, pointer, spokenLanguage, transcriptIdOf, type Transcript, type TranscriptWord, type WhisperParts } from '@tramme/core';
import { pathIssue } from '@tramme/project';
import { account } from './accounts.ts';
import { aiStatus, companionLink, refreshStatus } from './ai/index.ts';
import { api, reach } from './api.ts';
import { safeName, takenPaths, upload } from './files.ts';
import { askUser } from './confirm.ts';
import { pipelineOf, type PipelineRun } from './perception.ts';
import { chosenModel, prefs } from './settings.ts';
import { madeBy } from './models.ts';
import { commit, S, toast } from './state.ts';
import { m, t } from './i18n/index.ts';
import { approvedProjectResource } from './plugins/host.ts';
import { tauri } from './tauri.ts';

const CHUNK = 28, STEP = 26, RATE = 16000;

/** transcriptions under way, with their progress (shown at the bottom of the screen); loading: the model's files coming down, the first time it runs in this browser */
export const transcriptions = signal<{ id: string; name: string; done: number; total: number; stage: string; loading?: { loaded: number; total: number } }[]>([]);

/** what stops each transcription under way, by its media asset */
const stops = new Map<string, AbortController>();

/** the user stops a transcription: nothing is kept of it */
export function cancelTranscription(assetId: string) { stops.get(assetId)?.abort(); }

/** a transcription the user stopped (its error is not one to tell) */
export const cancelled = (e: unknown) => (e as Error)?.name === 'AbortError';

/** 16-bit PCM WAV, mono, from samples between -1 and 1 */
function wav(samples: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** the audio of [from, to) in 16 kHz mono */
async function chunkAudio(sink: AudioBufferSink, from: number, to: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * RATE)), RATE);
  for await (const b of sink.buffers(from, to)) {
    const src = ctx.createBufferSource();
    src.buffer = b.buffer;
    src.connect(ctx.destination);
    // a buffer that starts before `from` is placed earlier, its first part falls off
    src.start(Math.max(0, b.timestamp - from), Math.max(0, from - b.timestamp));
  }
  return (await ctx.startRendering()).getChannelData(0);
}

type Backend = 'server' | 'companion' | 'browser';

type Asr = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>) & WhisperParts;

/** how a chunk goes: told where it goes before it waits there (the label says the truth), and dropped when the user cancels */
export interface ChunkWay { tell?: (backend: Backend) => void; signal?: AbortSignal; /** this backend or none: no other is tried */ only?: boolean }

/** where the server's transcription is asked: an app signed in sends it to the cloud (its api.rs), elsewhere the page's route (api.reach) */
const serverRoute = (init: RequestInit) => (tauri && account.peek().status === 'in' ? fetch('/api/transcribe', init) : reach('/api/transcribe', init));

/** one chunk to words, by the server, or by the companion when the server cannot, or else in this browser (local: how the model runs there) */
async function wordsOf(samples: Float32Array, language: string | undefined, prefer: Backend, local?: PipelineRun, way: ChunkWay = {}): Promise<{ words: TranscriptWord[]; language?: string; backend: Backend; model?: string }> {
  const audio = prefer === 'browser' ? '' : base64(wav(samples, RATE));
  const viaBrowser = async () => {
    way.tell?.('browser');
    const model = chosenModel('transcription');
    const run = await pipelineOf<Asr>(model, 'the transcription model', local);
    const { Tensor } = await import('@huggingface/transformers');
    const spoken = language ?? await spokenLanguage(run, samples, (ids) => new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]));
    const out = await run(samples, { return_timestamps: 'word', chunk_length_s: 30, language: spoken, task: 'transcribe' });
    return { words: asrWords(out), language: spoken, backend: 'browser' as const, model: madeBy(model) };
  };
  const viaServer = async () => {
    way.tell?.('server');
    const r = await serverRoute({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio, language }), signal: way.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return { ...j, backend: 'server' as const };
  };
  const viaCompanion = async () => {
    way.tell?.('companion');
    const link = companionLink();
    const r = await fetch(`${link.url}/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${link.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ audio, language, model: chosenModel('transcription').source }), signal: way.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? t('common.companionHttpStatus', { status: r.status }));
    return { ...j, backend: 'companion' as const };
  };
  if (prefer === 'companion') return viaCompanion();
  if (prefer === 'browser') return viaBrowser();
  try { return await viaServer(); }
  catch (e) {
    if (way.signal?.aborted || way.only) throw e;
    if (aiStatus.peek().companion === 'checking') await refreshStatus();
    if (aiStatus.peek().companion === 'ok') return viaCompanion();
    // no server route and no companion: Whisper here, the slowest way, never a dead end
    try { return await viaBrowser(); }
    catch (here) { throw new Error(t('speech.errorTheLocalCompanion', { error: `${(e as Error).message}; ${(here as Error).message}` })); }
  }
}

/** where each chunk of a sound starts: 28 s chunks, one every 26 s, the last reaching the end */
export function chunkStarts(duration: number): number[] {
  const starts: number[] = [];
  for (let s = 0; s < duration; s += STEP) { starts.push(s); if (s + CHUNK >= duration) break; }
  return starts;
}

/** how many chunks the server is sent at once: its Whisper answers each in a second or two, and they wait on each other otherwise */
export const SERVER_AT_ONCE = 4;

const stageOf = (b: Backend) => (b === 'companion' ? m('speech.localCompanion') : b === 'browser' ? m('speech.inThisBrowser') : m('speech.server'));

/**
 * The chunks of a sound to words, joined: audioOf gives the 16 kHz mono samples of [from, to). The first
 * chunk goes alone (it names the language and the backend that answers); on the server the others go
 * several at once, on this machine one after the other (they share its processor). A backend that fails
 * over stays the one that answered.
 */
export async function transcribeChunks(
  duration: number, audioOf: (from: number, to: number) => Promise<Float32Array>,
  opts: { language?: string; backend: Backend; onProgress?: (done: number, total: number, stage: string) => void; wordsOf?: typeof wordsOf; local?: PipelineRun; signal?: AbortSignal; only?: boolean },
) {
  const starts = chunkStarts(duration), words = opts.wordsOf ?? wordsOf;
  const chunks: { start: number; end: number; words: TranscriptWord[] }[] = new Array(starts.length), models = new Set<string>();
  let language = opts.language, backend = opts.backend, done = 0;
  const tell = (b: Backend) => opts.onProgress?.(done, starts.length, stageOf(b));
  const one = async (i: number) => {
    opts.signal?.throwIfAborted();
    const start = starts[i], end = Math.min(duration, start + CHUNK);
    const audio = await audioOf(start, end);
    opts.signal?.throwIfAborted();
    const r = await words(audio, language, backend, opts.local, { tell, signal: opts.signal, only: opts.only });
    opts.signal?.throwIfAborted();
    backend = r.backend;
    language ??= r.language;
    if (r.model) models.add(r.model);
    chunks[i] = { start, end, words: r.words.map((w) => ({ w: w.w, s: +(start + w.s).toFixed(3), e: +(start + w.e).toFixed(3) })) };
    done++;
    tell(backend);
  };
  tell(backend);
  if (starts.length) await one(0);
  let next = 1;
  const lane = async () => { while (next < starts.length) await one(next++); };
  await Promise.all(Array.from({ length: backend === 'server' ? SERVER_AT_ONCE : 1 }, lane));
  opts.signal?.throwIfAborted();
  opts.onProgress?.(starts.length, starts.length, m('speech.done'));
  return { words: mergeChunks(chunks), language, models };
}

/** the words of a media file at url, with their timing in the file */
export async function transcribeUrl(url: string, opts: { language?: string; onProgress?: (done: number, total: number, stage: string) => void; signal?: AbortSignal; local?: PipelineRun } = {}): Promise<Transcript> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(t('speech.thisFileHasNo'));
    if (!(await track.canDecode())) throw new Error(t('speech.soundCannotBeDecoded', { codec: track.codec ?? t('common.unknown') }));
    const duration = await input.computeDuration();
    const sink = new AudioBufferSink(track);
    const { words, language, models } = await transcribeChunks(duration, (from, to) => chunkAudio(sink, from, to), { language: opts.language, backend: 'server', onProgress: opts.onProgress, signal: opts.signal, local: opts.local });
    return { version: 1, language, duration: +duration.toFixed(3), words, ...(models.size ? { madeBy: [...models] } : {}) };
  } finally {
    input.dispose();
  }
}

/** where a dictation is transcribed: auto (the server when it hears, else the downloaded model), the downloaded model (in this browser), the local companion, or the server (the fallbacks of a sound's transcription) */
export type DictationSource = 'auto' | 'local' | 'companion' | 'server';

/** whether the server transcribes: an app signed in (the cloud's Whisper), or a server whose config says so (Workers AI, an OpenAI key) */
export async function serverHears(): Promise<boolean> {
  if (tauri && account.peek().status === 'in') return true;
  try { return !!(await api.config()).transcribe; } catch { return false; }
}

/** what was said in 16 kHz mono samples (a dictation), as text; the language is detected */
export async function transcribeSamples(samples: Float32Array, source: Exclude<DictationSource, 'auto'>, opts: { local?: PipelineRun; words?: typeof wordsOf; only?: boolean } = {}): Promise<string> {
  const backend: Backend = source === 'local' ? 'browser' : source;
  const { words: said } = await transcribeChunks(samples.length / RATE, async (from, to) => samples.subarray(Math.round(from * RATE), Math.round(to * RATE)), { backend, wordsOf: opts.words, local: opts.local, only: opts.only });
  return said.map((w) => w.w).join(' ').trim();
}

/** id of the transcript asset of a media asset (defined in the core, with the rest of the transcript domain) */
export { transcriptIdOf };

/**
 * Transcribes a media asset of the open project: the words go to
 * assets/transcripts/<name>.json and an asset `transcription-<id>` points at
 * them. Returns the transcript asset id.
 */
/** transcriptions under way: asking again waits for the same one */
const running = new Map<string, Promise<string>>();
const projectStamp = () => `${S.project.peek()?.id ?? ''}\n${S.docUrl.peek()}`;
const requireProject = (stamp: string) => { if (projectStamp() !== stamp) throw new Error(t('transcribe.projectChanged')); };

export function transcribeAsset(assetId: string, language?: string): Promise<string> {
  const key = `${projectStamp()}\n${assetId}`;
  let job = running.get(key);
  if (!job) {
    job = transcribe(assetId, language).finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}

/** a transcription of this asset under way */
export const transcribing = (assetId: string) => transcriptions.value.some((j) => j.id === assetId);

/**
 * The transcript of a media asset for the assistant: there already, or under
 * way (waited for). The user is the one who starts a transcription: with
 * `ask`, the assistant asks them (never in a turn left alone); otherwise, or
 * when they say no, it is told to do without. The setting "let the assistant
 * transcribe without asking" is their yes in advance, in a turn left alone too.
 */
export async function transcriptFor(assetId: string, ask: boolean): Promise<string> {
  const stamp = projectStamp();
  const id = transcriptIdOf(assetId), a = S.doc.peek().assets[assetId];
  if (S.doc.peek().assets[id]) return id;
  const job = running.get(`${stamp}\n${assetId}`);
  if (job) { const result = await job; requireProject(stamp); return result; }
  if (ask && (prefs.peek().assistantTranscribes || await askUser(t('transcribe.askTitle'), t('transcribe.askText', { name: a?.name || assetId }), t('transcribe.action')))) {
    requireProject(stamp);
    return transcribeAsset(assetId);
  }
  throw new Error(`"${assetId}" is not transcribed and the user starts transcriptions themselves (the Transcribe button on the media): ${ask ? 'they declined for now' : 'ask them to'}, or work without what is said`);
}

async function transcribe(assetId: string, language?: string): Promise<string> {
  const stamp = projectStamp(), docUrl = S.docUrl.peek();
  const doc = S.doc.peek(), a = doc.assets[assetId];
  if (!a || (a.type !== 'video' && a.type !== 'audio')) throw new Error(t('speech.aSoundOrA'));
  const job = { id: assetId, name: a.name || assetId, done: 0, total: 1, stage: m('speech.preparing') };
  transcriptions.value = [...transcriptions.peek().filter((j) => j.id !== assetId), job];
  const stop = new AbortController();
  stops.set(assetId, stop);
  const update = (change: Partial<typeof job> & { loading?: { loaded: number; total: number } }) => { transcriptions.value = transcriptions.peek().map((j) => (j.id === assetId ? { ...j, ...change } : j)); };
  try {
    if (pathIssue(a.src) || /[%#]/.test(a.src) || !a.src.startsWith('assets/')) throw new Error(`${assetId}: transcription source must be a project asset`);
    const base = new URL(docUrl, location.href), root = new URL('./', base), url = new URL(a.src, base);
    if (!approvedProjectResource(url, root.pathname, root.origin, root.protocol)) throw new Error(`${assetId}: transcription source must belong to this project`);
    const tr = await transcribeUrl(url.href, {
      language, signal: stop.signal,
      onProgress: (done, total, stage) => update({ done, total, stage }),
      // Whisper in this browser: its files come down the first time, hundreds of MB, said as they come
      local: { progress: (loaded, total) => update({ loading: loaded < total ? { loaded, total } : undefined }) },
    });
    requireProject(stamp);
    tr.source = assetId;
    const name = safeName(`${(a.src.split('/').pop() ?? assetId).replace(/\.[^.]+$/, '')}.json`);
    const taken = await takenPaths();
    requireProject(stamp);
    const path = await upload(taken, `assets/transcripts/${name}`, new Blob([JSON.stringify(tr)], { type: 'application/json' }));
    requireProject(stamp);
    const id = transcriptIdOf(assetId), had = !!S.doc.peek().assets[id];
    commit(t('common.transcriptOfName', { name: a.name || assetId }), [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name: `${t('speech.transcript')} · ${a.name || assetId}`, ...(tr.madeBy ? { madeBy: tr.madeBy } : {}) } }]);
    toast(t('speech.transcriptReadyNWords', { n: tr.words.length, language: tr.language ?? t('speech.languageDetected') }));
    return id;
  } finally {
    stops.delete(assetId);
    transcriptions.value = transcriptions.peek().filter((j) => j.id !== assetId);
  }
}
