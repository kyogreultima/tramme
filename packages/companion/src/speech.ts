// Speech to text on this machine, for the companion: Whisper run locally with
// transformers.js (no account, no key). The model downloads once, on first
// use, into the user's cache. Same input and output as the Worker's route:
// a WAV chunk (16 kHz mono) in, words with their timing out. The model is
// the one chosen in the editor's settings (Models, Transcription), unless
// TRAMME_WHISPER_MODEL names another for this machine.

//
// Whisper runs in a thread of its own (the same module, started again as a worker): loading a model of a
// gigabyte and hearing a chunk keep the processor for minutes on some machines, and the companion goes on
// answering meanwhile (the assistant's turns, the editor asking whether it is there).
//
// The published companion leaves transformers.js out (onnxruntime weighs ~150 MB):
// the first transcription installs it once, with npm, into ~/.tramme/whisper.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import spawn from 'cross-spawn';
import { asrWords, spokenLanguage, type WhisperParts } from '@tramme/core';

const DEFAULT_MODEL = 'Xenova/whisper-small';
/** the transformers.js the editor uses (the root package.json), installed where the companion runs without it */
export const WHISPER_PACKAGE = '@huggingface/transformers@4.3.2';
const WHISPER_DIR = path.join(os.homedir(), '.tramme', 'whisper');

type Transformers = typeof import('@huggingface/transformers');

/** npm, the one that started this companion (npx says where) or the one on the PATH */
function npm(args: string[]): Promise<void> {
  const cli = process.env.npm_execpath;
  const [command, rest] = cli && /npm-cli\.c?js$/.test(cli) ? [process.execPath, [cli, ...args]] : ['npm', args];
  return new Promise((resolve, reject) => {
    let errors = '';
    const child = spawn(command, rest, { cwd: WHISPER_DIR, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    child.stderr?.on('data', (c: Buffer) => { errors = (errors + c.toString('utf8')).slice(-2000); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errors.trim().split(/\r?\n/).slice(-3).join('\n') || `npm stopped (code ${code})`))));
  });
}

/** the package's name, without its version */
const WHISPER_NAME = WHISPER_PACKAGE.slice(0, WHISPER_PACKAGE.lastIndexOf('@'));

/** the install into ~/.tramme/whisper, once for the requests that wait on it together */
let installing: Promise<void> | null = null;
function install(): Promise<void> {
  installing ??= (async () => {
    fs.mkdirSync(WHISPER_DIR, { recursive: true });
    const manifest = path.join(WHISPER_DIR, 'package.json');
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
    console.log('Installing local transcription (once, about 150 MB)…');
    await npm(['install', WHISPER_PACKAGE, '--no-audit', '--no-fund', '--omit=dev'])
      .catch((e: Error) => { throw new Error(`Local transcription could not be installed: ${e.message}`); });
    console.log('Local transcription installed.');
  })().finally(() => { installing = null; });
  return installing;
}

/** transformers.js: the one beside the companion, else the one in ~/.tramme/whisper, installed there the first time */
function transformers(): Promise<Transformers> {
  return import('@huggingface/transformers').catch(async (e: NodeJS.ErrnoException) => {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    if (!fs.existsSync(path.join(WHISPER_DIR, 'node_modules', ...WHISPER_NAME.split('/'), 'package.json'))) await install();
    // a module of that folder, so that Node finds the package in its node_modules
    const loader = path.join(WHISPER_DIR, 'load.mjs');
    if (!fs.existsSync(loader)) fs.writeFileSync(loader, `export * from '${WHISPER_NAME}';\n`);
    return import(pathToFileURL(loader).href) as Promise<Transformers>;
  });
}

type Asr = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>) & WhisperParts;
const loaded = new Map<string, Promise<Asr>>();

/** the model a request runs: the machine's override, else the one the editor asks for (a model hub id), else the default */
export function whisperModel(asked?: unknown, env = process.env.TRAMME_WHISPER_MODEL): string {
  if (env) return env;
  return typeof asked === 'string' && /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(asked) ? asked : DEFAULT_MODEL;
}

