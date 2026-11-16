// Dictation: the user speaks, stops, and what they said is written into the
// message box for them to read, correct and send (nothing is sent by itself).
// The recording is decoded to 16 kHz mono and goes through the transcription
// of speech.ts, on the downloaded Whisper model (this browser), or the
// companion, or the server, as the setting says. The language is detected.
//
// Heard on the server (the setting's default, Automatic, when the server
// transcribes), the dictation is live: the microphone is read at 16 kHz and its
// words show while the user speaks. Where the server listens (listen.ts:
// Deepgram on Workers AI, the web and the apps signed in), the sound streams to
// it and the words come back within a second; when the user stops, the last
// ones follow a moment later. Elsewhere (a server with Whisper only), the
// passage being said goes to the server every second; a passage of some twenty
// seconds ending on a pause is kept as said, the next one starts, and at the end
// only what follows the last passage kept is sent.

import { signal } from '@preact/signals';
import { confirmWith } from './confirm.ts';
import { cachedFiles, cachedOf } from './model-cache.ts';
import { modelsFor } from './models.ts';
import { chosenModel, prefs, setPrefs } from './settings.ts';
import { canListen, openListening, pcm16, type Heard, type Listening } from './listen.ts';
import { serverHears, transcribeSamples, type DictationSource } from './speech.ts';
import { toast } from './state.ts';
import { t } from './i18n/index.ts';

const RATE = 16000;
/** a recording shorter than this is a tap, not speech */
const MIN_SECONDS = 0.5;

/** while recording: when it started and the level of the voice (0 to 1) */
export const recording = signal<{ since: number; level: number } | null>(null);

/** while the downloaded model's files come down: their bytes so far and in all */
export const modelLoad = signal<{ loaded: number; total: number } | null>(null);

/** a live dictation's words so far (on the server), '' otherwise */
export const liveText = signal('');

/** how often the passage being said is sent, and the passages kept as said: some twenty seconds ending on a pause, never more than 27 (one chunk of Whisper) */
const LIVE_EVERY = 1000, KEEP_AFTER = 20, KEEP_AT_MOST = 27, QUIET = 0.01;

/**
 * A live dictation: the microphone's samples at 16 kHz, where the passage being said starts, the words of the
 * passages kept. listening: the stream to the server once open (its final words in `kept`, the stretch being said in
 * `interim`, `sent` the samples it has had); without it, `timer` sends the passage being said every second.
 */
interface Live {
  node: ScriptProcessorNode; parts: Float32Array[]; length: number; start: number; kept: string; busy: boolean; over: boolean;
  timer?: ReturnType<typeof setInterval>; listening?: Listening; interim: string; sent: number;
}

interface Session { stream: MediaStream; recorder: MediaRecorder; context: AudioContext; chunks: Blob[]; meter: ReturnType<typeof setInterval>; since: number; live?: Live }
let session: Session | null = null;
/** the microphone being opened (it can take seconds): a second click meanwhile opens nothing more */
let opening: Promise<void> | null = null;

/** words written at the cursor of a box: replacing the selection, one space between the words around it */
export function insertAtCursor(value: string, start: number, end: number, add: string): { value: string; caret: number } {
  const before = value.slice(0, start), after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '', trail = after && !/^\s/.test(after) ? ' ' : '';
  const head = `${before}${lead}${add}`;
  return { value: `${head}${trail}${after}`, caret: head.length };
}

/** the source a dictation uses: the setting, Automatic made the server when it transcribes, else the downloaded model */
export async function dictationSource(): Promise<Exclude<DictationSource, 'auto'>> {
  const chosen = prefs.peek().dictation;
  if (chosen !== 'auto') return chosen;
  return (await serverHears()) ? 'server' : 'local';
}

/** the words of two passages, one after the other */
const joined = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ');

