// Whether a sound effect or a music bed a provider made talks: its words read
// by the server's speech to text, where there is one (never a model brought
// down for it). Whisper writes a few words over plain noise ("thank you"), so
// a handful is not speech: the prompt said aloud is, and so is a flow of words.

import { serverHears, transcribeSamples } from './speech.ts';

const RATE = 16000;
/** past this the first part tells: a provider that talks does from the start */
const HEARD_SECONDS = 56;

const wordsOf = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** whether these words, heard over `seconds`, are someone talking */
export function talks(heard: string, prompt: string, seconds: number): boolean {
  const said = wordsOf(heard), distinct = new Set(said);
  // the prompt recited: three of its long words, or most of a short prompt
  const asked = new Set(wordsOf(prompt).filter((w) => w.length >= 4));
  const recited = [...asked].filter((w) => distinct.has(w)).length;
  if (recited >= 3 || (recited >= 2 && recited >= asked.size * 0.6)) return true;
  return distinct.size >= 8 && said.length / Math.max(1, Math.min(seconds, HEARD_SECONDS)) >= 1.2;
}

/** what is said in a sound that should say nothing: the words, '' when it keeps quiet, null when nothing here can hear it */
export async function speechIn(mono16k: Float32Array, prompt: string): Promise<string | null> {
  try {
    if (!await serverHears()) return null;
    const part = mono16k.subarray(0, HEARD_SECONDS * RATE);
    const heard = await transcribeSamples(part, 'server', { only: true });
    return talks(heard, prompt, part.length / RATE) ? heard : '';
  } catch (e) {
    console.warn('[tramme] speech check:', (e as Error).message);
    return null;
  }
}
