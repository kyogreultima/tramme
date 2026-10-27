// Dictation: the user speaks, stops, and what they said is written into the
// message box for them to read, correct and send (nothing is sent by itself).
// The recording is decoded to 16 kHz mono and goes through the transcription
// of speech.ts, on the downloaded Whisper model first (this browser), or the
// companion, or the server, as the setting says. The language is detected.

import { signal } from '@preact/signals';
import { confirmWith } from './confirm.ts';
import { cachedFiles, cachedOf } from './model-cache.ts';
import { modelsFor } from './models.ts';
import { chosenModel, prefs, setPrefs } from './settings.ts';
import { transcribeSamples } from './speech.ts';
import { toast } from './state.ts';
import { t } from './i18n/index.ts';

const RATE = 16000;
/** a recording shorter than this is a tap, not speech */
const MIN_SECONDS = 0.5;

/** while recording: when it started and the level of the voice (0 to 1) */
export const recording = signal<{ since: number; level: number } | null>(null);

interface Session { stream: MediaStream; recorder: MediaRecorder; context: AudioContext; chunks: Blob[]; meter: ReturnType<typeof setInterval>; since: number }
let session: Session | null = null;

/** words written at the cursor of a box: replacing the selection, one space between the words around it */
export function insertAtCursor(value: string, start: number, end: number, add: string): { value: string; caret: number } {
  const before = value.slice(0, start), after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '', trail = after && !/^\s/.test(after) ? ' ' : '';
  const head = `${before}${lead}${add}`;
  return { value: `${head}${trail}${after}`, caret: head.length };
}

/** the microphone opens and recording starts; a refusal or a missing device is told, nothing is left open */
export async function startDictation(): Promise<void> {
  if (session) return;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const refused = (e as Error).name === 'NotAllowedError' || (e as Error).name === 'SecurityError';
    toast(refused ? t('dictation.micRefused') : t('dictation.noMic'), 'error');
    return;
  }
  const context = new AudioContext(), analyser = context.createAnalyser(), recorder = new MediaRecorder(stream), chunks: Blob[] = [];
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const wave = new Uint8Array(analyser.fftSize), since = Date.now();
  // the voice's level, a few times a second
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(wave);
    const rms = Math.sqrt(wave.reduce((n, v) => n + ((v - 128) / 128) ** 2, 0) / wave.length);
    recording.value = { since, level: Math.min(1, rms * 3) };
  }, 80);
  session = { stream, recorder, context, chunks, meter, since };
  recording.value = { since, level: 0 };
  recorder.start();
}

/** the recorder stopped and the microphone let go */
function release(s: Session): Promise<Blob> {
  clearInterval(s.meter);
  recording.value = null;
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
  const seconds = (Date.now() - s.since) / 1000;
  const blob = await release(s);
  if (seconds < MIN_SECONDS) return '';
  return transcribeDictation(await samplesOf(blob));
}

/** the recording is dropped: nothing is written */
export function cancelDictation(): void {
  const s = session;
  session = null;
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
  const source = prefs.peek().dictation;
  if (source === 'local' && !(await modelReady())) return '';
  return (await transcribeSamples(samples, source)).trim();
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
