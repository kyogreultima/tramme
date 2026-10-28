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
import { asrWords, mergeChunks, pointer, transcriptIdOf, type Transcript, type TranscriptWord } from '@tramme/core';
import { aiStatus, companionLink, refreshStatus } from './ai/index.ts';
import { reach } from './api.ts';
import { safeName, takenPaths, upload } from './files.ts';
import { askUser } from './confirm.ts';
import { pipelineOf, type PipelineRun } from './perception.ts';
import { chosenModel } from './settings.ts';
import { madeBy } from './models.ts';
import { commit, S, toast } from './state.ts';
import { m, t } from './i18n/index.ts';

const CHUNK = 28, STEP = 26, RATE = 16000;

/** transcriptions under way, with their progress (shown at the bottom of the screen) */
export const transcriptions = signal<{ id: string; name: string; done: number; total: number; stage: string }[]>([]);

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

/** what of a Whisper pipeline the language detection reads: its model (called for one step) and its processor */
interface WhisperParts {
  model: ((inputs: { input_features: unknown; decoder_input_ids: unknown }) => Promise<{ logits: { data: ArrayLike<number> } }>)
    & { generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> } };
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
}
type Asr = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>) & WhisperParts;

/**
 * The language spoken, as Whisper hears it: one step of its decoder after
 * the start of the transcript, the most likely language token. transformers.js
 * does not detect it, and transcribes as English when it is not told.
 */
export async function spokenLanguage(run: WhisperParts, samples: Float32Array): Promise<string> {
  const { Tensor } = await import('@huggingface/transformers');
  const { decoder_start_token_id: start, lang_to_id: languages } = run.model.generation_config;
  const { input_features } = await run.processor(samples);
  const { logits } = await run.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(start)]), [1, 1]) });
  let best = 'en', score = -Infinity;
  for (const [token, id] of Object.entries(languages)) if (logits.data[id] > score) { score = logits.data[id]; best = token.slice(2, -2); }
  return best;
}

