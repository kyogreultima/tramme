// Pictures made by a provider at authoring time: OpenAI (gpt-image-1),
// Gemini (its image model), Z.AI (CogView), Hydracept (OpenAI images). The keys (settings or secrets,
// see keys.ts) never reach the editor, which saves the file in the project
// with what made it (see docs/generation-roadmap.md).
//
//   POST /api/generate-image {prompt, ratio?, quality?, provider?, size?, n?, reference?, mask?}
//     ratio: the proportions asked for, named as Gemini does ('1:1', '16:9',
//     '9:16'…; '1:1' when the composition's is not in the list)
//     size: 'small' (the cheapest size the provider draws) or 'large' (the default)
//     n: takes, 1 to 4 — one picture answers with its file, several with JSON
//       { provider, model, images: [{ type, data }] } (data in base64)
//     reference: a picture (a data URL) the provider changes: kept where the
//       prompt does not ask otherwise; mask: a PNG (a data URL) whose
//       transparent pixels say where it may change (OpenAI and Gemini)

import { HttpError, readJson } from './http.ts';
import { providerFailure } from './generate.ts';
import { hydraceptHeaders, hydraceptImage, hydraceptOf } from './hydracept.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

export type ImageProvider = 'openai' | 'gemini' | 'zai' | 'hydracept';

export interface Picture { data: ArrayBuffer; type: string; url: string }
interface Ask { prompt: string; ratio: string; quality?: 'low' | 'medium' | 'high'; size?: 'small' | 'large'; reference?: Picture; mask?: Picture }
interface Made { image: ArrayBuffer; type: string; model: string; headers?: Record<string, string> }

/** the proportions each provider takes: OpenAI three sizes, Z.AI the sizes CogView takes, Gemini as asked */
export const RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:5', '3:2', '2:3', '4:3', '3:4', '1:1'] as const;
const WIDE = ['21:9', '16:9', '3:2', '5:4'], TALL = ['9:16', '2:3', '4:5', '3:4'];

const b64 = (s: string): ArrayBuffer => {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

const OPENAI_MODEL = 'gpt-image-1', GEMINI_MODEL = 'gemini-3.8-flash-image', ZAI_MODEL = 'cogview-4';

/** OpenAI's size for a ratio: its three sizes, the square when a small picture is asked (it costs least) */
const openaiSize = (ask: Ask) => (ask.size === 'small' ? '1024x1024' : WIDE.includes(ask.ratio) ? '1536x1024' : TALL.includes(ask.ratio) ? '1024x1536' : '1024x1024');

/** a provider that draws from words only refuses a picture to change, saying who can */
const wordsOnly = (provider: string, ask: Ask) => {
  if (ask.reference || ask.mask) throw new HttpError(400, `${provider} draws from words only: change a picture with OpenAI or Gemini`);
};

const toB64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export const IMAGE_PROVIDERS: Record<ImageProvider, { make(key: string, ask: Ask, fetch: Reach['fetch'], keys: Keys): Promise<Made> }> = {
  openai: {
    async make(key, ask, fetch) {
      let res: Response;
      if (ask.reference) {
        // a picture to change: the edits endpoint, the mask (transparent where it may change) beside it
        const form = new FormData();
        form.append('model', OPENAI_MODEL);
        form.append('prompt', ask.prompt);
        form.append('size', openaiSize(ask));
        if (ask.quality) form.append('quality', ask.quality);
        form.append('image', new Blob([ask.reference.data], { type: ask.reference.type }), `reference.${ask.reference.type.split('/')[1] ?? 'png'}`);
        if (ask.mask) form.append('mask', new Blob([ask.mask.data], { type: 'image/png' }), 'mask.png');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: OPENAI_MODEL, prompt: ask.prompt, size: openaiSize(ask), ...(ask.quality ? { quality: ask.quality } : {}) }),
        });
      }
      if (!res.ok) await providerFailure('openai', res);
      const j = await res.json() as { data?: { b64_json?: string }[] };
      const d = j.data?.[0];
      if (!d?.b64_json) throw new HttpError(502, 'openai: no picture in the answer');
      return { image: b64(d.b64_json), type: 'image/png', model: OPENAI_MODEL };
    },
  },
  gemini: {
    async make(key, ask, fetch) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          // a picture to change goes first, its mask after it (Gemini takes no mask of its own: the words say what it means)
          contents: [{ parts: [
            ...(ask.reference ? [{ inlineData: { mimeType: ask.reference.type, data: toB64(ask.reference.data) } }] : []),
            ...(ask.mask ? [{ inlineData: { mimeType: 'image/png', data: toB64(ask.mask.data) } }] : []),
            { text: ask.mask ? `${ask.prompt}\n\nThe second picture is a mask: change the first picture only where the mask is transparent, and keep every other pixel as it is.` : ask.prompt },
          ] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ask.ratio } },
        }),
      });
      if (!res.ok) await providerFailure('gemini', res);
      const j = await res.json() as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((p) => typeof p.inlineData?.data === 'string');
      if (!part?.inlineData?.data) throw new HttpError(502, 'gemini: no picture in the answer');
      return { image: b64(part.inlineData.data), type: part.inlineData.mimeType ?? 'image/png', model: GEMINI_MODEL };
    },
  },
  zai: {
    async make(key, ask, fetch) {
      wordsOnly('zai', ask);
      const res = await fetch('https://api.z.ai/api/paas/v4/images/generations', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: ZAI_MODEL, prompt: ask.prompt, size: ask.size === 'small' ? (WIDE.includes(ask.ratio) ? '960x544' : TALL.includes(ask.ratio) ? '544x960' : '768x768') : WIDE.includes(ask.ratio) ? '1280x720' : TALL.includes(ask.ratio) ? '720x1280' : '1024x1024' }),
      });
      if (!res.ok) await providerFailure('zai', res);
      const j = await res.json() as { data?: { url?: string; b64_json?: string }[] };
      const d = j.data?.[0];
      if (d?.b64_json) return { image: b64(d.b64_json), type: 'image/png', model: ZAI_MODEL };
      if (!d?.url) throw new HttpError(502, 'zai: no picture in the answer');
      const got = await fetch(d.url);
      if (!got.ok) throw new HttpError(502, `zai: the picture it names could not be read (HTTP ${got.status})`);
      const type = (got.headers.get('content-type') ?? 'image/png').split(';')[0];
      return { image: await got.arrayBuffer(), type: type.startsWith('image/') ? type : 'image/png', model: ZAI_MODEL };
    },
  },
  // after the providers of the user's own keys: picked when it is the one connected, or named
  hydracept: {
    async make(key, ask, fetch, keys) {
      wordsOnly('hydracept', ask);
      const run = await hydraceptImage(hydraceptOf(key, keys), ask, fetch);
      return { image: run.bytes, type: run.type, model: run.model, headers: hydraceptHeaders(run) };
    },
  },
};

