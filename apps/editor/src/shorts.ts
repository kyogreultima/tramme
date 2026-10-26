// A long video cut into shorts: the transcript grouped into passages that
// stand alone (candidates), the passages the assistant picks built into one
// composition per short — the video framed to fill the format, the transcript
// remapped to the short and captioned, a title with its bar. Every short is
// an ordinary composition: editable, checked, exported like any other
// (docs/shorts-roadmap.md).

import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import { applyOps, isAudioAnalysis, isSubjects, isTranscript, pointer, remapTranscript, runChecks, transcriptIdOf, type Composition, type Layer, type Op, type Subjects, type ToolContext, type ToolType, type Transcript, type TrammeDoc, type AudioAnalysis } from '@tramme/core';
import { TEMPLATES } from './templates.ts';
import { sheetOf } from './review.ts';
import { clip, freshId, slug } from './model.ts';
import { t } from './i18n/index.ts';

const FORMATS = { vertical: [1080, 1920], square: [1080, 1080], horizontal: [1920, 1080] } as const;
type Format = keyof typeof FORMATS;

/** the transcript of a video asset of the project (it must exist: get_transcript makes it) */
async function transcriptOf(ctx: ToolContext, assetId: string): Promise<{ t: Transcript; id: string }> {
  const id = transcriptIdOf(assetId);
  if (!ctx.doc.assets[id]) throw new Error(`no transcript for "${assetId}": make one first (get_transcript), or open the project from the video`);
  const t = await ctx.transcript(id);
  if (!isTranscript(t)) throw new Error(`${id} is not a transcript`);
  return { t, id };
}

// ── candidates ───────────────────────────────────────────────
export interface Candidate {
  /** file time (s), a little air included on both sides */
  from: number;
  to: number;
  /** what is said, the words joined */
  text: string;
  words: number;
}

/** the transcript grouped into passages that stand alone: sentences packed between min and max, cut on pauses and sentence ends */
export function candidatesOf(t: Transcript, { min = 15, max = 45, air = 0.4 }: { min?: number; max?: number; air?: number } = {}): Candidate[] {
  const sentences: { s: number; e: number; text: string; n: number }[] = [];
  let cur: Transcript['words'] = [];
  const flush = () => {
    if (!cur.length) return;
    sentences.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(' '), n: cur.length });
    cur = [];
  };
  t.words.forEach((w, i) => {
    if (cur.length && w.s - t.words[i - 1].e > 0.6) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  });
  flush();
  const out: Candidate[] = [];
  let group: typeof sentences = [];
  const push = () => {
    if (!group.length) return;
    out.push({ from: Math.max(0, group[0].s - air), to: group[group.length - 1].e + air, text: group.map((s) => s.text).join(' '), words: group.reduce((a, s) => a + s.n, 0) });
    group = [];
  };
  for (const s of sentences) {
    // a long pause ends the passage: dead air is not what a short is made of
    if (group.length && (s.s - group[group.length - 1].e > 2 || s.e - group[0].s + (s.e - s.s) > max)) push();
    group.push(s);
    if (s.e - group[0].s >= min) push();
  }
  push();
  return out;
}

// ── candidates without speech ────────────────────────────────
/** the cuts of a video, as the shots tool saves them */
export interface ShotList { duration: number; cuts: number[] }

/** the loudness of the sound smoothed over a second, one value a frame of the analysis' rate */
function smoothed(a: AudioAnalysis): number[] {
  const rms = a.envelope.rms, half = Math.max(1, Math.round(a.rate / 2));
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < rms.length + half; i++) {
    if (i < rms.length) sum += rms[i];
    if (i - 2 * half - 1 >= 0) sum -= rms[i - 2 * half - 1];
    if (i - half >= 0) out.push(sum / Math.min(rms.length, i + 1, 2 * half + 1));
  }
  return out;
}

/**
 * Passages of a video nobody speaks in (a match, a ride, a build-up), from
 * the beats analysis and the shots: the build-ups into a louder section (the
 * change landing two thirds in) and the loudest moments, snapped to the cuts
 * or bar lines near their ends, the overlaps kept once — each described in
 * words (what happens, its loudness, its cuts) as the speech's candidates
 * are, so the choice is made the same way.
 */
