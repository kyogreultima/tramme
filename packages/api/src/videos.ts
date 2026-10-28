// Clips made at authoring time: a video provider turns words (or one still
// picture) into a short MP4 (generate-video). Hydracept runs Veo 3.1 Fast on
// its own key, with a quote before the job and a receipt after it. The keys
// stay in the Worker, as for the pictures and the sounds.
//
//   POST /api/generate-video {prompt, ratio?, duration?, source?, provider?}
//     ratio: '16:9' (the default) or '9:16'
//     duration: 4, 6 or 8 seconds (8 by default)
//     source: a still picture (a data URL) animated as the opening frame

import {
  HYDRACEPT_VIDEO_MODEL,
  hydraceptHeaders,
  hydraceptOf,
  hydraceptVideo,
  videoSecondsOf,
  type HydraceptVideoSeconds,
  type HydraceptVideoSource,
} from './hydracept.ts';
import { HttpError, readJson } from './http.ts';
import { pictureOf } from './images.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

export type VideoProvider = 'hydracept';
export const VIDEO_RATIOS = ['16:9', '9:16'] as const;
export type VideoRatio = (typeof VIDEO_RATIOS)[number];

interface Ask {
  prompt: string;
  ratio: VideoRatio;
  duration: HydraceptVideoSeconds;
  source?: HydraceptVideoSource;
}

interface Made {
  video: ArrayBuffer;
  type: string;
  model: string;
  headers?: Record<string, string>;
}

export const VIDEO_PROVIDERS: Record<VideoProvider, { make(key: string, ask: Ask, fetch: Reach['fetch'], keys: Keys): Promise<Made> }> = {
  hydracept: {
    async make(key, ask, fetch, keys) {
      const run = await hydraceptVideo(hydraceptOf(key, keys), ask, fetch);
      return { video: run.bytes, type: run.type, model: run.model, headers: hydraceptHeaders(run) };
    },
  },
};

/** the providers that make clips, the first one used when none is named */
export function videoConfig(keys: Keys): VideoProvider[] {
  return (Object.keys(VIDEO_PROVIDERS) as VideoProvider[]).filter((p) => keys.get(p));
}

/** a still sent as a data URL ('data:image/png;base64,…'), or nothing; the picture parser is the pictures' own */
export function videoSourceOf(v: unknown): HydraceptVideoSource | undefined {
  const picture = pictureOf(v, 'source');
  if (!picture) return undefined;
  return { dataUrl: picture.url, mimeType: picture.type, filename: `source.${picture.type.split('/')[1]}` };
}

export async function generateVideo(req: Request, { keys, fetch }: Reach) {
  const b = await readJson<{ prompt?: unknown; ratio?: unknown; duration?: unknown; source?: unknown; provider?: unknown }>(req);
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'say what the clip shows (prompt)');
  if (prompt.length > 4000) throw new HttpError(413, 'prompt too long (4000 characters at most)');
  const ratio = VIDEO_RATIOS.includes(String(b.ratio) as VideoRatio) ? String(b.ratio) as VideoRatio : '16:9';
  // a form sends the length as text; empty keeps the default
  const asked = typeof b.duration === 'number' ? b.duration : typeof b.duration === 'string' && b.duration.trim() ? Number(b.duration) : undefined;
  const duration = videoSecondsOf(asked);
  const source = videoSourceOf(b.source);
  const provider = (b.provider ?? videoConfig(keys)[0]) as VideoProvider | undefined;
  if (!provider || !VIDEO_PROVIDERS[provider]) {
    throw new HttpError(503, `no provider for clips: ${keys.how(['hydracept'], 'one')}`);
  }
  const key = keys.get(provider);
  if (!key) throw new HttpError(503, `no ${provider} key: ${keys.how([provider])}`);
  const made = await VIDEO_PROVIDERS[provider].make(key, { prompt, ratio, duration, source }, fetch, keys);
  // Hydracept answers video/mp4; keep a provider's own type when it names one
  const type = made.type.startsWith('video/') ? made.type : 'video/mp4';
  return new Response(made.video, {
    headers: { 'content-type': type, 'cache-control': 'no-store', 'x-tramme-provider': provider, 'x-tramme-model': made.model || HYDRACEPT_VIDEO_MODEL, ...made.headers },
  });
}
