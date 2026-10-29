// Pictures made at authoring time: a provider draws one (generate-image),
// the file lands in the project with what made it, and an image layer shows
// it. A tool of the editor's vocabulary: the assistant reaches it with
// use_tool, the user from the / menu. The model sees what was made — it
// judges the picture with its own eyes, and has it made again when it is off
// (docs/generation-roadmap.md). Takes: several pictures in one call, the user
// keeps one, the others are not saved. A picture can be made again from its
// record, changed from a reference (an asset, a frame of the video) with a
// mask, extended past its edges, and brought to the frame's size.

import { enlarge, type ToolContext, type ToolType } from '@tramme/core';
import { api, type ImageAsk, type MadeImage } from './api.ts';
import { alone, chooseAmong, payFor } from './confirm.ts';
import { FILM_PLAN_PATH, parsePlan } from './filmplan.ts';
import { clip } from './model.ts';
import { jpegOf } from './perception.ts';
import { cutoutBlob } from './removebg.ts';
import { prefs } from './settings.ts';
import { againOps, canvasOf, dataUrl, fitSide, keepMedia, placeMedia, recordOf } from './media.ts';
import { t } from './i18n/index.ts';

/** the proportions the providers take, named as Gemini does */
const RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:5', '3:2', '2:3', '4:3', '3:4', '1:1'] as const;
type Ratio = (typeof RATIOS)[number];
/** the providers that change an existing picture (the others draw from words only) */
export const CHANGERS = ['openai', 'gemini'];

/** the ratio closest to the composition's proportions */
export function ratioOf(w: number, h: number): Ratio {
  const r = w / h;
  let best: Ratio = '1:1', gap = Infinity;
  for (const c of RATIOS) {
    const [a, b] = c.split(':').map(Number);
    const d = Math.abs(Math.log(r / (a / b)));
    if (d < gap) { gap = d; best = c; }
  }
  return best;
}

/** a ratio's width over its height */
const valueOf = (r: string) => { const [a, b] = r.split(':').map(Number); return a / b; };

/** what the model and the user see of the picture: a small JPEG, the size of a still */
async function preview(blob: Blob, side = 768): Promise<string> {
  const img = await createImageBitmap(blob);
  try { return jpegOf(img, img.width, img.height, Math.min(1, side / img.width)); } finally { img.close(); }
}

// ── what a picture is made from ──────────────────────────────
/**
 * The words of a picture made again: what made it, and only the change asked
 * — the rest said to stay as it is, so the provider changes only that.
 */
export function againPrompt(before: string, change: string | undefined): string {
  const c = change?.trim();
  return c ? `${before}\n\nChange only this: ${c}. Keep everything else as it is: the composition, the subject, the palette, the light, the technique.` : before;
}