function model(id: string): Promise<Asr> {
  if (!loaded.has(id)) {
    const p = transformers().then(async ({ pipeline }) => (await pipeline('automatic-speech-recognition', id, { dtype: 'q8' } as never)) as unknown as Asr);
    // a model that failed to load is tried again next time
    loaded.set(id, p.catch((e) => { loaded.delete(id); throw e; }));
  }
  return loaded.get(id)!;
}

/** 16-bit PCM WAV (mono) as samples between -1 and 1 */
function pcm(wav: Buffer): { samples: Float32Array; rate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV expected');
  let o = 12, rate = 16000, channels = 1, bits = 16;
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4), size = wav.readUInt32LE(o + 4);
    if (id === 'fmt ') { channels = wav.readUInt16LE(o + 10); rate = wav.readUInt32LE(o + 12); bits = wav.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error('16-bit WAV expected');
      const n = Math.floor(size / 2 / channels), out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(o + 8 + i * 2 * channels) / 32768;
      return { samples: out, rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV without data');
}

/** what a chunk heard comes back as */
export interface Heard { words: ReturnType<typeof asrWords>; text: string; language: string; duration: number; model: string }

/** what marks the thread that hears (bin.ts starts this module there when it is the bundle) */
export const WHISPER_THREAD = 'tramme-whisper';

let thread: Worker | null = null, asked = 0;
const waiting = new Map<number, { resolve: (h: Heard) => void; reject: (e: Error) => void }>();

/** the thread, started on the first chunk and kept: its model stays loaded between chunks */
function whisperThread(): Worker {
  if (thread) return thread;
  const worker = new Worker(new URL(import.meta.url), { workerData: { role: WHISPER_THREAD } });
  const fail = (e: Error) => { for (const w of waiting.values()) w.reject(e); waiting.clear(); thread = null; };
  worker.on('message', (m: { id: number; heard?: Heard; error?: string }) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.heard) w.resolve(m.heard); else w.reject(new Error(m.error ?? 'transcription failed'));
  });
  worker.on('error', fail);
  worker.on('exit', (code) => fail(new Error(`the transcription stopped (code ${code})`)));
  // the companion's server keeps the process alive, not this thread
  worker.unref();
  thread = worker;
  return worker;
}

/** a WAV chunk (16 kHz mono, base64) to words, heard in Whisper's thread */
export function transcribeLocal(audioBase64: string, language?: string, model?: string): Promise<Heard> {
  return new Promise((resolve, reject) => {
    const id = ++asked;
    waiting.set(id, { resolve, reject });
    whisperThread().postMessage({ id, audio: audioBase64, language, model });
  });
}

/** the chunk heard, in Whisper's thread */
async function hear(audioBase64: string, language?: string, asked?: string): Promise<Heard> {
  const { samples, rate } = pcm(Buffer.from(audioBase64, 'base64'));
  if (rate !== 16000) throw new Error(`16 kHz expected (got ${rate} Hz)`);
  const id = whisperModel(asked);
  const run = await model(id);
  // the language heard when the editor names none (transformers.js would take English), told back so the next chunks keep it
  const { Tensor } = await transformers();
  const spoken = language ?? await spokenLanguage(run, samples, (ids) => new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]));
  const out = await run(samples, { return_timestamps: 'word', chunk_length_s: 30, language: spoken, task: 'transcribe' });
  const words = asrWords(out);
  return { words, text: out.text.trim(), language: spoken, duration: samples.length / rate, model: id };
}

// started again as Whisper's thread: each chunk asked is heard here, one after the other
if (!isMainThread && (workerData as { role?: string } | null)?.role === WHISPER_THREAD) {
  parentPort!.on('message', (m: { id: number; audio: string; language?: string; model?: string }) => {
    hear(m.audio, m.language, m.model).then(
      (heard) => parentPort!.postMessage({ id: m.id, heard }),
      (e: Error) => parentPort!.postMessage({ id: m.id, error: e.message }),
    );
  });
}