/** samples [from, to) of a live dictation, in one array */
function slice(l: Live, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  let at = 0;
  for (const part of l.parts) {
    const a = Math.max(from, at), b = Math.min(to, at + part.length);
    if (a < b) out.set(part.subarray(a - at, b - at), a - from);
    at += part.length;
    if (at >= to) break;
  }
  return out;
}

const level = (s: Float32Array) => Math.sqrt(s.reduce((n, v) => n + v * v, 0) / Math.max(1, s.length));

/** the passage being said, sent: its words shown; one long enough that ends on a pause is kept as said */
async function hearLive(l: Live) {
  if (l.busy || l.over || l.listening) return;
  const end = l.length;
  if (end - l.start < RATE * 0.8) return;
  l.busy = true;
  try {
    const passage = slice(l, l.start, end), text = await transcribeSamples(passage, 'server');
    if (l.over || l.listening) return;
    const seconds = passage.length / RATE, pause = level(passage.subarray(-Math.round(RATE * 0.3))) < QUIET;
    if ((seconds >= KEEP_AFTER && pause) || seconds >= KEEP_AT_MOST) { l.kept = joined(l.kept, text); l.start = end; liveText.value = l.kept; }
    else liveText.value = joined(l.kept, text);
  } catch { /* the next second tries again; the end of the dictation says what failed */ }
  finally { l.busy = false; }
}

/** a stretch Deepgram heard: its final words kept, the stretch being said shown after them */
function heard(l: Live, h: Heard) {
  if (l.over) return;
  if (h.final) { l.kept = joined(l.kept, h.text); l.interim = ''; } else l.interim = h.text;
  liveText.value = joined(l.kept, l.interim);
}

/** the stream to the server, opened while the user already speaks: what was said meanwhile goes first; without it, the passages in chunks */
async function listenTo(l: Live) {
  // Whisper shows words while the live socket is being opened; a slow handshake must not leave the mic silent.
  l.timer = setInterval(() => { void hearLive(l); }, LIVE_EVERY);
  const listening = (await canListen().catch(() => false)) ? await openListening((h) => heard(l, h)).catch(() => null) : null;
  if (l.over) { listening?.drop(); return; }
  if (!listening) return;
  clearInterval(l.timer);
  l.timer = undefined;
  listening.send(pcm16(slice(l, 0, l.length)));
  l.sent = l.length;
  l.listening = listening;
}

/** the microphone opens and recording starts; a refusal or a missing device is told, nothing is left open */
export function startDictation(): Promise<void> {
  if (session) return Promise.resolve();
  opening ??= open().finally(() => { opening = null; });
  return opening;
}

async function open(): Promise<void> {
  // the microphone asked at once (the click's moment), the source found meanwhile
  const asked = dictationSource();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const refused = (e as Error).name === 'NotAllowedError' || (e as Error).name === 'SecurityError';
    toast(refused ? t('dictation.micRefused') : t('dictation.noMic'), 'error');
    return;
  }
  const live = (await asked) === 'server';
  // live, the context runs at Whisper's rate: the browser resamples the microphone
  const context = live ? new AudioContext({ sampleRate: RATE }) : new AudioContext(), analyser = context.createAnalyser(), recorder = new MediaRecorder(stream), chunks: Blob[] = [];
  analyser.fftSize = 512;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const wave = new Uint8Array(analyser.fftSize), since = Date.now();
  // the voice's level, a few times a second
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(wave);
    const rms = Math.sqrt(wave.reduce((n, v) => n + ((v - 128) / 128) ** 2, 0) / wave.length);
    recording.value = { since, level: Math.min(1, rms * 3) };
  }, 80);
  session = { stream, recorder, context, chunks, meter, since };
  if (live) {
    const node = context.createScriptProcessor(2048, 1, 1);
    const l: Live = { node, parts: [], length: 0, start: 0, kept: '', busy: false, over: false, interim: '', sent: 0 };
    node.onaudioprocess = (e) => {
      const s = new Float32Array(e.inputBuffer.getChannelData(0));
      l.parts.push(s);
      l.length += s.length;
      if (l.listening) { l.listening.send(pcm16(s)); l.sent = l.length; }
    };
    source.connect(node);
    // a processor runs only when it leads somewhere; it writes nothing, the speakers stay silent
    node.connect(context.destination);
    session.live = l;
    void listenTo(l);
  }
  liveText.value = '';
  recording.value = { since, level: 0 };
  recorder.start();
}