/** the project's colours, said to the provider so a picture comes back in them */
export function paletteWords(tokens: Record<string, { type: string; value: unknown }> | undefined): string {
  const hex = Object.entries(tokens ?? {}).filter(([, v]) => v.type === 'color' && /^#[0-9a-f]{6}$/i.test(String(v.value))).map(([k, v]) => `${k} ${String(v.value).toUpperCase()}`);
  return hex.length ? `The project's palette: ${hex.slice(0, 6).join(', ')} — keep to these colours.` : '';
}

/** where the style frames of a film are kept */
export const FRAMES_DIR = 'assets/frames/';

/** a bitmap of an image file, a project asset, a style frame or a still of the composition */
export async function bitmapOf(ctx: ToolContext, source: string, at: number): Promise<ImageBitmap> {
  if (source === 'frame') {
    const url = await ctx.renderStill(at);
    return createImageBitmap(await (await fetch(url)).blob());
  }
  // a file of the project under the frames (a style frame is a target, never an asset of the document)
  if (source.startsWith(FRAMES_DIR)) {
    const res = await fetch(ctx.fileUrl(source));
    if (!res.ok) throw new Error(`${source}: the style frame could not be read (HTTP ${res.status})`);
    return createImageBitmap(await res.blob());
  }
  const a = ctx.doc.assets[source];
  if (!a || a.type !== 'image') throw new Error(`${source}: an image asset of the project, or "frame" for a still of the composition, is expected`);
  const res = await fetch(ctx.assetUrl(source));
  if (!res.ok) throw new Error(`${source}: the picture could not be read (HTTP ${res.status})`);
  return createImageBitmap(await res.blob());
}

/**
 * Where a picture sits when extended to a wider (or taller) ratio: its size
 * kept, centred, the new canvas around it. The reference is what the
 * provider fills; the mask is opaque over the picture (kept) and transparent
 * around it (to fill).
 */
export function extension(w: number, h: number, ratio: string): { width: number; height: number; x: number; y: number } {
  const r = valueOf(ratio);
  const width = Math.round(Math.max(w, h * r)), height = Math.round(Math.max(h, w / r));
  return { width, height, x: Math.round((width - w) / 2), y: Math.round((height - h) / 2) };
}

/**
 * The reference and mask of a change, as data URLs: the picture (fitted), a
 * mask turned to the providers' sense (transparent where it may change) from
 * an asset whose white says what changes (or stays, `maskKeeps`), or the
 * extension's border when the picture is extended.
 */
export async function referenceOf(ctx: ToolContext, o: { source: string; at: number; mask?: string; maskKeeps?: boolean; extend?: string }): Promise<{ reference: string; mask?: string; size: [number, number] }> {
  const img = await bitmapOf(ctx, o.source, o.at);
  try {
    const k = fitSide(img.width, img.height);
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    if (o.extend) {
      const e = extension(w, h, o.extend), kk = fitSide(e.width, e.height);
      const ref = canvasOf(e.width * kk, e.height * kk), msk = canvasOf(e.width * kk, e.height * kk);
      ref.g.drawImage(img, e.x * kk, e.y * kk, w * kk, h * kk);
      msk.g.fillStyle = '#000'; msk.g.fillRect(e.x * kk, e.y * kk, w * kk, h * kk);
      return { reference: await dataUrl(ref.c), mask: await dataUrl(msk.c), size: [ref.c.width, ref.c.height] };
    }
    const ref = canvasOf(w, h);
    ref.g.drawImage(img, 0, 0, w, h);
    if (!o.mask) return { reference: await dataUrl(ref.c), size: [w, h] };
    const m = await bitmapOf(ctx, o.mask, o.at);
    try {
      const msk = canvasOf(w, h);
      msk.g.drawImage(m, 0, 0, w, h);
      const px = msk.g.getImageData(0, 0, w, h);
      for (let i = 0; i < px.data.length; i += 4) {
        // the mask's light (its alpha counted) says what changes, or what stays
        const light = ((px.data[i] + px.data[i + 1] + px.data[i + 2]) / 765) * (px.data[i + 3] / 255);
        const changes = o.maskKeeps ? light < 0.5 : light >= 0.5;
        px.data[i] = px.data[i + 1] = px.data[i + 2] = 0;
        px.data[i + 3] = changes ? 0 : 255;
      }
      msk.g.putImageData(px, 0, 0);
      return { reference: await dataUrl(ref.c), mask: await dataUrl(msk.c), size: [w, h] };
    } finally { m.close(); }
  } finally { img.close(); }
}

// ── the takes ────────────────────────────────────────────────
/** takes held for the assistant when nobody was there to choose: kept in memory for this session only, never saved */
const held = new Map<string, { made: MadeImage[]; extra: Record<string, unknown> }>();

/** pictures drawn by a provider, paid for first: the user's yes or the turn's allowance, each one counted (a tool's `paid` says what it costs and what to do instead) */
export async function drawTakes(ctx: ToolContext, ask: ImageAsk, paid: { what: string; instead: string }): Promise<MadeImage[]> {
  await payFor(t('image.paidTitle'), paid.what, t('image.paidYes'), paid.instead, ask.n ?? 1);
  return api.generateImages(ask, ctx.signal);
}

/** takes held for this session with what the tool needs to keep one later; the id to keep them by */
export function holdTakes(made: MadeImage[], extra: Record<string, unknown>): string {
  const id = `takes-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  held.set(id, { made, extra });
  return id;
}

/**
 * Takes held: "takes-…:n" gives that take alone and lets them all go; the bare
 * id gives them all and keeps them. Null when nothing is held under it.
 */
export function takeHeld(id: string): { made: MadeImage[]; extra: Record<string, unknown>; take?: number } | null {
  const [key, n] = id.split(':'), h = held.get(key);
  if (!h) return null;
  if (n === undefined) return h;
  const pick = h.made[Number(n) - 1];
  if (!pick) return null;
  held.delete(key);
  return { made: [pick], extra: h.extra, take: Number(n) };
}

/** the takes side by side as small pictures, for the user to choose from and the model to judge */
export const takeSheet = (made: MadeImage[], size = 512): Promise<string[]> => Promise.all(made.map((m) => preview(m.blob, size)));

/** what generate-image keeps with the takes it holds */
interface HeldTake { label: string; record: Record<string, unknown>; again?: string; fit: 'cover' | 'contain'; at: number; duration?: number; background: boolean; object?: boolean }

/** what an object is asked for: one subject on a flat ground, so its matte is clean */
const OBJECT_ASK = 'A single object, whole and centred, on a plain flat ground of one colour, soft even light, nothing else in the frame, no text, no shadow on the ground.';
const IN_STYLE = 'Draw it in the style of the reference picture: its rendering, light and palette, not its content.';
/** the share of the picture an object's cutout keeps, outside which the cutout looks wrong */
const CUT_RANGE = [0.03, 0.92] as const;
/** an object is placed whole in a box of this share of the frame's shorter side */
const OBJECT_SHARE = 0.6;

type Input = {
  prompt?: string; name?: string; ratio?: Ratio | 'auto'; quality?: 'low' | 'medium' | 'high'; provider?: string; fit?: 'cover' | 'contain';
  at?: number; duration?: number; background?: boolean; takes?: number; keep?: string;
  again?: string; change?: string; object?: boolean; reference?: string; mask?: string; maskKeeps?: boolean; extend?: Ratio; upscale?: boolean;
};

const generateImage: ToolType<Input> = {
  name: 'generate-image', title: 'Have a picture made', description: "has a provider draw a picture (the server's keys), saves it in the project with what made it and places it as an image layer; answers with the picture. Takes several to choose from, makes a picture again changing only what is asked, changes a reference picture (a mask says where) or extends it past its edges",
  input: {
    type: 'object',
    properties: {
      prompt: { type: 'string', title: 'Prompt', description: 'what the picture shows, and how it is drawn: technique, palette, mood ("flat vector illustration of a lighthouse at dusk, muted blues and warm sand, lots of quiet sky", "seamless paper texture, soft light"). The words of the video go in text layers, never in the picture' },
      name: { type: 'string', title: 'Name', description: 'of the file, lower case; the same name makes the picture again' },
      ratio: { enum: ['auto', ...RATIOS], title: 'Proportions', description: "auto: the composition's" },
      quality: { enum: ['low', 'medium', 'high'], title: 'Quality', description: 'low costs less: a draft, a texture; high: a picture that stays on screen (the Pictures settings by default)' },
      provider: { enum: ['openai', 'gemini', 'zai', 'hydracept'], title: 'Provider', description: 'the Pictures settings\' by default, else the first one the server has a key for; OpenAI and Gemini alone change an existing picture' },
      fit: { enum: ['cover', 'contain'], title: 'Fit', description: 'cover: fills the frame, cropped to it (a background); contain: shown whole, bands around it (a prop, a logo)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: '0 by default: the whole composition (and the frame a reference reads)' },
      duration: { type: 'number', minimum: 0.1, title: 'Length (s)', description: 'to the end of the composition by default' },
      background: { type: 'boolean', title: 'In the background', description: 'under the other layers' },
      takes: { type: 'integer', minimum: 1, maximum: 4, title: 'Takes', description: 'several pictures of the same ask (each one paid), side by side: the user keeps one, the others are not saved' },
      keep: { type: 'string', title: 'Keep a take', description: 'a take held from an earlier call ("takes-…:2"), kept without drawing again' },
      again: { type: 'string', format: 'asset', assetType: 'image', title: 'Make again', description: 'a picture made before: its record gives the prompt, the provider and the proportions; only the change asked moves' },
      change: { type: 'string', title: 'Change', description: 'with again or a reference: what changes ("night instead of dusk", "a red door"); the rest stays' },
      reference: { type: 'string', title: 'Reference', description: 'an image asset, or "frame" for a still of the composition at the start: the provider keeps what matters and changes the rest, the project\'s palette sent along' },
      mask: { type: 'string', format: 'asset', assetType: 'image', title: 'Mask', description: 'with a reference: a picture whose white says what changes (the cutout tool makes some)' },
      maskKeeps: { type: 'boolean', title: 'The mask keeps', description: 'the mask\'s white is what stays, not what changes' },
      extend: { enum: [...RATIOS], title: 'Extend to', description: 'with a reference or again: the picture extended past its edges to these proportions, the new border drawn to match' },
      object: { type: 'boolean', title: 'An object', description: 'one object or illustration on a flat ground, then cut out: a transparent picture placed whole at 60 % of the frame, in the style of the film\'s target when it has one; never a background' },
      upscale: { type: 'boolean', title: 'Bring to the frame', description: 'a picture smaller than the composition enlarged to its size before it is placed (the upscale tool\'s enlargement)' },
    },
  },
  ai: {
    when: "the project has no picture for what a shot needs: a background a title reads over, a texture, an illustration in the project's colours, a prop. An object or an illustration a noun of the script stands for (a dish, a house with its price, a phone) is made with object and placed whole, one object per idea. Describe it as drawn (technique, palette, mood) and keep quiet what the text layers will say. Takes (2 to 4) when the look is open and the user should pick; again + change to fix one thing; reference to restyle a frame of the video or an asset; extend for a wider format",
    avoid: 'words in the picture (they come out crooked, and text layers can translate them); the face of a real person; a brand logo. It costs money: one picture per need, at low quality while searching, high once it is right; takes only when the choice is the user\'s',
    example: { prompt: 'flat vector illustration of a coastal road at dusk, muted blues and warm sand, large quiet sky over the sea, no text', name: 'road-dusk', background: true },
  },
  async run(a, ctx) {
    const p = prefs.peek(), c = ctx.doc.compositions[ctx.compId];
    if (a.object && a.background) throw new Error('an object is never a background: place it whole over the other layers (or draw a background without object)');
    const fit = a.object ? 'contain' : a.fit ?? 'cover', at = a.at ?? 0, background = a.background ?? false;
    // a take held from an earlier call: kept now, nothing drawn again
    if (a.keep) {
      const h = takeHeld(a.keep);
      if (!h?.take) throw new Error(`no take "${a.keep}" is held: takes are held for this session only — have them made again`);
      const x = h.extra as unknown as HeldTake;
      return keepAndPlace(ctx, h.made[0], x.label, { ...x.record, take: h.take }, { again: x.again, fit: x.fit, at: x.at, duration: x.duration, background: x.background, object: x.object, upscale: a.upscale });
    }
    // what it is made from: a record made before, a reference, or words alone
    const before = a.again ? await recordOf(ctx, 'image', a.again) : null;
    if (a.again && !ctx.doc.assets[a.again]) throw new Error(`${a.again}: no such picture in the project`);
    const words = a.prompt?.trim() || (before?.prompt ? String(before.prompt) : '');
    if (!words) throw new Error('say what to draw (prompt), or name a picture made before to make again (again)');
    const provider = a.provider ?? (before?.provider ? String(before.provider) : undefined) ?? (p.pictureProvider !== 'auto' ? p.pictureProvider : undefined);
    // an object is drawn in the style of the film's target, when the plan has one and the provider can work from a picture
    const styled = a.object && !a.reference && !a.again && (!provider || CHANGERS.includes(provider)) ? parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null))?.target : undefined;
    const source = a.reference ?? (a.again && (a.change || a.extend) ? a.again : undefined) ?? styled;
    if (source && provider && !CHANGERS.includes(provider)) throw new Error(`${provider} draws from words only: change a picture with OpenAI or Gemini (provider), or describe the whole picture again`);
    const ratio = a.extend ?? (a.ratio && a.ratio !== 'auto' ? a.ratio : before?.ratio ? String(before.ratio) as Ratio : ratioOf(c.width, c.height));
    const palette = source ? paletteWords(ctx.doc.tokens as never) : '';
    const prompt = [a.again ? againPrompt(words, a.change) : a.change && source ? `${words}\n\nChange this: ${a.change}. Keep what matters of the picture given.` : words,
      a.extend ? 'Extend the picture past its edges into the empty border, seamlessly: the same scene, style, light and grain; nothing new in the middle.' : '', palette, styled ? IN_STYLE : '', a.object ? OBJECT_ASK : ''].filter(Boolean).join('\n\n');
    const takes = Math.max(1, Math.min(4, Math.round(a.takes ?? 1)));
    const quality = a.quality ?? (before?.quality ? String(before.quality) as Input['quality'] : undefined) ?? (p.pictureQuality !== 'auto' ? p.pictureQuality : undefined);
    // the reference is read first: a picture that cannot be read costs nothing
    const ref = source ? await referenceOf(ctx, { source, at, mask: a.mask, maskKeeps: a.maskKeeps, extend: a.extend }) : null;
    const ask: ImageAsk = { prompt, ratio, quality, provider, size: p.pictureSize === 'small' ? 'small' : undefined, n: takes, ...(ref ? { reference: ref.reference, ...(ref.mask ? { mask: ref.mask } : {}) } : {}) };
    // it costs money: the user says yes first, or the turn's allowance does (as for the sounds), each take counted
    const made = await drawTakes(ctx, ask, { what: takes > 1 ? t('image.paidTakes', { n: takes, prompt: clip(words, 140) }) : t('image.paidText', { prompt: clip(words, 140) }), instead: 'ask the user for a picture instead' });
    const label = a.again ? String(ctx.doc.assets[a.again].name ?? a.again.replace(/^image-/, '')) : a.name ?? words.toLowerCase().split(/\s+/).slice(0, 4).join('-');
    const record: Record<string, unknown> = {
      prompt: words, provider: made[0].provider, model: made[0].model, ratio, ...(quality ? { quality } : {}),
      ...(a.again ? { again: a.again, ...(a.change ? { change: a.change } : {}) } : {}),
      ...(source ? { reference: source === 'frame' ? `frame at ${at} s` : source, ...(a.mask ? { mask: a.mask } : {}), ...(a.extend ? { extend: a.extend } : {}) } : {}),
      ...(before ? { before: { ...before, before: undefined } } : {}),
    };
    const o = { again: a.again, fit, at, duration: a.duration, background, object: a.object, upscale: a.upscale };
    if (made.length === 1) return keepAndPlace(ctx, made[0], label, record, o);
    // several takes: a contact sheet, the user keeps one; alone, the assistant is handed the choice
    const sheet = await takeSheet(made);
    const choices = sheet.map((url, i) => ({ url, label: t('image.take', { n: i + 1 }) }));
    const picked = await chooseAmong(t('image.takesTitle'), t('image.takesText', { n: made.length, name: label }), choices);
    if (picked !== null) return keepAndPlace(ctx, made[picked], label, { ...record, take: picked + 1, takes: made.length }, o);
    if (!alone()) return { ops: [], text: `The user kept none of the ${made.length} takes of "${label}": nothing was saved. Ask what to change before drawing again.`, images: sheet.map((url, i) => ({ url, caption: `take ${i + 1}` })) };
    const id = holdTakes(made, { label, record: { ...record, takes: made.length }, again: a.again, fit, at, duration: a.duration, background, object: a.object } satisfies HeldTake);
    return {
      ops: [], label: `Takes of ${label}`,
      text: `${made.length} takes of "${label}" by ${made[0].provider}, held for this session (none saved). Look at them and keep the best one with generate-image { keep: "${id}:<n>" } — it costs nothing more.`,
      images: sheet.map((url, i) => ({ url, caption: `${id}:${i + 1}` })),
    };
  },
};

/** the picture kept (in place of the one made again, or as a new layer), brought to the frame's size when asked */
async function keepAndPlace(ctx: ToolContext, made: MadeImage, label: string, record: Record<string, unknown>, o: { again?: string; fit: 'cover' | 'contain'; at: number; duration?: number; background: boolean; object?: boolean; upscale?: boolean }) {
  const c = ctx.doc.compositions[ctx.compId];
  let blob = made.blob, grown = '', wrong = '';
  // an object: its ground cut away, a transparent picture; a cutout that kept almost nothing or almost everything is kept for the user to judge
  if (o.object) {
    const cut = await cutoutBlob(blob, 'any', ctx.progress);
    blob = cut.blob; record = { ...record, object: true, kept: +cut.kept.toFixed(3) };
    if (cut.kept < CUT_RANGE[0] || cut.kept > CUT_RANGE[1]) wrong = ` The cutout looks wrong: it kept ${Math.round(cut.kept * 100)} % of the picture. Make it again (a plainer ground, one subject), or judge it from the picture.`;
  }
  if (o.upscale) {
    const up = await upscaleBlob(blob, c.width, c.height, o.fit);
    if (up) { blob = up.blob; grown = ` Brought to ${up.width}×${up.height} for the frame.`; record = { ...record, upscaled: [up.width, up.height] }; }
  }
  // made again: the same asset, its layers showing the new picture; else a new asset and its layer
  const kept = await keepMedia(ctx, 'image', o.again ? String(ctx.doc.assets[o.again].src).split('/').pop()!.replace(/\.[a-z0-9]+$/i, '') : label, blob, record);
  const again = o.again ? againOps(ctx, o.again, kept) : null;
  const placed = o.again ? null : placeMedia(ctx, 'image', kept.asset, label, { fit: o.fit, at: o.at, out: Math.min(c.duration, o.at + (o.duration ?? c.duration)), background: o.background, ...(o.object ? { size: [Math.round(Math.min(c.width, c.height) * OBJECT_SHARE), Math.round(Math.min(c.width, c.height) * OBJECT_SHARE)] as [number, number] } : {}) });
  const ops = o.again ? again! : [...kept.ops, ...placed!.ops];
  return {
    ops, reload: o.again ? [o.again] : kept.reload, label: `Picture ${label}`,
    text: `Picture made by ${made.provider} (${made.model}, ${String(record.ratio)}), saved as asset ${o.again ?? kept.asset} with its record${o.again ? ' — made again in place: every layer showing it shows the new one' : `; layer ${placed!.layer}${o.background ? ' in the background' : ''} from ${o.at.toFixed(2)} s`}.${grown}${wrong} You see it: judge it (a background stays quiet under the titles) and have it made again with a sharper prompt, or again + change, when it is off.`,
    images: [{ url: await preview(blob), caption: `${label} · ${made.provider}` }],
    notice: t('image.made', { name: label, provider: made.provider, model: made.model }),
  };
}

// ── the upscale ──────────────────────────────────────────────
/**
 * How many times a picture is enlarged for a frame (the upscale tool's
 * Lanczos, a whole factor): cover fills the frame, contain shows it whole;
 * null when it is already big enough. Four times at most.
 */
export function upscaleFactor(w: number, h: number, fw: number, fh: number, fit: 'cover' | 'contain' = 'cover'): number | null {
  const k = fit === 'cover' ? Math.max(fw / w, fh / h) : Math.min(fw / w, fh / h);
  return k <= 1.01 ? null : Math.min(4, Math.ceil(k - 0.01));
}

/** a picture enlarged for a frame by the upscale tool's own enlargement (core's enlarge); null when it is big enough */
async function upscaleBlob(blob: Blob, fw: number, fh: number, fit: 'cover' | 'contain'): Promise<{ blob: Blob; width: number; height: number } | null> {
  const img = await createImageBitmap(blob);
  try {
    const k = upscaleFactor(img.width, img.height, fw, fh, fit);
    if (!k) return null;
    const src = canvasOf(img.width, img.height);
    src.g.drawImage(img, 0, 0);
    const px = src.g.getImageData(0, 0, img.width, img.height);
    const big = enlarge({ width: px.width, height: px.height, data: px.data }, k);
    const out = canvasOf(big.width, big.height);
    out.g.putImageData(new ImageData(new Uint8ClampedArray(big.data), big.width, big.height), 0, 0);
    return { blob: await out.c.convertToBlob({ type: 'image/png' }), width: big.width, height: big.height };
  } finally { img.close(); }
}

export const IMAGE_TOOLS: ToolType[] = [generateImage];