export function momentsOf(a: AudioAnalysis | null, shots: ShotList | null, { min = 15, max = 45 }: { min?: number; max?: number } = {}): (Candidate & { score: number })[] {
  const duration = a?.duration ?? shots?.duration ?? 0;
  if (!duration) return [];
  const span = Math.min(duration, Math.max(min, Math.min(max, (min + max) / 2)));
  const loud = a ? smoothed(a) : [];
  const at = (t: number) => (loud.length ? loud[Math.max(0, Math.min(loud.length - 1, Math.round(t * a!.rate)))] : 0);
  const meanOf = (from: number, to: number) => {
    if (!loud.length) return 0;
    let s = 0, n = 0;
    for (let t = from; t <= to; t += 0.25) { s += at(t); n++; }
    return n ? s / n : 0;
  };
  // the ends land on a cut or a bar line when one is near (within 1.5 s), else where they fall
  const marks = [...(shots?.cuts ?? []), ...(a?.downbeats ?? [])].sort((x, y) => x - y);
  const snap = (t: number) => {
    let best = t, gap = 1.5;
    for (const m of marks) if (Math.abs(m - t) < gap) { gap = Math.abs(m - t); best = m; }
    return Math.max(0, Math.min(duration, best));
  };
  const raw: { from: number; to: number; text: string; score: number }[] = [];
  // the build-ups: a section louder than the one before, its change two thirds in
  let level = a?.sections?.[0]?.level ?? 0;
  for (const sec of a?.sections ?? []) {
    if (sec.level - level >= 0.2 && sec.t > 2) {
      const from = snap(sec.t - span * 0.65), to = snap(Math.min(duration, from + span));
      raw.push({ from, to, text: `a build-up into a louder section at ${sec.t.toFixed(1)} s (loudness ${level.toFixed(2)} → ${sec.level.toFixed(2)})`, score: meanOf(from, to) + (sec.level - level) });
    }
    level = sec.level;
  }
  // the loudest moments: peaks of the smoothed loudness, a span apart
  if (loud.length) {
    const peaks: number[] = [];
    const order = loud.map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0]);
    for (const [, i] of order) {
      const t = i / a!.rate;
      if (peaks.every((p) => Math.abs(p - t) >= span)) peaks.push(t);
      if (peaks.length >= 8) break;
    }
    for (const t of peaks) {
      const from = snap(Math.max(0, t - span / 2)), to = snap(Math.min(duration, from + span));
      raw.push({ from, to, text: `the loudest moment around ${t.toFixed(1)} s (loudness ${at(t).toFixed(2)})`, score: meanOf(from, to) });
    }
  }
  // no sound analysis: the shots alone, the busiest stretches (the most cuts a span)
  if (!loud.length && shots?.cuts.length) {
    for (const c of shots.cuts) {
      const from = snap(c), to = snap(Math.min(duration, c + span));
      raw.push({ from, to, text: `a run of cuts from ${c.toFixed(1)} s`, score: shots.cuts.filter((x) => x >= from && x <= to).length / span });
    }
  }
  // each kept once: an overlap of more than half goes to the stronger
  const kept: typeof raw = [];
  for (const c of raw.filter((c) => c.to - c.from >= Math.min(min, duration) * 0.8).sort((x, y) => y.score - x.score)) {
    if (kept.some((k) => Math.min(k.to, c.to) - Math.max(k.from, c.from) > 0.5 * (c.to - c.from))) continue;
    kept.push(c);
  }
  return kept.map((c) => {
    const cuts = (shots?.cuts ?? []).filter((x) => x > c.from && x < c.to).length;
    return { from: +c.from.toFixed(2), to: +c.to.toFixed(2), words: 0, score: +c.score.toFixed(3), text: `${c.text}; ${cuts ? `${cuts} cut${cuts > 1 ? 's' : ''} in it` : 'one shot'}, ${(c.to - c.from).toFixed(1)} s` };
  });
}

/** the beats analysis and the shots of a video asset, when they were made */
async function analysesOf(ctx: ToolContext, assetId: string): Promise<{ audio: AudioAnalysis | null; shots: ShotList | null }> {
  const read = async (id: string) => {
    const a = ctx.doc.assets[id.slice(0, 64)];
    if (!a || a.type !== 'json') return null;
    try { return JSON.parse((await ctx.readText(a.src)) ?? 'null'); } catch { return null; }
  };
  const audio = await read(`analysis-${assetId}`), shots = await read(`shots-${assetId}`);
  return { audio: isAudioAnalysis(audio) ? audio : null, shots: shots && Array.isArray(shots.cuts) && typeof shots.duration === 'number' ? shots : null };
}

