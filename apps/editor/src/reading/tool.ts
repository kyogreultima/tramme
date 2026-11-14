// The read-reference tool: how a video, a gif or a Lottie the user gave is
// made, read once and saved (assets/references/<name>.reference.json), so
// their film can be made the same way around their own assets. A video is
// cut on its shots, its music read, its camera measured on its pixels, and
// a model that sees reads the rest from a strip of each shot; a Lottie is
// read exactly from its layers. The user's assets are proposed for the slots,
// and the reading shown to the user as an outline before anything is made,
// unless they accept readings in advance.

import { analyseAudio, assignSlots, type Asset, parseReading, pointer, readingIssues, readingText, ReadingSchema, MoveSchema, SlotSchema, READINGS_DIR, scenesFromCuts, TRANSITIONS, TEXT_RHYTHMS, type Move, type Op, type Reading, type ReadingScene, type Slot, type ToolContext, type ToolType, type UserAsset } from '@tramme/core';
import { readingFromLottie } from '@tramme/interop';
import type { Usage } from '@tramme/assistant';
import { consult, dataImage, seesPictures, type ConsultRequest, type Via } from '../ai/consult.ts';
import { canvas, cutsOf, decodeMono, distance, hex, histogram, paletteOf, RATE, SHOT_STEP } from '../perception.ts';
import { pixelsOf, type Pixels } from '../flow.ts';
import { slug } from '../model.ts';
import { t } from '../i18n/index.ts';
import { PICTURE_KINDS } from '../filmplan.ts';
import { shotCamera } from './motion.ts';
import { openGif, openVideo, type FrameSource } from './frames.ts';

/** what the tool needs from the editor: kept apart so tests hand it stubs */
export interface ReadingHost {
  /** where the model's reading goes; null when the assistant has no route */
  via(): Via | null;
  consult(req: ConsultRequest, via: Via): Promise<{ text: string; usage: Usage }>;
  /** the consult counted with the turn's others */
  counted(usage: Usage, model: string): void;
  /** the frames of a video or a gif at a URL */
  open(url: string, gif: boolean): Promise<FrameSource>;
  /** the music of a video at a URL: its tempo, beats and bars; null when it has none */
  music(url: string, signal: AbortSignal): Promise<{ tempo?: number; beats: number[]; bars: number[] } | null>;
  /** the nearest typefaces to a description, the closest first */
  typefaces(description: string): Promise<string[]>;
  /** whether readings are accepted without showing them (the setting, or a turn left alone) */
  accepted(): boolean;
  /** the outline shown to the user: the reading as they leave it, or null when they decline */
  ask(reading: Reading, stills: string[], assets: UserAsset[]): Promise<Reading | null>;
}

let host: ReadingHost = {
  via: () => null,
  consult,
  counted: () => {},
  open: (url, gif) => (gif ? openGif(url) : openVideo(url)),
  async music(url, signal) {
    const a = analyseAudio(await decodeMono(url, signal), RATE);
    return a.beats.length >= 4 ? { tempo: a.tempo || undefined, beats: a.beats, bars: a.downbeats } : null;
  },
  async typefaces(description) {
    const [{ loadCatalogue }, { searchTypefaces }] = await Promise.all([import('../typefaces/catalogue.ts'), import('../typefaces/search.ts')]);
    return searchTypefaces(await loadCatalogue(), description, { count: 3 }).found.map((f) => f.font.family);
  },
  accepted: () => false,
  ask: async (reading) => reading,
};
/** the editor hands the tool its route, its setting and its outline; tests hand it stubs */
export function setReadingHost(next: Partial<ReadingHost>) { host = { ...host, ...next }; }

/** the user's own pictures and videos: what can fill a slot (never a reference, an analysis or a style frame) */
export function userAssets(ctx: Pick<ToolContext, 'doc'>): UserAsset[] {
  return Object.entries(ctx.doc.assets)
    .filter(([, a]) => (a.type === 'image' || a.type === 'video') && !a.reference && !a.src.startsWith('assets/frames/'))
    .map(([id, a]) => ({ id, type: a.type, ...(a.name ? { name: a.name } : {}), ...(a.tags ? { tags: a.tags } : {}) }));
}

/** the reading's file and its asset id, from the reference's id */
export const readingPath = (asset: string) => `${READINGS_DIR}/${slug(asset) || 'reference'}.reference.json`;
export const readingId = (asset: string) => `reading-${asset}`.slice(0, 64);

