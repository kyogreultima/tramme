// Clips made at authoring time: a provider runs a short text-to-video (or
// image-to-video) job at authoring time (generate-video). The file lands in
// the project with what made it, and a video layer plays it — the step after
// the pictures in docs/generation-roadmap.md. Hydracept runs Veo 3.1 Fast on
// the server's key, so the editor never sees one.
//
// A tool of the editor's vocabulary: the assistant reaches it with use_tool,
// the user from the / menu. The clip is placed at the playhead (or `at`), an
// optional still (an image asset, or a frame of the composition) is animated
// as its opening frame, and `again` makes the same clip again from its record.
// The user says yes before it costs money, as for the pictures and the sounds.

import { pointer, type Layer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { HYDRACEPT_VIDEO_SECONDS, videoSecondsOf, type HydraceptVideoSeconds } from '@tramme/api';
import { VideoFrames } from '@tramme/render';
import { api, type MadeVideo, type VideoAsk } from './api.ts';
import { payFor } from './confirm.ts';
import { clip } from './model.ts';
import { jpegOf } from './perception.ts';
import { prefs } from './settings.ts';
import { againPrompt, bitmapOf } from './images.ts';
import { againOps, canvasOf, dataUrl, fitSide, keepMedia, placeMedia, recordOf } from './media.ts';
import { t } from './i18n/index.ts';

const RATIOS = ['16:9', '9:16'] as const;
const SECONDS = HYDRACEPT_VIDEO_SECONDS;
type Ratio = (typeof RATIOS)[number];
type Seconds = HydraceptVideoSeconds;

/** the ratio the composition calls for: wide or tall (Veo takes these two) */
export function clipRatio(w: number, h: number): Ratio {
  return w >= h ? '16:9' : '9:16';
}

/**
 * Where a clip goes on the timeline. An explicit start is kept (clamped to the
 * composition); from the playhead, the clip is moved back just enough to show
 * all of it, so a clip made at the end is not cut off. `out` is clamped to the
 * composition's end.
 */
export function clipPlacement(duration: number, compDuration: number, at: number | undefined, playhead: number): { at: number; out: number } {
  const length = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const last = Math.max(0, compDuration - 0.1);
  const asked = at === undefined ? NaN : Number(at);
  const explicit = Number.isFinite(asked);
  const wanted = explicit ? Math.max(0, asked) : Math.max(0, Number.isFinite(playhead) ? playhead : 0);
  const start = explicit ? Math.min(wanted, last) : Math.max(0, Math.min(wanted, compDuration - Math.min(length, compDuration)));
  return { at: start, out: Math.min(compDuration, start + length) };
}

/** a video layer showing the clip: fills the frame (cover) or shows it whole (contain), from `at` */
function layersOf(ctx: ToolContext, asset: string): { compId: string; id: string; layer: Layer }[] {
  const found: { compId: string; id: string; layer: Layer }[] = [];
  for (const [compId, c] of Object.entries(ctx.doc.compositions)) {
    for (const [id, layer] of Object.entries(c.layers)) {
      if ((layer.props as { video?: string } | undefined)?.video === asset) found.push({ compId, id, layer });
    }
  }
  return found;
}

/**
 * A clip made again at another length: the layers showing it that were not
 * trimmed follow the new length, clamped to each composition's end. A layer
 * whose span differs from the old length is a deliberate trim and stays.
 */
function resizeLayers(ctx: ToolContext, asset: string, oldDuration: number, duration: number): Op[] {
  const ops: Op[] = [];
  for (const { compId, id, layer } of layersOf(ctx, asset)) {
    const comp = ctx.doc.compositions[compId];
    const from = layer.in ?? 0, to = layer.out ?? comp.duration;
    if (Math.abs(to - from - oldDuration) > 0.001) continue;
    const out = Math.min(comp.duration, from + duration);
    if (Math.abs(out - to) > 0.001) ops.push({ op: 'replace', path: pointer('compositions', compId, 'layers', id, 'out'), value: +out.toFixed(3) });
  }
  return ops;
}

/** a still picture sent to the provider as the clip's opening frame (an image asset, or a frame of the composition) */
async function sourceOf(ctx: ToolContext, source: string, at: number): Promise<string> {
  const img = await bitmapOf(ctx, source, at);
  try {
    const k = fitSide(img.width, img.height);
    const { c, g } = canvasOf(img.width * k, img.height * k);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await dataUrl(c);
  } finally { img.close(); }
}

/** a frame of the clip for the model and the user to judge (null when the browser cannot decode it) */
async function poster(blob: Blob): Promise<string | null> {
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const v = await VideoFrames.open(url);
    try {
      const at = Math.min(0.5, v.duration / 4);
      await v.request(at);
      const frame = v.frameAt(at).image;
      if (!frame) return null;
      return jpegOf(frame, v.width, v.height, Math.min(1, 768 / Math.max(v.width, v.height)));
    } finally { v.dispose(); }
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

type Input = {
  prompt?: string; name?: string; ratio?: Ratio | 'auto'; duration?: Seconds | null; provider?: string;
  fit?: 'cover' | 'contain'; at?: number; background?: boolean; source?: string; again?: string; change?: string;
};

const generateVideo: ToolType<Input> = {
  name: 'generate-video', title: 'Have a clip made', description: 'has a provider make a short video clip (the server\'s key: Veo 3.1 Fast through Hydracept), saves it in the project with what made it and places it as a video layer; answers with a frame of it. Animates a still picture as the opening frame, and makes a clip again from its record',
  input: {
    type: 'object',
    properties: {
      prompt: { type: 'string', title: 'Prompt', description: 'what happens in the shot, and how it is filmed: subject, movement, camera, light, mood ("a paper boat drifts down a rain-soaked gutter at dusk, slow push-in, shallow depth of field, no text")' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case; the same name makes the clip again' },
      ratio: { enum: ['auto', ...RATIOS], title: 'Proportions', description: 'auto: the composition\'s (wide or tall; Veo takes 16:9 or 9:16)' },
      duration: { enum: [...SECONDS], title: 'Length (s)', description: '4, 6 or 8 seconds (the Videos settings by default); each second is billed' },
      provider: { enum: ['hydracept'], title: 'Provider', description: 'the Videos settings\' by default; Hydracept runs Veo 3.1 Fast' },
      fit: { enum: ['cover', 'contain'], title: 'Fit', description: 'cover: fills the frame, cropped to it; contain: shown whole, bands around it' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: 'the playhead by default' },
      background: { type: 'boolean', title: 'In the background', description: 'under the other layers' },
      source: { type: 'string', title: 'First frame', description: 'an image asset of the project, or "frame" for a still of the composition at the clip\'s start: the clip animates it (image-to-video)' },
      again: { type: 'string', format: 'asset', assetType: 'video', title: 'Make again', description: 'a clip made before: its record gives the prompt, the provider, the proportions and the length' },
      change: { type: 'string', title: 'Change', description: 'with again: what changes ("night instead of dusk", "slower push-in"); the rest stays' },
    },
  },
  ai: {
    when: 'a shot needs footage the project does not hold and cannot film (an establishing shot, a texture in motion, a stylised action); a still picture that should move: give it as source. Veo takes 4, 6 or 8 seconds and bills each one, so make one clip per shot, not drafts',
    avoid: 'clips standing in for a design the composition can move itself; words or logos drawn in the clip (they come out crooked, and text layers can translate them); the face of a real person; a clip longer than the shot needs',
    example: { prompt: 'a paper boat drifts down a rain-soaked gutter at dusk, slow push-in, shallow depth of field, no text', name: 'paper-boat', duration: 6 },
  },
  async run(a, ctx) {
    const p = prefs.peek(), c = ctx.doc.compositions[ctx.compId];
    const before = a.again ? await recordOf(ctx, 'video', a.again) : null;
    if (a.again && !ctx.doc.assets[a.again]) throw new Error(`${a.again}: no such clip in the project`);
    const words = a.prompt?.trim() || (before?.prompt ? String(before.prompt) : '');
    if (!words) throw new Error('say what the shot shows (prompt), or name a clip made before to make again (again)');
    const provider = a.provider ?? (before?.provider ? String(before.provider) : undefined) ?? (p.videoProvider !== 'auto' ? p.videoProvider : undefined);
    const ratio: Ratio = a.ratio && a.ratio !== 'auto' ? a.ratio
      : RATIOS.includes(String(before?.ratio) as Ratio) ? String(before?.ratio) as Ratio
        : clipRatio(c.width, c.height);
    // null, undefined and an empty form field all mean "not asked": the record or the setting decides
    const asked = a.duration == null || String(a.duration).trim() === '' ? undefined : Number(a.duration);
    const recorded = before?.duration == null ? undefined : Number(before.duration);
    const duration: Seconds = asked !== undefined && Number.isFinite(asked) ? videoSecondsOf(asked)
      : recorded !== undefined && Number.isFinite(recorded) ? videoSecondsOf(recorded) : p.videoSeconds;
    const source = a.source ?? (typeof before?.source === 'string' ? before.source : undefined);
    if (source && source !== 'frame' && ctx.doc.assets[source]?.type !== 'image') throw new Error(`${source}: an image asset of the project, or "frame" for a still of the composition, is expected`);
    const prompt = a.again ? againPrompt(words, a.change) : words;
    const placement = clipPlacement(duration, c.duration, a.at === undefined ? undefined : Number(a.at), ctx.time);
    const showing = a.again ? layersOf(ctx, a.again) : [];
    // made again, the record keeps where the clip already starts, not where a new one would go
    const recordedAt = before?.at == null ? undefined : Number(before.at);
    const recordAt = a.again
      ? showing[0]?.layer.in ?? (recordedAt !== undefined && Number.isFinite(recordedAt) ? recordedAt : placement.at)
      : placement.at;
    // a still is read where the clip starts; made again, it keeps the record's frame unless another is asked
    const recordedFrame = before?.sourceAt == null ? undefined : Number(before.sourceAt);
    const frameAt = source === 'frame'
      ? (a.again && a.source === undefined && recordedFrame !== undefined && Number.isFinite(recordedFrame)
          ? Math.max(0, Math.min(recordedFrame, c.duration))
          : a.again && a.source === 'frame' && showing[0]
            ? Math.max(0, Math.min(showing[0].layer.in ?? 0, c.duration))
            : recordAt)
      : recordAt;
    const at = recordAt;
    const fit = a.fit ?? 'cover', background = a.background ?? false;
    // it costs money: the user says yes first, or the turn's allowance does; each second of the clip counts
    await payFor(t('video.paidTitle'), t('video.paidText', { prompt: clip(prompt, 140), seconds: duration }), t('video.paidYes'), 'use footage already in the project', duration);
    const still = source ? await sourceOf(ctx, source, frameAt) : undefined;
    const ask: VideoAsk = { prompt, ratio, duration, provider, ...(still ? { source: still } : {}) };
    const made: MadeVideo = await api.generateVideo(ask, ctx.signal);
    const label = a.again ? String(ctx.doc.assets[a.again].name ?? a.again.replace(/^video-/, '')) : a.name ?? words.toLowerCase().split(/\s+/).slice(0, 4).join('-');
    const record: Record<string, unknown> = {
      prompt: words, provider: made.provider, model: made.model, ratio, duration, fit,
      at: +recordAt.toFixed(3),
      ...(source ? { source, ...(source === 'frame' ? { sourceAt: +frameAt.toFixed(3) } : {}) } : {}),
      ...(a.again ? { again: a.again, ...(a.change ? { change: a.change } : {}) } : {}),
      ...(before ? { before: { ...before, before: undefined } } : {}),
    };
    const kept = await keepMedia(ctx, 'video', a.again ? String(ctx.doc.assets[a.again].src).split('/').pop()!.replace(/\.[a-z0-9]+$/i, '') : label, made.blob, record);
    const replaced = a.again ? againOps(ctx, a.again, kept) : [];
    const resized = a.again && recorded !== undefined && Number.isFinite(recorded) && Math.abs(recorded - duration) > 0.001
      ? resizeLayers(ctx, a.again, recorded, duration)
      : [];
    const placed = a.again ? null : placeMedia(ctx, 'video', kept.asset, label, { fit, at, out: placement.out, background });
    const ops = a.again ? [...replaced, ...resized] : [...kept.ops, ...placed!.ops];
    const frame = await poster(made.blob);
    const againNote = !showing.length ? ' — made again in place; no layer in this project shows it'
      : resized.length ? ` — made again in place: the layers showing it follow the new ${duration} s length (trimmed ones keep their trim)`
        : ' — made again in place: the layers showing it keep their trim';
    return {
      ops, reload: a.again ? [a.again] : kept.reload, label: `Clip ${label}`,
      text: `Clip made by ${made.provider} (${made.model}, ${ratio}, ${duration} s${source ? `, animated from ${source === 'frame' ? `the frame at ${frameAt.toFixed(2)} s` : source}` : ''}), saved as asset ${a.again ?? kept.asset} with its record${placed ? `; layer ${placed.layer}${background ? ' in the background' : ''} from ${at.toFixed(2)} s to ${placement.out.toFixed(2)} s` : againNote}. Look at it with media_frame at a time, and find its cuts with shots.`,
      ...(frame ? { images: [{ url: frame, caption: `${label} · ${made.provider}` }] } : {}),
      notice: t('video.made', { name: label, provider: made.provider, model: made.model }),
    };
  },
};

export const VIDEO_TOOLS: ToolType[] = [generateVideo];