// ── the frame follows the subject ────────────────────────────
/** the subjects analysis of a video asset of the project (the subjects tool), when there is one */
async function subjectsOf(ctx: ToolContext, assetId: string): Promise<Subjects | null> {
  const a = ctx.doc.assets[`subjects-${assetId}`.slice(0, 64)];
  if (!a || a.type !== 'json') return null;
  try {
    const s = JSON.parse((await ctx.readText(a.src)) ?? 'null');
    return isSubjects(s) ? s : null;
  } catch { return null; }
}

const clamp01 = (v: number, lo = 0.05, hi = 0.95) => Math.min(hi, Math.max(lo, v));

type Box = Subjects['frames'][number]['boxes'][number];
/** the biggest person of an analysed frame, or null */
const biggestOf = (f: Subjects['frames'][number]) => f.boxes.filter((b) => b.label === 'person').reduce((a, b) => (!a || b.w * b.h > a.w * a.h ? b : a), null as Box | null);

/** focus keys from points over time: a drift under 4 % of the picture is not worth a keyframe (a nervous pan is worse than a slow one) */
function keysOf(points: { t: number; v: [number, number] }[]): { t: number; v: [number, number] }[] {
  const out: { t: number; v: [number, number] }[] = [];
  let last: [number, number] | null = null;
  for (const p of points) {
    const v: [number, number] = [clamp01(p.v[0]), clamp01(p.v[1])];
    if (last && Math.abs(v[0] - last[0]) < 0.04 && Math.abs(v[1] - last[1]) < 0.04) continue;
    out.push({ t: +p.t.toFixed(3), v });
    last = v;
  }
  return out;
}

/** the focus track of a passage: where the biggest person is (0..1 of the picture) at each analysed frame, held when nobody is found */
export function focusTrack(subjects: Subjects, from: number, to: number): { t: number; v: [number, number] }[] {
  const points: { t: number; v: [number, number] }[] = [];
  for (const f of subjects.frames.filter((f) => f.t >= from && f.t <= to)) {
    const b = biggestOf(f);
    if (b) points.push({ t: f.t, v: [b.x + b.w / 2, b.y + b.h / 2] });
  }
  return keysOf(points);
}

/**
 * The boxes jump: the person lost on more than a third of the looks, or
 * their centre leaping a quarter of the picture between two looks more than
 * once in five — a detector hesitating, not a person moving.
 */
export function jumpy(subjects: Subjects, from: number, to: number): boolean {
  const frames = subjects.frames.filter((f) => f.t >= from && f.t <= to);
  if (frames.length < 3) return false;
  const found = frames.map(biggestOf);
  const lost = found.filter((b) => !b).length;
  let leaps = 0, pairs = 0;
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1], b = found[i];
    if (!a || !b) continue;
    pairs++;
    if (Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) > 0.25) leaps++;
  }
  return lost / frames.length > 1 / 3 || (pairs > 0 && leaps / pairs > 0.2);
}

/**
 * The push-in a passage gains: when the person stays small in the picture
 * (their height under 35 % of it, the median of the looks), the scale the
 * frame settles to so they fill about 45 % — gentle, 1.25 at most; null when
 * they already fill the frame or nobody is found.
 */
export function pushIn(subjects: Subjects, from: number, to: number): number | null {
  const heights = subjects.frames.filter((f) => f.t >= from && f.t <= to).map(biggestOf).filter((b): b is Box => !!b).map((b) => b.h).sort((a, b) => a - b);
  if (!heights.length) return null;
  const median = heights[Math.floor(heights.length / 2)];
  if (median >= 0.35) return null;
  return +Math.min(1.25, 0.45 / Math.max(0.05, median)).toFixed(3);
}

/** where the white of a mask is (0..1 of the picture), weighted by its light; null when it holds under 1 % of white */
export function centroidOf(px: Uint8ClampedArray, w: number, h: number): [number, number] | null {
  let sx = 0, sy = 0, sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = (px[i] + px[i + 1] + px[i + 2]) / 765;
    if (v < 0.5) continue;
    sx += v * (x + 0.5); sy += v * (y + 0.5); sum += v;
  }
  return sum < w * h * 0.01 ? null : [sx / sum / w, sy / sum / h];
}