/** the first JSON object of an answer, read; null when there is none */
export function jsonIn(text: string): Record<string, unknown> | null {
  const from = text.indexOf('{'), to = text.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { const v = JSON.parse(text.slice(from, to + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clampTo = (x: number, max: number) => r3(Math.max(0, Math.min(max, x)));

/**
 * A scene of the reading from the model's answer and what was measured: its
 * times are the cuts', its camera the pixels' when the model gave none; a slot
 * or a move the answer gets wrong is left out rather than guessed.
 */
export function sceneFrom(measured: Pick<ReadingScene, 'id' | 'start' | 'end' | 'onBeat'>, said: Record<string, unknown> | undefined, camera: Move | null): ReadingScene {
  const len = measured.end - measured.start;
  const slots: Slot[] = [];
  for (const raw of Array.isArray(said?.slots) ? said.slots : []) {
    const o = raw as Record<string, unknown>;
    const box = Array.isArray(o.box) ? (o.box as number[]).map((v) => clampTo(Number(v), 1)) : null;
    const p = SlotSchema.safeParse({ ...o, id: slug(String(o.id ?? '')) || `slot${slots.length + 1}`, box, at: clampTo(Number(o.at ?? 0), len), asset: undefined, fill: undefined });
    if (p.success && !slots.some((s) => s.id === p.data.id) && slots.length < 16) slots.push(p.data);
  }
  const moves: Move[] = [];
  for (const raw of Array.isArray(said?.moves) ? said.moves : []) {
    const o = raw as Record<string, unknown>;
    const start = clampTo(Number(o.start ?? 0), len), end = clampTo(Number(o.end ?? len), len);
    const subject = o.subject === 'camera' ? 'camera' : slug(String(o.subject ?? ''));
    const p = MoveSchema.safeParse({ ...o, subject, start, end });
    if (p.success && end > start && (subject === 'camera' || slots.some((s) => s.id === subject)) && moves.length < 16) moves.push(p.data);
  }
  if (camera && !moves.some((m) => m.subject === 'camera')) moves.unshift(camera);
  const pick = <T extends string>(v: unknown, of: readonly T[], or: T): T => (of.includes(v as T) ? (v as T) : or);
  const what = typeof said?.what === 'string' && said.what.trim() ? said.what.trim().slice(0, 400) : `${slots.length} element(s)`;
  return {
    ...measured, kind: pick(said?.kind, PICTURE_KINDS, 'type'), what,
    ...(typeof said?.ground === 'string' && said.ground.trim() ? { ground: said.ground.trim().slice(0, 200) } : {}),
    slots, moves, transition: pick(said?.transition, TRANSITIONS, 'cut'), text: pick(said?.text, TEXT_RHYTHMS, slots.some((s) => s.role === 'headline' || s.role === 'text') ? 'held' : 'none'),
  };
}

export const READING_SYSTEM = `You read how a reference video is made, so another film can be made the same way with other content. You see one strip per shot: three frames of it, left to right (early, middle, late), labelled with its id and times.

Answer with one JSON object and nothing else:
{"type": {"description": "the lettering in words a typeface search reads: category, width, weight, case, tracking (e.g. condensed grotesque, heavy, capitals, tight)", "serif": false, "weight": "light|regular|medium|bold|heavy", "case": "upper|lower|mixed"},
 "texts": ["every text seen, verbatim, one entry per line of text"],
 "scenes": [{"id": "s1", "kind": "${PICTURE_KINDS.join('|')}", "what": "what the shot does, in terms of making: layout, scale, motion (never the brand, the product or the people by name)", "ground": "what is behind: a flat colour, a gradient, footage, a texture", "transition": "${TRANSITIONS.join('|')} (how it follows the shot before; the first: how the film opens)", "text": "${TEXT_RHYTHMS.join('|')}",
   "slots": [{"id": "short-name", "role": "logo|headline|text|screenshot|photo|video|product|person|figure|shape", "box": [x, y, w, h] (0..1 of the frame, at the middle frame), "enter": "none|fade|rise|fall|slide|scale|pop|mask|type-on|blur", "at": seconds from the shot's start, "words": count for text, "note": "what it is, generically (a phone screen, the brand's mark)"}],
   "moves": [{"subject": "camera or a slot id", "kind": "push-in|pull-out|pan|tilt|rise|fall|slide|scale|rotate|mask-reveal|type-on|parallax|hold", "start": s, "end": s, "direction": "left|right|up|down|in|out"}]}]}

One entry in "scenes" per strip, with its id. A slot is a place where content sits: every logo, picture, screen, video, title and line of text, and the figures and shapes that carry the design. Read places and sizes carefully from the frames. Trust the measured camera moves and times given with each strip.`;

/** the step (s) at which a cut is found to the frame, around where the shots' detection saw it */
const FINE = 1 / 60;
/** at most this many pictures go to the model */
const SHEETS = 16;

/** how much the picture changes from one look to the next, at these times (the first look has no change) */
async function changes(src: FrameSource, times: number[], ctx: ToolContext, tick?: (i: number) => void): Promise<{ t: number; d: number }[]> {
  const out: { t: number; d: number }[] = [];
  let prev: Float32Array | null = null, i = 0;
  for await (const c of src.frames(times, 48, 27)) {
    if (ctx.signal.aborted) throw new Error('stopped');
    const at = times[i++];
    tick?.(i);
    if (!c) continue;
    const h = histogram(c.getContext('2d', { willReadFrequently: true })!, 48, 27);
    if (prev) out.push({ t: at, d: distance(prev, h) });
    prev = h;
  }
  return out;
}

/** the time of the sharpest change in a run of looks `step` s apart: between the two looks it falls between; undefined when nothing changes */
export function sharpest(diffs: { t: number; d: number }[], step: number): number | undefined {
  const best = diffs.reduce<{ t: number; d: number } | undefined>((a, b) => (!a || b.d > a.d ? b : a), undefined);
  return best && best.d > 0.05 ? r3(best.t - step / 2) : undefined;
}

/** what a link's file is, by its type or else its extension: a video, a gif or a Lottie; null for anything else (a page) */
export function kindOfLink(type: string, url: string): 'video' | 'gif' | 'lottie' | null {
  const mime = type.split(';')[0].trim().toLowerCase(), ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase() ?? '';
  if (mime === 'image/gif' || (!mime.startsWith('video/') && ext === 'gif')) return 'gif';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (mime === 'application/json' || mime === 'application/lottie+json' || ext === 'json') return 'lottie';
  return null;
}

/** the largest file a link may bring (bytes) */
const LINK_MAX = 300 * 1024 * 1024;

/** the file a link points at, kept in the project as a reference: its asset, not declared yet (the tool's operations declare it) */
async function fromLink(ctx: ToolContext, link: string): Promise<{ id: string; asset: Asset; url: string; text?: string }> {
  let res: Response;
  try { res = await fetch(link, { signal: ctx.signal }); } catch (e) {
    if (ctx.signal.aborted) throw e;
    throw new Error('the link could not be read from here (its site does not share its files with other sites): download the file and drop it in the project, then read it');
  }
  if (!res.ok) throw new Error(`the link answered ${res.status}: check it, or download the file and drop it in the project`);
  if (Number(res.headers.get('content-length') ?? 0) > LINK_MAX) throw new Error('the file is over 300 MB: cut the part to remake and drop that instead');
  const blob = await res.blob(), kind = kindOfLink(res.headers.get('content-type') ?? blob.type, link);
  if (!kind) throw new Error('the link is no video, gif or Lottie file (the page of a streaming site is not read): give a link to the file itself, or drop the file');
  const file = decodeURIComponent(new URL(link).pathname.split('/').pop() ?? ''), base = slug(file.replace(/\.[a-z0-9]+$/i, '')) || 'reference';
  let id = base;
  for (let n = 2; ctx.doc.assets[id]; n++) id = `${base}-${n}`;
  const ext = kind === 'lottie' ? 'json' : kind === 'gif' ? 'gif' : (/\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? (blob.type.includes('webm') ? 'webm' : 'mp4'));
  const path = await ctx.writeFile(`${READINGS_DIR}/${id}.${ext}`, blob);
  return {
    id, url: ctx.fileUrl(path), ...(kind === 'lottie' ? { text: await blob.text() } : {}),
    asset: { type: kind === 'video' ? 'video' : kind === 'gif' ? 'image' : 'json', src: path, name: file || id, reference: true },
  };
}

/** the reading of a video or a gif: shots, music, camera, colours, and the model's look at a strip of each shot */
async function readVideo(ctx: ToolContext, source: { id: string; url: string; gif: boolean }, name: string): Promise<{ reading: Reading; stills: string[]; strips: string[] }> {
  const asset = source.id;
  const via = host.via();
  if (!via) throw new Error('reading a video needs the assistant: connect a model in the assistant\'s settings');
  if (!seesPictures(via.model)) throw new Error(`reading a video needs a model that sees pictures: ${via.model} does not (choose a Claude, GPT or Gemini model, or a local vision model)`);
  const src = await host.open(source.url, source.gif);
  try {
    const { duration, width, height } = src;
    if (!(duration > 0.2)) throw new Error('the reference is too short to read');
    // the shots: the picture's changes every SHOT_STEP s, as the shots tool reads them, then each cut found to the frame
    const times = Array.from({ length: Math.max(2, Math.floor(duration / SHOT_STEP)) }, (_, i) => r3(i * SHOT_STEP));
    const total = times.length * 2;
    const diffs = await changes(src, times, ctx, (i) => ctx.progress?.(i, total, t('reading.shots')));
    const cuts: number[] = [];
    for (const cut of cutsOf(diffs)) {
      const fine = Array.from({ length: Math.round((SHOT_STEP * 2) / FINE) + 1 }, (_, i) => r3(cut - SHOT_STEP + i * FINE)).filter((x) => x >= 0 && x <= duration);
      cuts.push(sharpest(await changes(src, fine, ctx), FINE) ?? cut);
    }
    const music = src.sound ? await host.music(source.url, ctx.signal).catch(() => null) : null;
    const measured = scenesFromCuts(cuts, duration, music ?? undefined).slice(0, 48);
    // three looks per shot for the model, two close looks for the camera, the middle one for the colours
    const sw = 320, sh = Math.max(1, Math.round((sw * height) / Math.max(1, width))), pw = 320, ph = Math.max(1, Math.round((pw * height) / Math.max(1, width)));
    const looks = measured.flatMap((s) => { const len = s.end - s.start; return [s.start + len * 0.12, s.start + len / 2, s.end - len * 0.12].map(r3); });
    const strips: string[] = [], sheets: HTMLCanvasElement[] = [], mids: (HTMLCanvasElement | null)[] = [];
    let strip = canvas(sw * 3, sh), k = 0;
    for await (const c of src.frames(looks, sw, sh)) {
      if (ctx.signal.aborted) throw new Error('stopped');
      ctx.progress?.(times.length + Math.round((k / looks.length) * times.length), total, t('reading.frames'));
      if (c) strip.g.drawImage(c, (k % 3) * sw, 0);
      if (k % 3 === 1) mids.push(c);
      if (k % 3 === 2) { strips.push(strip.c.toDataURL('image/jpeg', 0.82)); sheets.push(strip.c); strip = canvas(sw * 3, sh); }
      k++;
    }
    // the camera: a wide pair of looks for a slow zoom, a close pair for a fast pan, in the middle of each shot
    const pairs = measured.flatMap((s) => {
      const mid = (s.start + s.end) / 2, len = s.end - s.start, wide = Math.min(0.8, len / 2), close = Math.min(0.12, len / 4);
      return [mid - wide / 2, mid + wide / 2, mid - close / 2, mid + close / 2].map(r3);
    });
    const pix: (Pixels | null)[] = [];
    for await (const c of src.frames(pairs, pw, ph)) pix.push(c ? pixelsOf(c, pw, ph) : null);
    const pair = (a: number, b: number): [Pixels, Pixels, number] | null => (pix[a] && pix[b] ? [pix[a]!, pix[b]!, pairs[b] - pairs[a]] : null);
    const cameras = measured.map((s, j) => {
      const m = shotCamera(pair(j * 4, j * 4 + 1), pair(j * 4 + 2, j * 4 + 3), width);
      return m ? { subject: 'camera', start: 0, end: r3(s.end - s.start), ...m } as Move : null;
    });
    // the outline shows the middle frame of each shot
    const stills = mids.map((c) => c?.toDataURL('image/jpeg', 0.82) ?? '');
    // the colours: the middle frames side by side
    const { c: all, g: ag } = canvas(Math.max(1, mids.length) * 64, 36);
    mids.forEach((c, j) => { if (c) ag.drawImage(c, j * 64, 0, 64, 36); });
    let palette: string[] = [];
    try { palette = paletteOf(ag, all.width, all.height).colours.map((c) => hex(c.rgb)).slice(0, 6); } catch { /* no colour read */ }

    const facts = measured.map((s, j) => `${s.id}: ${s.start.toFixed(2)}–${s.end.toFixed(2)} s${s.onBeat ? `, cut on bar ${s.onBeat.bar + 1} beat ${s.onBeat.beat + 1}` : ''}${cameras[j] ? `, camera measured: ${cameras[j]!.kind} ${cameras[j]!.direction ?? ''} at about ${cameras[j]!.speed} px/s` : ', camera measured: holds'}`);
    // at most SHEETS pictures to the model: the strips stacked a few to a sheet when the shots are many
    const per = Math.ceil(sheets.length / SHEETS), images: { mediaType: string; data: string }[] = [];
    for (let j = 0; j < sheets.length; j += per) {
      const group = sheets.slice(j, j + per), { c, g } = canvas(sw * 3, sh * group.length);
      group.forEach((x, n) => g.drawImage(x, 0, n * sh));
      const image = dataImage(c.toDataURL('image/jpeg', 0.82));
      if (image) images.push(image);
    }
    const answer = await host.consult({
      system: READING_SYSTEM, signal: ctx.signal, images,
      text: `The reference "${name}": ${width}×${height}, ${duration.toFixed(2)} s, ${measured.length} shot(s)${music?.tempo ? `, music at ${Math.round(music.tempo)} bpm` : ''}.\nThe strips follow in this order${per > 1 ? `, ${per} to a picture, top to bottom` : ''}:\n${facts.join('\n')}`,
    }, via);
    host.counted(answer.usage, via.model);
    const said = jsonIn(answer.text);
    if (!said) throw new Error('the model did not answer with a reading: read it again');
    const byId = new Map((Array.isArray(said.scenes) ? said.scenes : []).map((s) => [String((s as { id?: unknown }).id), s as Record<string, unknown>]));
    const type = (said.type ?? {}) as Record<string, unknown>;
    const reading: Reading = {
      version: 1, kind: 'reference-reading', source: asset, name, from: 'video', duration: r3(duration), width, height,
      ...(music ? { ...(music.tempo ? { tempo: music.tempo } : {}), beats: music.beats.map(r3), bars: music.bars.map(r3) } : {}),
      scenes: measured.map((s, j) => sceneFrom(s, byId.get(s.id), cameras[j])),
      palette,
      type: {
        description: typeof type.description === 'string' && type.description.trim() ? type.description.trim().slice(0, 300) : 'unread',
        ...(typeof type.serif === 'boolean' ? { serif: type.serif } : {}),
        ...(['light', 'regular', 'medium', 'bold', 'heavy'].includes(type.weight as string) ? { weight: type.weight as 'bold' } : {}),
        ...(['upper', 'lower', 'mixed'].includes(type.case as string) ? { case: type.case as 'upper' } : {}),
      },
      texts: (Array.isArray(said.texts) ? said.texts : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.slice(0, 300)).slice(0, 200),
    };
    return { reading, stills, strips };
  } finally {
    src.dispose();
  }
}

interface Input { asset?: string; url?: string }

const readReference: ToolType<Input> = {
  name: 'read-reference', title: 'Read a reference',
  description: 'reads how a reference the user gave (a video, a gif or a Lottie) is made — its scenes, cuts on the music, the slots where content sits, the moves, transitions, palette and type — saves the reading, proposes the user\'s assets for its slots and shows it to the user as an outline; the film is then made the same way around the user\'s assets',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: ['video', 'image', 'json'], title: 'Reference', description: 'the video, gif or Lottie to read; the project\'s reference by default' },
      url: { type: 'string', title: 'Link', description: 'instead of an asset: a link to the file itself (a video, a gif or a Lottie), kept in the project as the reference' },
    },
  },
  ai: {
    when: 'the user gives a video, a gif or a Lottie to make "the same video" with their content (/remake): read it first, then write the film plan with its reading (film-plan with reference), build each scene at the reading\'s layout and timing with the user\'s assets in its slots, then critique',
    avoid: 'showing the reference or any of its words, logos or pictures in the film; reading it again when nothing changed',
  },
  async run({ asset: wanted, url: link }, ctx) {
    const linked = link ? await fromLink(ctx, link) : null;
    const refs = Object.entries(ctx.doc.assets).filter(([, a]) => a.reference).map(([id]) => id);
    const asset = linked?.id ?? wanted ?? refs[0];
    if (!asset) throw new Error('name the reference to read: a video, a gif or a Lottie of the project (asset), or a link to its file (url)');
    const a = linked?.asset ?? ctx.doc.assets[asset];
    if (!a) throw new Error(`${asset}: no such asset`);
    const lottie = a.type === 'json';
    if (!(a.type === 'video' || lottie || (a.type === 'image' && /\.gif$/i.test(a.src)))) throw new Error(`${asset}: a reference is a video, a gif or a Lottie (this is ${a.type})`);
    // a reference is read, never shown: a layer that shows it must go first
    const shownBy = Object.entries(ctx.doc.compositions).flatMap(([cid, c]) => Object.entries(c.layers).filter(([, l]) => Object.values(l.props ?? {}).includes(asset)).map(([lid]) => `${cid}/${lid}`));
    if (shownBy.length) throw new Error(`${asset} is shown by ${shownBy.slice(0, 4).join(', ')}: a reference is read, never shown in the film; remove it from the timeline first`);
    const name = a.name ?? asset;
    let read: { reading: Reading; stills: string[]; strips: string[] };
    if (lottie) {
      const raw = linked?.text ?? await ctx.readText(a.src);
      let json: Record<string, unknown>;
      try { json = JSON.parse(raw ?? 'null'); } catch { json = {}; }
      if (!json || !Array.isArray((json as { layers?: unknown }).layers)) throw new Error(`${asset}: not a Lottie (no layers)`);
      read = { reading: readingFromLottie(json, asset, name), stills: [], strips: [] };
    } else read = await readVideo(ctx, { id: asset, url: linked?.url ?? ctx.assetUrl(asset), gif: a.type === 'image' }, name);
    let reading = read.reading;
    const nearest = await host.typefaces(reading.type.description).catch(() => [] as string[]);
    if (nearest.length) reading = { ...reading, type: { ...reading.type, nearest } };
    const assets = userAssets(ctx);
    const { missing: _, ...matched } = assignSlots(reading, assets);
    reading = matched;
    const issues = readingIssues(reading);
    if (issues.length) throw new Error(`the reading came out wrong: ${issues.slice(0, 4).join('; ')}. Read it again`);

    // the outline: the user corrects it or accepts it, unless readings are accepted in advance
    let accepted = host.accepted();
    if (!accepted) {
      const answer = await host.ask(reading, read.stills, assets);
      if (answer) { const { missing: __, ...again } = assignSlots(answer, assets); reading = { ...again, accepted: true }; accepted = true; }
    } else reading = { ...reading, accepted: true };
    const final = ReadingSchema.parse(reading);

    const path = await ctx.writeFile(readingPath(asset), JSON.stringify(final, null, 1));
    const id = readingId(asset), had = !!ctx.doc.assets[id];
    const ops: Op[] = [
      ...(linked ? [{ op: 'add' as const, path: pointer('assets', asset), value: linked.asset }] : a.reference ? [] : [{ op: 'add' as const, path: pointer('assets', asset, 'reference'), value: true }]),
      { op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name: `Reading · ${name}` } },
    ];
    const empty = final.scenes.flatMap((s) => s.slots.filter((sl) => sl.fill === 'missing').map((sl) => `${s.id}/${sl.id} (${sl.role})`));
    return {
      ops, reload: had ? [id] : [], label: t('reading.label', { name }),
      images: read.strips.slice(0, 12).map((url, i) => ({ url, caption: `${final.scenes[i]?.id ?? ''} of the reference` })),
      notice: accepted ? t('reading.done', { scenes: final.scenes.length }) : t('reading.declined'),
      text: [
        accepted ? `The reading of "${name}" is saved as asset "${id}" (${path}) and accepted.` : `The user did not accept the reading of "${name}" (saved as "${id}", not accepted): ask them what to change before making anything.`,
        readingText(final),
        final.type.nearest?.length ? `Nearest typefaces: ${final.type.nearest.join(', ')} (bring the first in with the typefaces tool).` : '',
        empty.length ? `Slots no asset of the user fits: ${empty.join(', ')}. Fill each, in this order: an asset the user adds (ask), a picture made by generate-image (behind its gate), or a plain type treatment; say which.` : '',
        `The reference's own words, kept only so the film never shows them: ${final.texts.length ? final.texts.map((x) => `"${x}"`).join(', ') : 'none seen'}.`,
        accepted ? `Next: write the film plan from it (film-plan with reference "${id}" and the user's idea), build each scene at its slots, timing and moves with the assets named, then critique: it checks the film against the reading.` : '',
      ].filter(Boolean).join('\n'),
    };
  },
};

/** the reading of a reference, read from the project; null when it has none or the file is not one */
export async function readingOf(ctx: Pick<ToolContext, 'readText' | 'doc'>, id: string): Promise<Reading | null> {
  const a = ctx.doc.assets[id];
  return a ? parseReading(await ctx.readText(a.src).catch(() => null)) : null;
}

export const READING_TOOLS: ToolType[] = [readReference as ToolType];
