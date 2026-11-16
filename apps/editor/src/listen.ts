// A dictation heard as it is said: Deepgram Nova-3 on Workers AI, through the
// server's /api/listen (apps/worker/src/listen.ts). The page sends the
// microphone as it comes (16-bit PCM, 16 kHz mono) and gets Deepgram's results
// back while the person speaks: each stretch heard first as interim words, then
// final. On the web it is a WebSocket of the page (its session cookie goes
// with it); in the app it is held by the app (listen.rs), with the session of
// the keychain, and relayed through the IPC.

import { toBase64 } from '@tramme/interop';
import { account } from './accounts.ts';
import { api } from './api.ts';
import { tauri } from './tauri.ts';

/** what Deepgram says of a stretch of speech: its words, final or not, and where it ends in the audio sent (seconds) */
export interface Heard { text: string; final: boolean; end: number }

/** a live transcription open: samples in, results out through the callback given when it opened */
export interface Listening {
  send(pcm: Int16Array<ArrayBuffer>): void;
  /** no more audio: resolves once Deepgram has said its last words (or after a few seconds) */
  finish(): Promise<void>;
  /** dropped: nothing more is said */
  drop(): void;
}

/** how long the last words are waited for once the dictation ends */
const LAST_WORDS = 3000;
/** how long the socket may take to open before the dictation goes without it */
const OPENING = 5000;

/** whether this page can listen live: an app signed in (its cloud), or a server that says so (Workers AI) */
export async function canListen(): Promise<boolean> {
  if (tauri) return account.peek().status === 'in';
  try { return !!(await api.config()).listen; } catch { return false; }
}

/** one of Deepgram's messages, read: its words and their end, or null for the others (metadata, speech started…) */
export function heardOf(raw: string): Heard | null {
  let m: { type?: string; is_final?: boolean; start?: number; duration?: number; channel?: { alternatives?: { transcript?: string }[] } };
  try { m = JSON.parse(raw); } catch { return null; }
  if (m.type !== 'Results') return null;
  return { text: (m.channel?.alternatives?.[0]?.transcript ?? '').trim(), final: m.is_final === true, end: (m.start ?? 0) + (m.duration ?? 0) };
}

let lastId = 0;

/** a live transcription opened; rejects when it cannot open (the dictation then hears in chunks) */
export function openListening(onHeard: (h: Heard) => void, language = 'multi'): Promise<Listening> {
  return tauri ? openInApp(onHeard, language) : openSocket(onHeard, language);
}

function openSocket(onHeard: (h: Heard) => void, language: string): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/listen?language=${encodeURIComponent(language)}`);
    ws.binaryType = 'arraybuffer';
    let closed: () => void = () => {};
    const ended = new Promise<void>((r) => { closed = r; });
    const timer = setTimeout(() => { ws.close(); reject(new Error('the live transcription did not open')); }, OPENING);
    ws.onmessage = (e) => { if (typeof e.data === 'string') { const h = heardOf(e.data); if (h) onHeard(h); } };
    ws.onclose = () => { clearTimeout(timer); closed(); reject(new Error('the live transcription closed')); };
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send: (pcm) => { if (ws.readyState === WebSocket.OPEN) ws.send(pcm); },
        finish: () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
          return Promise.race([ended, new Promise<void>((r) => setTimeout(r, LAST_WORDS))]).finally(() => ws.close());
        },
        drop: () => { onHeard = () => {}; ws.close(); },
      });
    };
  });
}

async function openInApp(onHeard: (h: Heard) => void, language: string): Promise<Listening> {
  const t = tauri!, id = ++lastId;
  const results = new t.core.Channel<string>();
  let closed: () => void = () => {};
  const ended = new Promise<void>((r) => { closed = r; });
  results.onmessage = (raw) => {
    if (raw.includes('"Closed"')) { closed(); return; }
    const h = heardOf(raw);
    if (h) onHeard(h);
  };
  await t.core.invoke('listen_open', { id, language, results });
  return {
    send: (pcm) => { t.core.invoke('listen_send', { id, audio: toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) }).catch(() => {}); },
    finish: () => {
      t.core.invoke('listen_finish', { id }).catch(() => {});
      return Promise.race([ended, new Promise<void>((r) => setTimeout(r, LAST_WORDS))]);
    },
    drop: () => { onHeard = () => {}; t.core.invoke('listen_finish', { id }).catch(() => {}); },
  };
}

/** samples between -1 and 1 as 16-bit PCM */
export function pcm16(samples: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  return out;
}