/** one chunk to words, by the server, or by the companion when the server cannot, or else in this browser (local: how the model runs there) */
async function wordsOf(samples: Float32Array, language: string | undefined, prefer: Backend, local?: PipelineRun): Promise<{ words: TranscriptWord[]; language?: string; backend: Backend; model?: string }> {
  const audio = prefer === 'browser' ? '' : base64(wav(samples, RATE));
  const viaBrowser = async () => {
    const model = chosenModel('transcription');
    const run = await pipelineOf<Asr>(model, 'the transcription model', local);
    const spoken = language ?? await spokenLanguage(run, samples);
    const out = await run(samples, { return_timestamps: 'word', chunk_length_s: 30, language: spoken, task: 'transcribe' });
    return { words: asrWords(out), language: spoken, backend: 'browser' as const, model: madeBy(model) };
  };
  const viaServer = async () => {
    const r = await reach('/api/transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio, language }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return { ...j, backend: 'server' as const };
  };
  const viaCompanion = async () => {
    const link = companionLink();
    const r = await fetch(`${link.url}/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${link.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ audio, language, model: chosenModel('transcription').source }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? t('common.companionHttpStatus', { status: r.status }));
    return { ...j, backend: 'companion' as const };
  };
  if (prefer === 'companion') return viaCompanion();
  if (prefer === 'browser') return viaBrowser();
  try { return await viaServer(); }
  catch (e) {
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

/** the chunks of a sound to words, joined: audioOf gives the 16 kHz mono samples of [from, to); a backend that fails over stays the one that answered */
async function transcribeChunks(
  duration: number, audioOf: (from: number, to: number) => Promise<Float32Array>,
  opts: { language?: string; backend: Backend; onProgress?: (done: number, total: number, stage: string) => void; wordsOf?: typeof wordsOf; local?: PipelineRun },
) {
  const starts = chunkStarts(duration), words = opts.wordsOf ?? wordsOf;
  const chunks: { start: number; end: number; words: TranscriptWord[] }[] = [], models = new Set<string>();
  let language = opts.language, backend = opts.backend;
  for (const [i, start] of starts.entries()) {
    const end = Math.min(duration, start + CHUNK);
    opts.onProgress?.(i, starts.length, backend === 'companion' ? m('speech.localCompanion') : backend === 'browser' ? m('speech.inThisBrowser') : m('speech.server'));
    const r = await words(await audioOf(start, end), language, backend, opts.local);
    backend = r.backend;
    language ??= r.language;
    if (r.model) models.add(r.model);
    chunks.push({ start, end, words: r.words.map((w) => ({ w: w.w, s: +(start + w.s).toFixed(3), e: +(start + w.e).toFixed(3) })) });
  }
  opts.onProgress?.(starts.length, starts.length, m('speech.done'));
  return { words: mergeChunks(chunks), language, models };
}

/** the words of a media file at url, with their timing in the file */
export async function transcribeUrl(url: string, opts: { language?: string; onProgress?: (done: number, total: number, stage: string) => void } = {}): Promise<Transcript> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(t('speech.thisFileHasNo'));
    if (!(await track.canDecode())) throw new Error(t('speech.soundCannotBeDecoded', { codec: track.codec ?? t('common.unknown') }));
    const duration = await input.computeDuration();
    const sink = new AudioBufferSink(track);
    const { words, language, models } = await transcribeChunks(duration, (from, to) => chunkAudio(sink, from, to), { language: opts.language, backend: 'server', onProgress: opts.onProgress });
    return { version: 1, language, duration: +duration.toFixed(3), words, ...(models.size ? { madeBy: [...models] } : {}) };
  } finally {
    input.dispose();
  }
}

/** where a dictation is transcribed: the downloaded model (in this browser), the local companion, or the server (the fallbacks of a sound's transcription) */
export type DictationSource = 'local' | 'companion' | 'server';

/** what was said in 16 kHz mono samples (a dictation), as text; the language is detected */
export async function transcribeSamples(samples: Float32Array, source: DictationSource, opts: { local?: PipelineRun; words?: typeof wordsOf } = {}): Promise<string> {
  const backend: Backend = source === 'local' ? 'browser' : source;
  const { words: said } = await transcribeChunks(samples.length / RATE, async (from, to) => samples.subarray(Math.round(from * RATE), Math.round(to * RATE)), { backend, wordsOf: opts.words, local: opts.local });
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

export function transcribeAsset(assetId: string, language?: string): Promise<string> {
  let job = running.get(assetId);
  if (!job) {
    job = transcribe(assetId, language).finally(() => running.delete(assetId));
    running.set(assetId, job);
  }
  return job;
}

/** a transcription of this asset under way */
export const transcribing = (assetId: string) => transcriptions.value.some((j) => j.id === assetId);

/**
 * The transcript of a media asset for the assistant: there already, or under
 * way (waited for). The user is the one who starts a transcription: with
 * `ask`, the assistant asks them (never in a turn left alone); otherwise, or
 * when they say no, it is told to do without.
 */
export async function transcriptFor(assetId: string, ask: boolean): Promise<string> {
  const id = transcriptIdOf(assetId), a = S.doc.peek().assets[assetId];
  if (S.doc.peek().assets[id]) return id;
  const job = running.get(assetId);
  if (job) return job;
  if (ask && await askUser(t('transcribe.askTitle'), t('transcribe.askText', { name: a?.name || assetId }), t('transcribe.action'))) return transcribeAsset(assetId);
  throw new Error(`"${assetId}" is not transcribed and the user starts transcriptions themselves (the Transcribe button on the media): ${ask ? 'they declined for now' : 'ask them to'}, or work without what is said`);
}

async function transcribe(assetId: string, language?: string): Promise<string> {
  const doc = S.doc.peek(), a = doc.assets[assetId];
  if (!a || (a.type !== 'video' && a.type !== 'audio')) throw new Error(t('speech.aSoundOrA'));
  const job = { id: assetId, name: a.name || assetId, done: 0, total: 1, stage: m('speech.preparing') };
  transcriptions.value = [...transcriptions.peek().filter((j) => j.id !== assetId), job];
  try {
    const url = new URL(a.src, new URL(S.docUrl.peek(), location.href)).href;
    const tr = await transcribeUrl(url, { language, onProgress: (done, total, stage) => { transcriptions.value = transcriptions.peek().map((j) => (j.id === assetId ? { ...j, done, total, stage } : j)); } });
    tr.source = assetId;
    const name = safeName(`${(a.src.split('/').pop() ?? assetId).replace(/\.[^.]+$/, '')}.json`);
    const path = await upload(await takenPaths(), `assets/transcripts/${name}`, new Blob([JSON.stringify(tr)], { type: 'application/json' }));
    const id = transcriptIdOf(assetId), had = !!S.doc.peek().assets[id];
    commit(t('common.transcriptOfName', { name: a.name || assetId }), [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name: `${t('speech.transcript')} · ${a.name || assetId}`, ...(tr.madeBy ? { madeBy: tr.madeBy } : {}) } }]);
    toast(t('speech.transcriptReadyNWords', { n: tr.words.length, language: tr.language ?? t('speech.languageDetected') }));
    return id;
  } finally {
    transcriptions.value = transcriptions.peek().filter((j) => j.id !== assetId);
  }
}