/** the recorder stopped and the microphone let go */
function release(s: Session): Promise<Blob> {
  clearInterval(s.meter);
  if (s.live) { s.live.over = true; clearInterval(s.live.timer); s.live.node.disconnect(); }
  recording.value = null;
  liveText.value = '';
  return new Promise((resolve) => {
    s.recorder.onstop = () => {
      s.stream.getTracks().forEach((track) => track.stop());
      s.context.close().catch(() => {});
      resolve(new Blob(s.chunks, { type: s.recorder.mimeType }));
    };
    s.recorder.stop();
  });
}

/** the recording ends: what was said, as text; '' for a tap or for nothing heard */
export async function stopDictation(): Promise<string> {
  const s = session;
  if (!s) return '';
  session = null;
  // live, the length is the sound heard; otherwise the clock's
  const seconds = s.live ? s.live.length / RATE : (Date.now() - s.since) / 1000;
  const l = s.live, blob = await release(s);
  if (seconds < MIN_SECONDS) return '';
  if (l?.listening) {
    // streamed: its last words come within a moment; a stream that heard nothing hands the whole to Whisper
    const listening = l.listening;
    l.over = false;
    await listening.finish();
    l.over = true;
    const said = joined(l.kept, l.interim);
    return said || transcribeSamples(slice(l, 0, l.length), 'server');
  }
  if (l) {
    // only what follows the last passage kept: a moment, whatever the length of the dictation
    const rest = slice(l, l.start, l.length);
    return rest.length < RATE * 0.3 ? l.kept : joined(l.kept, await transcribeSamples(rest, 'server'));
  }
  return transcribeDictation(await samplesOf(blob));
}

/** the recording is dropped: nothing is written */
export function cancelDictation(): void {
  const s = session;
  session = null;
  s?.live?.listening?.drop();
  if (s) void release(s);
}

/** a recording as 16 kHz mono samples (the offline context resamples and mixes down) */
async function samplesOf(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    context.close().catch(() => {});
  }
}

/** the words of the samples, from the source the setting names; '' when the user declines the download of the model */
export async function transcribeDictation(samples: Float32Array): Promise<string> {
  const source = await dictationSource();
  if (source !== 'local') return (await transcribeSamples(samples, source)).trim();
  if (!(await modelReady())) return '';
  // on the processor: the compact weights the offer names (a GPU would take the full ones, several times larger), quick on a short message
  try {
    return (await transcribeSamples(samples, 'local', { local: { cpu: true, progress: (loaded, total) => { modelLoad.value = { loaded, total }; } } })).trim();
  } finally { modelLoad.value = null; }
}

/**
 * The downloaded model is in this browser, or the user agrees to download it
 * (their voice stays here: it is never sent to a server without them knowing).
 * With no model chosen, Whisper base is suggested, lighter than the default.
 */
async function modelReady(): Promise<boolean> {
  const files = await cachedFiles();
  let model = chosenModel('transcription');
  if (cachedOf(model, files).bytes > 0) return true;
  const chosen = !!prefs.peek().models.transcription;
  if (!chosen) model = modelsFor('transcription').find((m) => m.id === 'whisper-base') ?? model;
  if (cachedOf(model, files).bytes === 0) {
    const size = model.mb >= 1000 ? `${(model.mb / 1000).toFixed(1)} GB` : `${Math.round(model.mb)} MB`;
    if (!(await confirmWith(t('dictation.downloadTitle'), t('dictation.downloadText', { model: model.name, size }), t('dictation.download')))) return false;
  }
  if (!chosen) setPrefs({ models: { ...prefs.peek().models, transcription: model.id } });
  return true;
}
