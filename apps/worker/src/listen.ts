// Speech to text as it is said: a WebSocket to Deepgram Nova-3 on Workers AI.
// The page sends the microphone as it comes (16-bit PCM, 16 kHz mono) and gets
// the words back while the person speaks, the last ones corrected as more is
// heard (Deepgram's live results: interim, then final for each stretch). It is
// how a dictation is written live (apps/editor/src/dictation.ts); a sound of the
// project is still transcribed by Whisper, in chunks (speech.ts).
//
//   GET /api/listen?language=fr   Upgrade: websocket   -> Deepgram's results, one JSON message each

import { HttpError, type Env } from './http.ts';

const MODEL = '@cf/deepgram/nova-3';
/** the languages Nova-3 hears by name; any other is left to its multilingual mode */
const LANGUAGES = new Set(['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'ja', 'ru', 'hi']);

export async function listen(req: Request, env: Env): Promise<Response> {
  if (!env.AI) throw new HttpError(503, 'live transcription unavailable on this server (Workers AI not configured)');
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'a WebSocket is expected');
  const asked = new URL(req.url).searchParams.get('language') ?? '';
  const language = LANGUAGES.has(asked) ? asked : 'multi';
  return (await (env.AI.run as unknown as (model: string, input: Record<string, string | number | boolean>, opts: { websocket: true }) => Promise<Response>)(MODEL, {
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    language,
    interim_results: true,
    smart_format: true,
    punctuate: true,
  }, { websocket: true }));
}