/** the providers connected, the first one used when none is named */
export function imageConfig(keys: Keys): ImageProvider[] {
  return (Object.keys(IMAGE_PROVIDERS) as ImageProvider[]).filter((p) => keys.get(p));
}

/** a picture sent as a data URL ('data:image/png;base64,…'), or nothing; anything else is refused */
export function pictureOf(v: unknown, what: string): Picture | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const m = typeof v === 'string' ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m) throw new HttpError(400, `${what}: a PNG, JPEG or WebP picture as a data URL is expected`);
  if (m[2].length > 16_000_000) throw new HttpError(413, `${what}: the picture is too large (about 12 MB at most)`);
  return { data: b64(m[2]), type: m[1], url: String(v) };
}

export async function generateImage(req: Request, { keys, fetch }: Reach) {
  const b = await readJson<Partial<Omit<Ask, 'reference' | 'mask'>> & { provider?: string; n?: number; reference?: string; mask?: string }>(req);
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'say what to draw (prompt)');
  if (prompt.length > 4000) throw new HttpError(413, 'prompt too long (4000 characters at most)');
  const ratio = RATIOS.includes(String(b.ratio) as typeof RATIOS[number]) ? String(b.ratio) : '1:1';
  const quality = ['low', 'medium', 'high'].includes(String(b.quality)) ? String(b.quality) as Ask['quality'] : undefined;
  const size = b.size === 'small' ? 'small' as const : undefined;
  const n = Math.max(1, Math.min(4, Math.round(Number(b.n) || 1)));
  const reference = pictureOf(b.reference, 'reference'), mask = pictureOf(b.mask, 'mask');
  if (mask && !reference) throw new HttpError(400, 'a mask goes with the picture it changes (reference)');
  const provider = (b.provider ?? imageConfig(keys)[0]) as ImageProvider | undefined;
  if (!provider || !IMAGE_PROVIDERS[provider]) {
    throw new HttpError(503, `no provider for pictures: ${keys.how(Object.keys(IMAGE_PROVIDERS) as ImageProvider[], 'one')}`);
  }
  const key = keys.get(provider);
  if (!key) throw new HttpError(503, `no ${provider} key: ${keys.how([provider])}`);
  const ask: Ask = { prompt, ratio, quality, size, reference, mask };
  // takes: the same ask drawn n times, side by side (each provider draws one picture a call)
  const all = await Promise.all(Array.from({ length: n }, () => IMAGE_PROVIDERS[provider].make(key, ask, fetch, keys)));
  const made = all[0];
  const headers = { 'cache-control': 'no-store', 'x-tramme-provider': provider, 'x-tramme-model': made.model, ...made.headers };
  if (n === 1) return new Response(made.image, { headers: { ...headers, 'content-type': made.type } });
  return new Response(JSON.stringify({ provider, model: made.model, images: all.map((m) => ({ type: m.type, data: toB64(m.image) })) }), { headers: { ...headers, 'content-type': 'application/json' } });
}
