// Recording a voice-over in the timeline: a count-in, then the film plays from
// the playhead while the microphone records; stopped, the take is made a
// sound file of the project and laid on the sound track (voiceover.ts). Escape
// cancels, and a cancelled take leaves nothing behind.

import { signal } from '@preact/signals';
import { encodeWav } from '@tramme/render';
import { api } from './api.ts';
import { comp, commit, S, select, toast } from './state.ts';
import { freshId, snap } from './model.ts';
import { takeOps } from './voiceover.ts';
import { defaultTrackOf } from './ui/timeline/tracks.ts';
import { t } from './i18n/index.ts';

/** where the recording is: counting in (n seconds left), recording, or being saved */
export const recording = signal<{ stage: 'count'; n: number } | { stage: 'record' } | { stage: 'save' } | null>(null);

let stopNow: (() => void) | null = null, cancelNow: (() => void) | null = null;

/** the take's sound as a WAV (the browser's own format is kept for nothing: the mixer reads WAV everywhere) */
async function wavOf(blob: Blob): Promise<{ wav: Blob; seconds: number }> {
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  return { wav: new Blob([encodeWav(buf) as BlobPart], { type: 'audio/wav' }), seconds: buf.duration };
}

/** a press starts a take; a press while it runs ends it */
export async function toggleVoiceover(): Promise<void> {
  if (recording.peek()) { stopNow?.(); return; }
  const compId = S.compId.peek(), at = snap(S.time.peek(), comp.peek().fps);
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast(t('timeline.noMicrophone'), 'error'); return; }
  let cancelled = false, ended = false;
  const chunks: Blob[] = [];
  const release = () => { for (const track of stream.getTracks()) track.stop(); };
  cancelNow = () => { cancelled = true; stopNow?.(); };
  // three seconds to get ready, the film not yet playing
  for (let n = 3; n > 0 && !cancelled; n--) {
    recording.value = { stage: 'count', n };
    await new Promise<void>((r) => { stopNow = () => { ended = true; r(); }; setTimeout(r, 1000); });
    if (ended) break;
  }
  if (cancelled || ended) { release(); recording.value = null; stopNow = cancelNow = null; return; }
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  stopNow = () => { if (rec.state !== 'inactive') rec.stop(); };
  rec.start();
  recording.value = { stage: 'record' };
  S.playing.value = true;
  await stopped;
  S.playing.value = false;
  release();
  stopNow = null;
  if (cancelled || !chunks.length) { recording.value = null; cancelNow = null; return; }
  recording.value = { stage: 'save' };
  try {
    const { wav, seconds } = await wavOf(new Blob(chunks, { type: rec.mimeType }));
    const doc = S.doc.peek(), id = freshId(doc.assets, 'voice'), path = `assets/voice/${id}-${Date.now()}.wav`;
    const r = takeOps(doc, compId, id, { src: path, name: t('timeline.voiceTake', { n: Object.keys(doc.assets).filter((a) => a.startsWith('voice')).length + 1 }), duration: Math.round(seconds * 1000) / 1000 }, at, defaultTrackOf(doc.compositions[compId], true, S.selection.peek()[0]) ?? 'A1');
    if (!r) { toast(t('timeline.cannotRecordHere'), 'error'); return; }
    await api.writeAny(S.project.peek().id, path, wav);
    if (commit(t('timeline.recordVoiceover'), r.ops)) select([r.id]);
  } catch (e) { toast((e as Error).message, 'error'); } finally { recording.value = null; cancelNow = null; }
}

/** Escape while a take runs: it is dropped, nothing is written */
export function cancelVoiceover(): boolean {
  if (!recording.peek() || !cancelNow) return false;
  cancelNow();
  return true;
}