/** the cutout's mask of a video asset, when one was made (cutout-<layer> of a layer that shows it): timed like the file */
function maskOf(ctx: ToolContext, assetId: string): string | null {
  for (const comp of Object.values(ctx.doc.compositions)) {
    for (const [id, l] of Object.entries(comp.layers)) {
      const mask = `cutout-${id}`.slice(0, 64);
      if (l.type === 'video' && l.props?.video === assetId && ctx.doc.assets[mask]?.type === 'video') return mask;
    }
  }
  return null;
}

/** the focus track from the cutout's mask: the person's centre every half second of the passage (file time) */
async function matteTrack(ctx: ToolContext, mask: string, from: number, to: number): Promise<{ t: number; v: [number, number] }[]> {
  const input = new Input({ source: new UrlSource(ctx.assetUrl(mask)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const W = 64, H = Math.max(1, Math.round((64 * track.displayHeight) / Math.max(1, track.displayWidth)));
    const sink = new CanvasSink(track, { width: W, height: H, fit: 'fill', poolSize: 2 });
    const times = Array.from({ length: Math.max(1, Math.floor((to - from) / 0.5) + 1) }, (_, i) => +(from + i * 0.5).toFixed(3)).filter((t) => t <= to);
    const g = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
    const points: { t: number; v: [number, number] }[] = [];
    let i = 0;
    for await (const f of sink.canvasesAtTimestamps(times)) {
      if (ctx.signal.aborted) throw new Error('stopped');
      const at = times[i++];
      if (!f) continue;
      g.drawImage(f.canvas as CanvasImageSource, 0, 0, W, H);
      const c = centroidOf(g.getImageData(0, 0, W, H).data, W, H);
      if (c) points.push({ t: at, v: c });
    }
    return keysOf(points);
  } catch { return []; } finally { input.dispose(); }
}

// ── the hook ─────────────────────────────────────────────────
/** the title's span on the remapped transcript: it lands no later than the first word and holds to the end of the first sentence, capped */
export function titleSpan(t: Transcript, cap = 3.5): { at: number; duration: number } {
  const w = t.words[0];
  if (!w) return { at: 0.2, duration: 2.5 };
  const at = Math.max(0, +(w.s - 0.15).toFixed(2));
  const sentence = t.words.find((x) => /[.!?…]$/.test(x.w));
  const duration = Math.max(1.2, Math.min(cap, +((sentence?.e ?? w.s + 2.5) + 0.4 - at).toFixed(2)));
  return { at, duration };
}

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** when the strong word is said (composition time), first occurrence as whole words; null when it is not in the passage */
export function keywordAt(t: Transcript, keyword: string): number | null {
  const parts = keyword.trim().toLowerCase().split(/\s+/).map(bare).filter(Boolean);
  if (!parts.length) return null;
  for (let i = 0; i + parts.length <= t.words.length; i++) {
    if (parts.every((p, k) => bare(t.words[i + k].w) === p)) return +t.words[i].s.toFixed(2);
  }
  return null;
}

/** the project's brand, when it has one: the plate and ink tokens a kit brings */
export function brandOf(doc: TrammeDoc): { plate: string; ink: string } | null {
  const color = (name: string) => (doc.tokens?.[name]?.type === 'color' ? String(doc.tokens[name].value) : null);
  const plate = color('plate'), ink = color('ink');
  return plate && ink ? { plate, ink } : null;
}

// ── build ────────────────────────────────────────────────────
interface PlanItem { from: number; to: number; title?: string; keyword?: string }
interface Made { comp: string; title: string; duration: number; framed: boolean; follow: 'boxes' | 'matte' | null; zoom: number | null }

/** one composition per passage: the video filling the frame, the transcript remapped and captioned, the title, the keyword, the brand's progress bar and end card */
async function build(ctx: ToolContext, assetId: string, plan: PlanItem[], format: Format): Promise<{ ops: Op[]; made: Made[]; doc: TrammeDoc; missed: { title: string; keyword: string }[] }> {
  // a video nobody speaks in has no transcript: no captions, the title on its own beat
  const src = ctx.doc.assets[transcriptIdOf(assetId)] ? (await transcriptOf(ctx, assetId)).t : null;
  const { audio, shots } = src ? { audio: null, shots: null } : await analysesOf(ctx, assetId);
  const length = src?.duration ?? audio?.duration ?? shots?.duration ?? Infinity;
  const subjects = await subjectsOf(ctx, assetId);
  const [w, h] = FORMATS[format];
  const fps = ctx.doc.compositions[ctx.compId]?.fps ?? 30;
  const tid = transcriptIdOf(assetId);
  const brand = brandOf(ctx.doc);
  const taken: Record<string, unknown> = { ...ctx.doc.compositions };
  const ops: Op[] = [], made: Made[] = [], missed: { title: string; keyword: string }[] = [];
  let doc: TrammeDoc = ctx.doc;
  for (let n = 1; n <= plan.length; n++) {
    const { from, to, title, keyword } = plan[n - 1];
    const lo = Math.max(0, Number(from) || 0), hi = Math.min(length, Number(to) || 0), dur = hi - lo;
    if (!(dur >= 2)) continue;
    const cs = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    const cid = freshId(taken, `short-${cs || n}`);
    taken[cid] = 1;
    const name = title ?? `Short ${n}`;
    const vid = freshId({ footage: 1 }, 'footage');
    // the frame follows the subject: the people boxes, or the cutout's mask when the boxes jump and a mask exists
    const mask = subjects && jumpy(subjects, lo, hi) ? maskOf(ctx, assetId) : null;
    const matte = mask ? await matteTrack(ctx, mask, lo, hi) : [];
    const track = matte.length ? matte : subjects ? focusTrack(subjects, lo, hi) : [];
    // a person small in the frame: a gentle push-in that settles over most of the short
    const zoom = subjects ? pushIn(subjects, lo, hi) : null;
    const card = brand ? 2.5 : 0;
    const video: Layer = {
      type: 'video', name, in: 0, out: +dur.toFixed(3),
      transform: { position: [w / 2, h / 2], ...(zoom ? { scale: { $k: [{ t: 0, v: [1, 1], ease: [0.42, 0, 0.58, 1] }, { t: +(dur * 0.8).toFixed(3), v: [zoom, zoom] }] } } : {}) },
      props: { video: assetId, start: +lo.toFixed(3), size: [w, h], fit: 'cover', ...(track.length ? { focus: { $k: track.map(({ t, v }) => ({ t: +(t - lo).toFixed(3), v })) } } : {}) },
    };
    const comp: Composition = { name, width: w, height: h, fps, duration: +(dur + card).toFixed(3), layers: { [vid]: video }, order: [vid] };
    ops.push({ op: 'add', path: pointer('compositions', cid), value: comp });
    // the dressings build against the document as the proposal will make it, so their layers stack in order
    let sd: TrammeDoc = { ...doc, compositions: { ...doc.compositions, [cid]: comp } };
    // the transcript of the passage, composition time: the captions read it
    const remapped = src ? remapTranscript(src, [{ from: lo, to: hi }], 0) : null;
    if (remapped) {
      const path = await ctx.writeFile(`assets/transcripts/${slug(`${assetId}-short-${n}`)}.json`, JSON.stringify(remapped));
      const sid = `${tid.slice(0, 56)}-short${n}`;
      ops.push({ op: 'add', path: pointer('assets', sid), value: { type: 'json', src: path, name: `Transcript · ${name}` } });
      sd = { ...sd, assets: { ...sd.assets, [sid]: { type: 'json' as const, src: path, name: `Transcript · ${name}` } } };
      const captions = TEMPLATES.captions.build(sd, cid, { at: 0, transcript: sid, place: 'bottom' });
      ops.push(...captions.ops);
      sd = applyOps(sd, captions.ops).doc;
    }
    if (title) {
      // the title lands with the first sentence, not at a fixed 0.2 s (without speech: on the first cut or bar line after the start)
      const first = !remapped ? [...(shots?.cuts ?? []), ...(audio?.downbeats ?? [])].filter((x) => x > lo + 0.2 && x < lo + 3).sort((x, y) => x - y)[0] : undefined;
      const span = remapped ? titleSpan(remapped) : { at: first !== undefined ? +(first - lo).toFixed(2) : 0.2, duration: 2.5 };
      const head = TEMPLATES.title.build(sd, cid, { at: span.at, duration: span.duration, text: title, place: 'top' });
      ops.push(...head.ops);
      sd = applyOps(sd, head.ops).doc;
    }
    if (keyword) {
      const at = remapped ? keywordAt(remapped, keyword) : null;
      // a keyword that is not said is said back, not placed in silence
      if (at === null) missed.push({ title: name, keyword });
      else {
        const kw = TEMPLATES.keyword.build(sd, cid, { at, text: keyword });
        ops.push(...kw.ops);
        sd = applyOps(sd, kw.ops).doc;
      }
    }
    if (brand) {
      const bar = TEMPLATES.progress.build(sd, cid, { at: 0 });
      ops.push(...bar.ops);
      sd = applyOps(sd, bar.ops).doc;
      const end = TEMPLATES['end-card'].build(sd, cid, { at: +dur.toFixed(3), duration: card, text: title ?? name });
      ops.push(...end.ops);
      sd = applyOps(sd, end.ops).doc;
    }
    doc = sd;
    made.push({ comp: cid, title: name, duration: dur + card, framed: !!subjects, follow: matte.length ? 'matte' : track.length ? 'boxes' : null, zoom });
  }
  if (!made.length) throw new Error('no passage of the plan is usable (from and to in the file, 2 s at least)');
  return { ops, made, doc, missed };
}

// ── the tool ─────────────────────────────────────────────────
const shorts: ToolType<{ asset: string; format?: Format; min?: number; max?: number; count?: number; plan?: PlanItem[] }> = {
  name: 'shorts', title: 'Cut shorts', description: 'a long video as shorts: lists the passages that stand alone (candidates), or builds one composition per passage of a plan — the video framed for the format, captions on the remapped transcript, the title landing with the first sentence, a keyword on the strong word, a progress bar and an end card where the project has a brand',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: 'video', title: 'Video' },
      format: { enum: ['vertical', 'square', 'horizontal'], title: 'Format', description: 'vertical 1080×1920 by default' },
      min: { type: 'number', minimum: 5, maximum: 90, title: 'Shortest (s)', description: 'candidates: the shortest passage worth keeping, 15 s by default' },
      max: { type: 'number', minimum: 10, maximum: 180, title: 'Longest (s)', description: 'candidates: 45 s by default' },
      count: { type: 'integer', minimum: 1, maximum: 12, title: 'Candidates', description: 'how many to list, 3 by default' },
      plan: {
        type: 'array', title: 'Plan', description: 'build: the passages to turn into shorts, in file time, each with its title and the strong word it turns on',
        items: { type: 'object', properties: { from: { type: 'number', title: 'From (s)' }, to: { type: 'number', title: 'To (s)' }, title: { type: 'string', title: 'Title' }, keyword: { type: 'string', title: 'Keyword', description: 'the strong word of the passage, said in it: it pops on screen the moment it is said' } }, required: ['from', 'to'] },
      },
    },
    required: ['asset'],
  },
  ai: {
    when: 'a long video of someone speaking (an interview, a talk, a stream): first the candidates, then build the picked ones with a plan — one call, one plan, and the user sees the whole proposal. Each passage takes a title and the strong word it turns on (keyword: said in the passage). The frame follows the speaker when a subjects analysis of the video exists (use_tool "subjects" first when the format crops the picture). A video nobody speaks in (a match, a ride): its candidates come from the beats and shots analyses',
    avoid: 'building without reading the candidates; a passage that starts mid-idea (it is skipped, not rescued); titles that promise what the passage does not keep; a keyword that is not said in the passage (the build says so back and places nothing)',
    example: { asset: 'talk', plan: [{ from: 132.5, to: 171, title: 'The one idea that changed everything', keyword: 'everything' }] },
  },
  async run({ asset, format = 'vertical', min = 15, max = 45, count = 3, plan }, ctx) {
    const a = ctx.doc.assets[asset];
    if (!a || a.type !== 'video') throw new Error(`${asset}: a video asset of the project is expected`);
    if (!plan?.length && !ctx.doc.assets[transcriptIdOf(asset)]) {
      // nobody speaks: the candidates come from the sound and the cuts, described the same way
      const { audio, shots } = await analysesOf(ctx, asset);
      if (!audio && !shots) throw new Error(`no transcript, no beats analysis and no shots for "${asset}": a video someone speaks in needs its transcript (get_transcript); one nobody speaks in, its sound's beats (use_tool "beats") and its cuts (use_tool "shots") — then ask again`);
      const moments = momentsOf(audio, shots, { min, max });
      if (!moments.length) return { text: `No passage of ${min} s or more stands out in "${asset}".`, notice: t('shorts.nothing') };
      const list = moments.slice(0, count);
      return {
        text: [`${moments.length} passage(s) worth a short, from the sound${shots ? ' and the cuts' : ''} (nobody speaks in "${asset}"):`, ...list.map((c, i) => `${i + 1}. [${c.from.toFixed(1)}–${c.to.toFixed(1)} s] ${c.text}`), 'Pick the ones with a shape (a build-up and its release, a run of cuts, a peak), then call shorts again with plan: [{ from, to, title }] (file time; no keyword: nothing is said). Say which you would pick and why — look at them first with the still tool when the sound alone does not tell.'].join('\n'),
        notice: t('shorts.candidates', { n: list.length }),
      };
    }
    if (!plan?.length) {
      const { t: src } = await transcriptOf(ctx, asset);
      const cands = candidatesOf(src, { min, max });
      if (!cands.length) return { text: `No passage of ${min} s or more in the transcript (${src.duration.toFixed(1)} s, ${src.words.length} words).`, notice: t('shorts.nothing') };
      const list = cands.slice(0, count);
      return {
        text: [`${cands.length} passage(s) that stand alone:`, ...list.map((c, i) => `${i + 1}. [${c.from.toFixed(1)}–${c.to.toFixed(1)} s, ${c.words} words] ${clip(c.text, 160)}`), 'Pick the ones that hook in their first sentence and end on a point — a short that starts mid-idea is skipped, not rescued — then call shorts again with plan: [{ from, to, title, keyword }] (file time, the title in a few words, the keyword the strong word said in the passage). Say which you would pick and why.'].join('\n'),
        notice: t('shorts.candidates', { n: list.length }),
      };
    }
    const { ops, made, doc, missed } = await build(ctx, asset, plan, format);
    // each short, seen as the checks see it (the sound is left to check, run per composition)
    const lines: string[] = [];
    for (const m of made) {
      const issues = await runChecks(doc, ctx.registry, m.comp);
      lines.push(`- ${m.comp}: "${m.title}", ${m.duration.toFixed(1)} s (${format}${m.follow === 'matte' ? ', the frame follows the speaker by the cutout\'s mask (the boxes jumped)' : m.follow ? ', the frame follows the speaker' : ''}${m.zoom ? `, a push-in to ×${m.zoom}` : ''}) — ${issues.length ? `${issues.length} note(s): ${issues.slice(0, 3).map((i) => i.message).join('; ')}${issues.length > 3 ? '…' : ''}` : 'nothing to fix at first read'}`);
    }
    // a contact sheet, one cell per short, when there are several
    let images: { url: string; caption: string }[] | undefined;
    if (made.length > 1 && typeof Image !== 'undefined') {
      const cells: { image: HTMLImageElement; label: string }[] = [];
      for (const m of made) {
        const image = new Image();
        image.src = await ctx.renderStill(Math.min(1, m.duration / 2), m.comp);
        await image.decode();
        cells.push({ image, label: m.title });
      }
      const cw = 250, ch = Math.round((cw * doc.compositions[made[0].comp].height) / doc.compositions[made[0].comp].width);
      images = [{ url: sheetOf(cells, cw, ch, 3), caption: t('shorts.sheet', { n: made.length }) }];
    }
    return {
      ops, label: made.length > 1 ? `Shorts ×${made.length}` : made[0].title, images,
      text: [`${made.length} short(s) built as compositions:`, ...lines, ...(missed.length ? [`Keyword(s) not said in their passage, nothing placed: ${missed.map((m) => `"${m.keyword}" (${m.title})`).join(', ')} — pick one that is said, or drop it.`] : []), ...(made.some((m) => m.framed) ? [] : [`The frame keeps the centre of the picture: run subjects on "${asset}" first when the format crops the speaker out, and build again.`]), 'Each is an ordinary composition: check it (check, after switching to it), export it like any other (the export offers all the shorts at once).'].join('\n'),
      notice: t('shorts.built', { n: made.length }),
    };
  },
};

export const SHORTS_TOOLS: ToolType[] = [shorts];

/** the document's shorts: the compositions the build named short-, in build order */
export const shortsOf = (doc: TrammeDoc): { id: string; name: string; duration: number }[] =>
  Object.entries(doc.compositions).filter(([id]) => id.startsWith('short-')).map(([id, c]) => ({ id, name: c.name, duration: c.duration }));
