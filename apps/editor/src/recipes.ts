// Recipes: tools that lay out a whole animated piece in one move (kinetic
// title, bar chart, rolling figure, transition) as ordinary layers and
// keyframes, editable afterwards. They read the style kit's tokens (plate,
// ink, accent, enter, exit, pace, stagger) so a film keeps one motion
// language; the kit tool applies a kit. All of it is a tool of the editor's
// vocabulary: the assistant runs it (use_tool), the user too (/ menu).

import type { EaseSpec, KitType, Op, ToolContext, ToolType, TrammeDoc, Vec2 } from '@tramme/core';
import { pointer } from '@tramme/core';
import { adder } from './templates.ts';
import { clip, isToolAsset, mediaAssetsOf } from './model.ts';

// ── the look of the document ─────────────────────────────────
type Bezier = [number, number, number, number];
const ENTER: Bezier = [0.16, 1, 0.3, 1], EXIT: Bezier = [0.7, 0, 0.84, 0], POP: Bezier = [0.34, 1.56, 0.64, 1];
const STANDARD: Bezier = [0.4, 0, 0.2, 1], EMPHASIZED: Bezier = [0.2, 0, 0, 1];

/** a token when the document has one of that type, a fallback otherwise */
export function style(doc: TrammeDoc) {
  const has = (n: string, type: string) => doc.tokens?.[n]?.type === type;
  const num = (n: string, d: number) => (has(n, 'number') ? Number(doc.tokens[n].value) || d : d);
  const firstColor = Object.entries(doc.tokens ?? {}).find(([n, t]) => t.type === 'color' && !/plate|bg|back|ink|night|paper/i.test(n))?.[0];
  return {
    accent: has('accent', 'color') ? '@accent' : firstColor ? `@${firstColor}` : '#2EC4B6',
    accent2: has('accent2', 'color') ? '@accent2' : has('accent', 'color') ? '@accent' : '#F4B860',
    ink: has('ink', 'color') ? '@ink' : '#FFFFFF',
    enter: (has('enter', 'ease') ? '@enter' : ENTER) as EaseSpec,
    exit: (has('exit', 'ease') ? '@exit' : EXIT) as EaseSpec,
    standard: (has('standard', 'ease') ? '@standard' : STANDARD) as EaseSpec,
    emphasized: (has('emphasized', 'ease') ? '@emphasized' : EMPHASIZED) as EaseSpec,
    pace: num('pace', 0.6),
    stagger: num('stagger', 0.06),
    font: Object.entries(doc.assets).find(([, a]) => a.type === 'font')?.[0] ?? null,
  };
}

/** the width of a text, measured with the document's font when a canvas is there, estimated otherwise */
export function measure(doc: TrammeDoc, text: string, size: number, weight: number, font: string | null): number {
  try {
    const g = document.createElement('canvas').getContext('2d')!;
    const family = font ? doc.assets[font]?.family || font : 'sans-serif';
    g.font = `${weight} ${size}px "${family}", sans-serif`;
    return g.measureText(text).width;
  } catch { return text.length * size * (weight >= 700 ? 0.64 : 0.56); }
}

/** the width of a counter: digits in equal cells (the widest digit), other signs at their own width, as the node draws it */
export function counterWidth(doc: TrammeDoc, text: string, size: number, weight: number, font: string | null): number {
  const cell = Math.max(...'0123456789'.split('').map((d) => measure(doc, d, size, weight, font)));
  return [...text].reduce((w, ch) => w + (/\d/.test(ch) ? cell : measure(doc, ch, size, weight, font)), 0);
}

export const r = (x: number) => Math.round(x * 100) / 100;

/**
 * The opacity of an entrance from t0 to t1, held, then the shared fade out
 * (the 0.35 s before end). When time is short (a slow kit, a brief piece) the
 * entrance is squeezed before the fade: keys out of order are refused.
 */
export function enterThenOut(s: { enter: EaseSpec; exit: EaseSpec }, t0: number, t1: number, end: number) {
  const out = r(end - 0.35), b = Math.min(r(t1), out), a = Math.min(r(t0), b);
  return { $k: [{ t: a, v: 0, ease: s.enter }, { t: b, v: 1 }, { t: out, v: 1, ease: s.exit }, { t: end, v: 0 }] };
}
export const compOf = (ctx: ToolContext) => ctx.doc.compositions[ctx.compId];
const atOf = (ctx: ToolContext, at?: number) => r(at ?? ctx.time);

// ── kinetic title ────────────────────────────────────────────
interface TitleArgs { text: string; at?: number; duration?: number; style?: 'rise' | 'pop' | 'slide' | 'blur'; place?: 'top' | 'center' | 'bottom'; emphasis?: number; size?: number }

const kineticTitle: ToolType<TitleArgs> = {
  name: 'kinetic-title', title: 'Kinetic title', description: 'a title whose words enter one after the other (rise, pop, slide or blur), one word in the accent colour',
  input: {
    type: 'object',
    properties: {
      text: { type: 'string', title: 'Text' },
      style: { enum: ['rise', 'pop', 'slide', 'blur'], title: 'Style' },
      emphasis: { type: 'integer', minimum: 1, title: 'Word in colour', description: 'its rank in the title (1: the first)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 0.5, title: 'Duration (s)' },
      place: { enum: ['top', 'center', 'bottom'], title: 'Place' },
      size: { type: 'number', minimum: 8, title: 'Size (px)' },
    },
    required: ['text'],
  },
  ai: { when: 'titles and key phrases that deserve energy: rise for a calm tone, pop for a punchy one, blur for a cinematic one; 2 to 7 words', avoid: 'whole sentences of more than 10 words' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 3));
    const u = Math.min(c.width, c.height), size = a.size ?? Math.round(u * (c.height > c.width ? 0.1 : 0.085)), weight = 800;
    const words = a.text.split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error('kinetic-title: text is empty');
    // lines within 84 % of the width
    const space = measure(doc, ' ', size, weight, s.font), max = c.width * 0.84;
    const lines: { word: string; w: number; i: number }[][] = [[]];
    let lineW = 0;
    words.forEach((word, i) => {
      const w = measure(doc, word, size, weight, s.font);
      if (lines.at(-1)!.length && lineW + space + w > max) { lines.push([]); lineW = 0; }
      lineW += (lines.at(-1)!.length ? space : 0) + w;
      lines.at(-1)!.push({ word, w, i });
    });
    const lh = size * 1.12, y = a.place === 'top' ? c.height * 0.22 : a.place === 'bottom' ? c.height * 0.74 : c.height * 0.48;
    const { add, done } = adder(doc, ctx.compId);
    const children: string[] = [];
    const kind = a.style ?? 'rise';
    lines.forEach((line, li) => {
      const total = line.reduce((t, x, k) => t + x.w + (k ? space : 0), 0);
      let x = -total / 2;
      for (const { word, w, i } of line) {
        const t0 = r(at + i * s.stagger), t1 = r(t0 + s.pace), cx = r(x + w / 2), cy = r(li * lh - ((lines.length - 1) * lh) / 2);
        const pos: Vec2 = [cx, cy];
        const transform: Record<string, unknown> = {
          anchor: [r(w / 2), 0],
          opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.6), v: 1 }] },
        };
        const effects: unknown[] = [];
        if (kind === 'rise') transform.position = { $k: [{ t: t0, v: [cx, r(cy + size * 0.55)], ease: s.enter }, { t: t1, v: pos }] };
        else if (kind === 'slide') transform.position = { $k: [{ t: t0, v: [r(cx - size * 0.6), cy], ease: s.enter }, { t: t1, v: pos }] };
        else transform.position = pos;
        if (kind === 'pop') transform.scale = { $k: [{ t: t0, v: [0.45, 0.45], ease: POP }, { t: t1, v: [1, 1] }] };
        if (kind === 'blur') effects.push({ id: 'blur', type: 'fx.blur', props: { radius: { $k: [{ t: t0, v: Math.round(size * 0.25), ease: s.enter }, { t: r(t1 + 0.1), v: 0 }] } } });
        children.push(add(`word-${i + 1}`, {
          type: 'text', name: word, transform, ...(effects.length ? { effects } : {}),
          props: { text: word, size, weight, align: 'left', baseline: 'middle', tracking: -0.01, color: a.emphasis === i + 1 ? s.accent : s.ink, ...(s.font ? { font: s.font } : {}) },
        }, false));
        x += w + space;
      }
    });
    // the whole title leaves together
    add('kinetic-title', {
      type: 'group', name: clip(a.text, 39), in: at, out: end,
      transform: { position: [r(c.width / 2), r(y)], opacity: { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } },
      children,
    });
    return { ops: done(), label: `Kinetic title "${a.text}"`, text: `Kinetic title (${kind}), ${words.length} word(s) on ${lines.length} line(s), from ${at} to ${end} s.` };
  },
};

// ── bar chart ────────────────────────────────────────────────
/** "Label: 12, Other: 30" or "12, 30, 45" */
export function parseData(data: string): { label: string; value: number }[] {
  return data.split(/[,;\n]/).map((part, i) => {
    const m = /^\s*(?:(.*?)\s*[:=]\s*)?(-?\d+(?:[.,]\d+)?)\s*$/.exec(part);
    return m ? { label: (m[1] ?? '').trim() || String(i + 1), value: Number(m[2].replace(',', '.')) } : null;
  }).filter((x): x is { label: string; value: number } => !!x && Number.isFinite(x.value));
}

interface ChartArgs { data: string; title?: string; unit?: string; at?: number; duration?: number }

const barChart: ToolType<ChartArgs> = {
  name: 'bar-chart', title: 'Bar chart', description: 'animated bars that grow one after the other, with their values rolling up and their labels',
  input: {
    type: 'object',
    properties: {
      data: { type: 'string', title: 'Data', description: '"Label: value" separated by commas, e.g. "2022: 12, 2023: 30, 2024: 45"' },
      title: { type: 'string', title: 'Title' },
      unit: { type: 'string', title: 'Unit', description: 'after each value, e.g. "%" or " k€"' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
    required: ['data'],
  },
  ai: { when: 'comparing 2 to 8 values; the highest bar in the accent colour draws the eye', avoid: 'more than 8 bars, or values that need decimals to differ' },
  run(a, ctx) {
    const rows = parseData(a.data);
    if (rows.length < 1) throw new Error('bar-chart: no value in data (expected "Label: 12, Other: 30")');
    if (rows.length > 12) throw new Error('bar-chart: 12 bars at most');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 5));
    const u = Math.min(c.width, c.height), top = Math.max(...rows.map((x) => x.value), 1e-9);
    const boxW = c.width * 0.8, boxH = c.height * (c.height > c.width ? 0.36 : 0.46), base = r(c.height * (a.title ? 0.74 : 0.7));
    const slot = boxW / rows.length, bw = r(slot * 0.62), labelSize = Math.round(u * 0.034), valueSize = Math.round(u * 0.052);
    const { add, done } = adder(doc, ctx.compId);
    const fadeOut = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    if (a.title) add('chart-title', { type: 'text', name: a.title, in: at, out: end, transform: { position: { $k: [{ t: at, v: [r(c.width / 2), r(base - boxH - u * 0.1 + u * 0.03)], ease: s.enter }, { t: r(at + s.pace), v: [r(c.width / 2), r(base - boxH - u * 0.1)] }] }, opacity: { $k: [{ t: at, v: 0, ease: s.enter }, { t: r(at + s.pace), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: a.title, size: Math.round(u * 0.055), weight: 800, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    add('chart-axis', { type: 'shape.rect', name: 'Axis', in: at, out: end, transform: { position: [r(c.width / 2), base], scale: { $k: [{ t: at, v: [0, 1], ease: s.enter }, { t: r(at + s.pace), v: [1, 1] }] }, opacity: fadeOut }, props: { size: [r(boxW), Math.max(2, Math.round(u * 0.004))], fill: s.ink } });
    const best = rows.reduce((b, x, i) => (x.value > rows[b].value ? i : b), 0);
    rows.forEach((row, i) => {
      const x = r(c.width / 2 - boxW / 2 + slot * (i + 0.5)), h = r(Math.max(2, (Math.max(0, row.value) / top) * boxH));
      const t0 = r(at + 0.2 + i * Math.max(s.stagger, 0.08)), t1 = r(t0 + s.pace * 1.6);
      add(`bar-${i + 1}`, { type: 'shape.rect', name: `${row.label} · bar`, in: at, out: end, transform: { anchor: [0, r(h / 2)], position: [x, base], scale: { $k: [{ t: t0, v: [1, 0], ease: s.enter }, { t: t1, v: [1, 1] }] }, opacity: fadeOut }, props: { size: [bw, h], radius: Math.round(bw * 0.08), fill: i === best ? s.accent : s.ink } });
      const shown = `${Number.isInteger(row.value) ? row.value : row.value.toFixed(1)}`;
      add(`bar-value-${i + 1}`, { type: 'text.counter', name: `${row.label} · value`, in: t0, out: end, transform: { position: { $k: [{ t: t0, v: [x, r(base - u * 0.02)], ease: s.enter }, { t: t1, v: [x, r(base - h - u * 0.025)] }] }, opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + 0.2), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { from: shown.replace(/\d/g, '0'), to: shown, progress: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: t1, v: 1 }] }, turns: 0, size: valueSize, weight: 800, align: 'center', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
      if (a.unit) add(`bar-unit-${i + 1}`, { type: 'text', name: `${row.label} · unit`, in: t1, out: end, transform: { position: [r(x + counterWidth(doc, shown, valueSize, 800, s.font) / 2 + valueSize * 0.08), r(base - h - u * 0.025)], opacity: { $k: [{ t: t1, v: 0, ease: s.enter }, { t: r(t1 + 0.25), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: a.unit, size: Math.round(valueSize * 0.7), weight: 600, align: 'left', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
      add(`bar-label-${i + 1}`, { type: 'text', name: `${row.label} · label`, in: at, out: end, transform: { position: [x, r(base + labelSize * 1.4)], opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: row.label, size: labelSize, weight: 500, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    });
    return { ops: done(), label: `Bar chart${a.title ? ` "${a.title}"` : ''}`, text: `Bar chart of ${rows.length} value(s) (highest: ${rows[best].label}, in the accent colour), from ${at} to ${end} s.` };
  },
};

// ── a figure that rolls up ───────────────────────────────────
interface StatArgs { value: string; label?: string; at?: number; duration?: number; place?: 'top' | 'center' | 'bottom' }

const stat: ToolType<StatArgs> = {
  name: 'stat', title: 'Key figure', description: 'a big number rolling up like a counter, with a line of text below it',
  input: {
    type: 'object',
    properties: {
      value: { type: 'string', title: 'Value', description: 'as shown, e.g. "1,250", "98%", "$3.2M"' },
      label: { type: 'string', title: 'Label' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
      place: { enum: ['top', 'center', 'bottom'], title: 'Place' },
    },
    required: ['value'],
  },
  ai: { when: 'one striking number said in the voice-over or the key result of a story' },
  run(a, ctx) {
    if (!/\d/.test(a.value)) throw new Error('stat: the value needs digits');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 3));
    const u = Math.min(c.width, c.height), size = Math.round(u * 0.22), y = a.place === 'top' ? c.height * 0.3 : a.place === 'bottom' ? c.height * 0.66 : c.height * 0.46;
    const roll = r(Math.max(0.9, s.pace * 2.2));
    const { add, done } = adder(doc, ctx.compId);
    const fade = (t0: number) => enterThenOut(s, t0, t0 + s.pace * 0.6, end);
    add('stat-value', { type: 'text.counter', name: a.value, in: at, out: end, transform: { position: { $k: [{ t: at, v: [r(c.width / 2), r(y + size * 0.15)], ease: s.enter }, { t: r(at + s.pace), v: [r(c.width / 2), r(y)] }] }, opacity: fade(at) }, props: { from: a.value.replace(/\d/g, '0'), to: a.value, progress: { $k: [{ t: at, v: 0, ease: s.enter }, { t: r(at + roll), v: 1 }] }, turns: 1, size, weight: 900, align: 'center', color: s.accent, ...(s.font ? { font: s.font } : {}) } });
    if (a.label) add('stat-label', { type: 'text', name: a.label, in: at, out: end, transform: { position: { $k: [{ t: r(at + roll * 0.6), v: [r(c.width / 2), r(y + size * 0.42)], ease: s.enter }, { t: r(at + roll * 0.6 + s.pace), v: [r(c.width / 2), r(y + size * 0.36)] }] }, opacity: fade(r(at + roll * 0.6)) }, props: { text: a.label, size: Math.round(u * 0.05), weight: 600, align: 'center', baseline: 'top', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    return { ops: done(), label: `Key figure ${a.value}`, text: `Key figure ${a.value} rolling up from ${at} s for ${roll} s, on screen until ${end} s.` };
  },
};

// ── transition ───────────────────────────────────────────────
interface TransitionArgs { at?: number; style?: 'wipe' | 'circle' | 'bars' | 'flash'; duration?: number }

const transition: ToolType<TransitionArgs> = {
  name: 'transition', title: 'Transition', description: 'a shape that covers the frame at a cut and uncovers the next scene: wipe, circle, bars or flash',
  input: {
    type: 'object',
    properties: {
      at: { type: 'number', minimum: 0, title: 'Cut (s)', description: 'the moment the frame is fully covered' },
      style: { enum: ['wipe', 'circle', 'bars', 'flash'], title: 'Style' },
      duration: { type: 'number', minimum: 0.2, maximum: 3, title: 'Duration (s)' },
    },
  },
  ai: { when: 'between two scenes or sections; place the cut of the scenes exactly at `at`; one style per film', avoid: 'more than one transition every 4 s' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), cut = atOf(ctx, a.at), d = a.duration ?? 0.8;
    const t0 = r(Math.max(0, cut - d / 2)), t1 = r(Math.min(c.duration, cut + d / 2)), W = c.width, H = c.height;
    const { add, done } = adder(doc, ctx.compId);
    const kind = a.style ?? 'wipe';
    if (kind === 'wipe') {
      add('transition', { type: 'shape.rect', name: 'Transition · wipe', in: t0, out: t1, transform: { position: { $k: [{ t: t0, v: [r(-W * 0.6), r(H / 2)], ease: s.enter }, { t: cut, v: [r(W / 2), r(H / 2)], ease: s.exit }, { t: t1, v: [r(W * 1.6), r(H / 2)] }] }, rotation: 0 }, props: { size: [r(W * 1.2), r(H * 1.1)], fill: s.accent } });
    } else if (kind === 'circle') {
      const D = r(Math.hypot(W, H) * 1.05);
      add('transition', { type: 'shape.ellipse', name: 'Transition · circle', in: t0, out: t1, transform: { position: [r(W / 2), r(H / 2)], scale: { $k: [{ t: t0, v: [0, 0], ease: s.enter }, { t: cut, v: [1, 1], ease: s.exit }, { t: t1, v: [0, 0] }] } }, props: { size: [D, D], fill: s.accent } });
    } else if (kind === 'bars') {
      const n = 5, bh = r(H / n + 2);
      for (let i = 0; i < n; i++) {
        const k = r(i * Math.min(0.05, d / 12));
        add(`transition-bar-${i + 1}`, { type: 'shape.rect', name: `Transition · bar ${i + 1}`, in: t0, out: t1, transform: { position: { $k: [{ t: r(t0 + k), v: [r(-W * 0.55), r(bh * (i + 0.5))], ease: s.enter }, { t: r(cut - (n - 1) * Math.min(0.05, d / 12) + k), v: [r(W / 2), r(bh * (i + 0.5))], ease: s.exit }, { t: r(Math.min(t1, cut + k + d / 2 - (n - 1) * Math.min(0.05, d / 12))), v: [r(W * 1.55), r(bh * (i + 0.5))] }] } }, props: { size: [r(W * 1.1), bh], fill: i % 2 ? s.accent2 : s.accent } });
      }
    } else {
      add('transition', { type: 'shape.rect', name: 'Transition · flash', in: t0, out: t1, transform: { position: [r(W / 2), r(H / 2)], opacity: { $k: [{ t: t0, v: 0, ease: [0.5, 0, 1, 1] }, { t: cut, v: 1, ease: [0, 0, 0.3, 1] }, { t: t1, v: 0 }] } }, props: { size: [W, H], fill: '#FFFFFF' } });
    }
    return { ops: done(), label: `Transition (${kind}) at ${cut} s`, text: `Transition ${kind} from ${t0} to ${t1} s, the frame fully covered at ${cut} s: cut the scenes there.` };
  },
};

// ── a quote, word by word ────────────────────────────────────
/** the words of a text wrapped into lines no wider than maxFrac of the frame */
export function wrapWords(doc: TrammeDoc, text: string, size: number, weight: number, font: string | null, maxFrac: number, width: number): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const space = measure(doc, ' ', size, weight, font), max = width * maxFrac;
  const lines: string[][] = [[]];
  let lineW = 0;
  for (const word of words) {
    const w = measure(doc, word, size, weight, font);
    if (lines.at(-1)!.length && lineW + space + w > max) { lines.push([]); lineW = 0; }
    lineW += (lines.at(-1)!.length ? space : 0) + w;
    lines.at(-1)!.push(word);
  }
  return lines;
}

const quote: ToolType<{ text: string; author?: string; at?: number; duration?: number; place?: 'top' | 'center' | 'bottom'; emphasis?: number }> = {
  name: 'quote', title: 'Word-by-word quote', description: 'a quotation that appears word by word, quietly, with its author line and one word in the accent colour',
  input: {
    type: 'object',
    properties: {
      text: { type: 'string', title: 'Quote' },
      author: { type: 'string', title: 'Author' },
      emphasis: { type: 'integer', minimum: 1, title: 'Word in colour', description: 'its rank in the quote (1: the first)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
      place: { enum: ['top', 'center', 'bottom'], title: 'Place' },
    },
    required: ['text'],
  },
  ai: { when: 'a said or written sentence worth dwelling on: testimonial, epigraph, interview pull', avoid: 'more than 25 words, or quotes that need two voices' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 5));
    const u = Math.min(c.width, c.height), size = a.text.length > 120 ? Math.round(u * 0.062) : Math.round(u * 0.075), weight = 500;
    const lines = wrapWords(doc, a.text, size, weight, s.font, 0.74, c.width);
    const words = lines.flat();
    if (!words.length) throw new Error('quote: text is empty');
    const lh = size * 1.34, y = a.place === 'top' ? c.height * 0.26 : a.place === 'bottom' ? c.height * 0.62 : c.height * 0.42;
    const { add, done } = adder(doc, ctx.compId);
    const children: string[] = [];
    children.push(add('quote-mark', { type: 'text', name: 'Quote mark', transform: { position: [0, r(-(lines.length * lh) / 2 - size * 0.28)], opacity: { $k: [{ t: at, v: 0, ease: s.enter }, { t: r(at + s.pace), v: 1 }] } }, props: { text: '“', size: Math.round(size * 2.4), weight: 900, align: 'left', baseline: 'alphabetic', color: s.accent, ...(s.font ? { font: s.font } : {}) } }, false));
    let rank = 0;
    const space = measure(doc, ' ', size, weight, s.font);
    lines.forEach((line, li) => {
      const total = line.reduce((t, wd) => t + measure(doc, wd, size, weight, s.font), 0) + space * (line.length - 1);
      let x = -total / 2;
      for (const word of line) {
        const w = measure(doc, word, size, weight, s.font), t0 = r(at + 0.25 + rank * s.stagger * 1.6), cy = r(li * lh - ((lines.length - 1) * lh) / 2);
        children.push(add(`quote-word-${rank + 1}`, { type: 'text', name: word, transform: { anchor: [0, 0], position: [r(x), cy], opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.9), v: 1 }] } }, props: { text: word, size, weight, align: 'left', baseline: 'top', color: a.emphasis === rank + 1 ? s.accent : s.ink, ...(s.font ? { font: s.font } : {}) } }, false));
        x += w + space;
        rank++;
      }
    });
    if (a.author) children.push(add('quote-author', { type: 'text', name: a.author, transform: { position: [0, r((lines.length * lh) / 2 + size * 0.6)], opacity: { $k: [{ t: r(at + 0.25 + rank * s.stagger * 1.6 + s.pace * 0.4), v: 0, ease: s.enter }, { t: r(at + 0.25 + rank * s.stagger * 1.6 + s.pace * 1.2), v: 1 }] } }, props: { text: `— ${a.author}`, size: Math.round(size * 0.42), weight: 600, align: 'center', baseline: 'top', tracking: 0.04, color: s.ink, ...(s.font ? { font: s.font } : {}) } }, false));
    add('quote', { type: 'group', name: clip(a.text, 39), in: at, out: end, transform: { position: [r(c.width / 2), r(y)], opacity: { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, children });
    return { ops: done(), label: `Quote${a.author ? ` — ${a.author}` : ''}`, text: `Quote of ${words.length} word(s) on ${lines.length} line(s), one word every ${r(s.stagger * 1.6)} s from ${at} s, on screen until ${end} s.` };
  },
};

// ── a logo that reveals itself ───────────────────────────────
const logoReveal: ToolType<{ logo?: string; name?: string; style?: 'iris' | 'wipe' | 'rise'; at?: number; duration?: number }> = {
  name: 'logo-reveal', title: 'Logo reveal', description: 'a logo (an image asset) that appears with an iris, a wipe or a rise, and holds: the intro card of a film',
  input: {
    type: 'object',
    properties: {
      logo: { type: 'string', format: 'asset', assetType: 'image', title: 'Logo' },
      name: { type: 'string', title: 'Name', description: 'a line of text under the logo' },
      style: { enum: ['iris', 'wipe', 'rise'], title: 'Style' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
  },
  ai: { when: 'opening or closing a film with a brand: iris for a modern tone, wipe for a bold one, rise for a calm one', avoid: 'more than one reveal in the same film' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 3));
    const u = Math.min(c.width, c.height);
    const images = Object.entries(doc.assets).filter(([, x]) => x.type === 'image');
    const id = a.logo ?? mediaAssetsOf(doc, ctx.compId, ctx.selection, ['image'])[0] ?? images.filter(([aid, x]) => !isToolAsset(aid, x)).at(-1)?.[0];
    if (!id) throw new Error('logo-reveal: the project has no picture for the logo: join one to a message and run again');
    const { add, done } = adder(doc, ctx.compId);
    const box = u * 0.34, y = a.name ? c.height * 0.44 : c.height * 0.48, kind = a.style ?? 'iris';
    const hold = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    const transform: Record<string, unknown> = { position: [r(c.width / 2), r(y)], opacity: hold };
    const effects: unknown[] = [];
    if (kind === 'iris') {
      const mask = add('logo-mask', { type: 'shape.ellipse', name: 'Logo · iris', visible: false, in: at, out: end, transform: { position: [r(c.width / 2), r(y)], scale: { $k: [{ t: at, v: [0, 0], ease: s.emphasized }, { t: r(at + s.pace * 1.6), v: [1, 1] }] } }, props: { size: [r(box * 1.6), r(box * 1.6)], fill: '#FFFFFF' } });
      effects.push({ id: 'reveal', type: 'fx.matte', props: { source: mask, mode: 'alpha' } });
    } else if (kind === 'wipe') {
      // the rect is drawn centred on its origin: the anchor sits on its left edge, so the wipe grows from there
      const mask = add('logo-mask', { type: 'shape.rect', name: 'Logo · wipe', visible: false, in: at, out: end, transform: { anchor: [-r(box / 2), 0], position: [r(c.width / 2 - box / 2), r(y)], scale: { $k: [{ t: at, v: [0, 1], ease: s.emphasized }, { t: r(at + s.pace * 1.6), v: [1, 1] }] } }, props: { size: [r(box), r(box)], fill: '#FFFFFF' } });
      effects.push({ id: 'reveal', type: 'fx.matte', props: { source: mask, mode: 'alpha' } });
    } else {
      transform.position = { $k: [{ t: at, v: [r(c.width / 2), r(y + u * 0.05)], ease: s.enter }, { t: r(at + s.pace * 1.4), v: [r(c.width / 2), r(y)] }] };
      transform.opacity = enterThenOut(s, at, at + s.pace, end);
    }
    add('logo', { type: 'image', name: doc.assets[id]?.name ?? id, in: at, out: end, ...(effects.length ? { effects } : {}), transform, props: { image: id, size: [r(box), r(box)], fit: 'contain' } });
    if (a.name) add('logo-name', { type: 'text', name: a.name, in: at, out: end, transform: { position: [r(c.width / 2), r(y + box * 0.72)], opacity: enterThenOut(s, at + s.pace * 0.8, at + s.pace * 1.5, end) }, props: { text: a.name, size: Math.round(u * 0.035), weight: 600, align: 'center', baseline: 'top', tracking: 0.18, color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    return { ops: done(), label: `Logo reveal (${kind})`, text: `Logo "${id}" revealed with an ${kind === 'iris' ? 'iris' : kind} from ${at} s, holding until ${end} s${a.name ? `, with the name under it` : ''}.` };
  },
};

// ── a list that ticks in ─────────────────────────────────────
const listRecipe: ToolType<{ items: string; title?: string; marker?: 'check' | 'number' | 'dash'; at?: number; duration?: number }> = {
  name: 'list', title: 'List', description: 'lines that enter one after the other, each with a marker (a tick, a number or a dash): steps, arguments, ingredients',
  input: {
    type: 'object',
    properties: {
      items: { type: 'string', title: 'Items', description: 'separated by commas or line breaks' },
      title: { type: 'string', title: 'Title' },
      marker: { enum: ['check', 'number', 'dash'], title: 'Marker' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
    required: ['items'],
  },
  ai: { when: '3 to 5 points said one by one in the voice-over; the marker ties them together', avoid: 'more than 6 items, or items longer than about 8 words' },
  run(a, ctx) {
    const items = a.items.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!items.length) throw new Error('list: no item in items');
    if (items.length > 8) throw new Error('list: 8 items at most');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 5));
    const u = Math.min(c.width, c.height), size = Math.round(u * 0.05), lh = size * 2.2, marker = a.marker ?? 'check';
    const mw = size * 1.05, step = Math.max(s.stagger * 2, 0.14);
    // the numbers sit on dots of the accent: the plate's colour reads there, the ink (often the accent's neighbour in light) does not
    const onAccent = doc.tokens?.plate?.type === 'color' ? '@plate' : '#0B0F12';
    const maxText = Math.max(...items.map((item) => measure(doc, item, size, 600, s.font)));
    const blockW = mw * 1.9 + maxText, top = c.height * (a.title ? 0.4 : 0.44) - ((items.length - 1) * lh) / 2;
    const { add, done } = adder(doc, ctx.compId);
    const fadeOut = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    if (a.title) add('list-title', { type: 'text', name: a.title, in: at, out: end, transform: { position: [r(c.width / 2), r(top - lh * 0.9)], opacity: enterThenOut(s, at, at + s.pace, end) }, props: { text: a.title, size: Math.round(u * 0.06), weight: 800, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    const children: string[] = [];
    items.forEach((item, i) => {
      const t0 = r(at + 0.2 + i * step), y = r(i * lh), x0 = -blockW / 2;
      if (marker === 'number') {
        children.push(add(`list-dot-${i + 1}`, { type: 'shape.ellipse', name: `Dot ${i + 1}`, transform: { position: [r(x0 + mw / 2), y], scale: { $k: [{ t: t0, v: [0, 0], ease: POP }, { t: r(t0 + s.pace * 0.6), v: [1, 1] }] } }, props: { size: [r(mw), r(mw)], fill: s.accent } }, false));
        children.push(add(`list-num-${i + 1}`, { type: 'text', name: String(i + 1), transform: { position: [r(x0 + mw / 2), y], opacity: { $k: [{ t: r(t0 + s.pace * 0.3), v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.7), v: 1 }] } }, props: { text: String(i + 1), size: Math.round(mw * 0.62), weight: 800, align: 'center', baseline: 'middle', color: onAccent, ...(s.font ? { font: s.font } : {}) } }, false));
      } else if (marker === 'dash') {
        children.push(add(`list-dash-${i + 1}`, { type: 'shape.rect', name: `Dash ${i + 1}`, transform: { position: [r(x0 + mw / 2), y], scale: { $k: [{ t: t0, v: [0, 1], ease: s.enter }, { t: r(t0 + s.pace * 0.5), v: [1, 1] }] } }, props: { size: [r(mw), r(Math.max(2, size * 0.08))], fill: s.accent } }, false));
      } else {
        children.push(add(`list-tick-${i + 1}`, { type: 'shape.path', name: `Tick ${i + 1}`, transform: { position: [r(x0 + mw / 2), y], scale: { $k: [{ t: t0, v: [0, 0], ease: POP }, { t: r(t0 + s.pace * 0.6), v: [1, 1] }] } }, props: { path: { v: [[-mw * 0.32, 0], [-mw * 0.08, mw * 0.26], [mw * 0.34, -mw * 0.24]], closed: false }, stroke: s.accent, strokeWidth: r(Math.max(2.5, size * 0.11)), lineCap: 'round', lineJoin: 'round' } }, false));
      }
      children.push(add(`list-text-${i + 1}`, { type: 'text', name: item, transform: { anchor: [0, 0], position: [r(x0 + mw * 1.9), y], opacity: { $k: [{ t: r(t0 + s.pace * 0.25), v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.9), v: 1 }] } }, props: { text: item, size, weight: 600, align: 'left', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } }, false));
    });
    add('list', { type: 'group', name: clip(a.title ?? 'List', 39), in: at, out: end, transform: { position: [r(c.width / 2), r(top)], opacity: fadeOut }, children });
    return { ops: done(), label: `List of ${items.length} item(s)`, text: `List of ${items.length} item(s) (${marker} markers), one every ${r(step)} s from ${at} s, on screen until ${end} s.` };
  },
};

// ── a timeline that draws itself ─────────────────────────────
/** "2020: Launch, 2022: Series B" (or line breaks): the label before the colon, the fact after */
export function parseEvents(data: string): { label: string; text: string }[] {
  return data.split(/[,;\n]/).map((part) => {
    const m = /^\s*([^:：]+)[:：]?\s*(.*)$/.exec(part);
    return m ? { label: m[1].trim(), text: m[2].trim() } : null;
  }).filter((x): x is { label: string; text: string } => !!x && !!x.label);
}

const timeline: ToolType<{ data: string; title?: string; at?: number; duration?: number }> = {
  name: 'timeline', title: 'Timeline', description: 'a line that draws itself across the frame, with a dot for each event: its label by the dot and the fact under it',
  input: {
    type: 'object',
    properties: {
      data: { type: 'string', title: 'Events', description: '"Label: fact" separated by commas, in order, e.g. "2020: Launch, 2022: Series B"' },
      title: { type: 'string', title: 'Title' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
    required: ['data'],
  },
  ai: { when: 'a history, a roadmap or the steps of a process, in order; 3 to 5 events stay readable', avoid: 'more than 6 events, or facts longer than about 6 words' },
  run(a, ctx) {
    const events = parseEvents(a.data);
    if (events.length < 2) throw new Error('timeline: two events at least (expected "2020: Launch, 2022: Series B")');
    if (events.length > 8) throw new Error('timeline: 8 events at most');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 5));
    const u = Math.min(c.width, c.height), lineY = c.height * (a.title ? 0.5 : 0.48), span = c.width * 0.78;
    const labelSize = Math.round(u * 0.036), textSize = Math.round(u * 0.03);
    const { add, done } = adder(doc, ctx.compId);
    const fadeOut = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    if (a.title) add('timeline-title', { type: 'text', name: a.title, in: at, out: end, transform: { position: [r(c.width / 2), r(lineY - u * 0.22)], opacity: enterThenOut(s, at, at + s.pace, end) }, props: { text: a.title, size: Math.round(u * 0.06), weight: 800, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    // the rect is drawn centred on its origin: the anchor sits on the middle of its left edge, so the line grows from x 0.11 toward 0.89, centred on the dots
    add('timeline-line', { type: 'shape.rect', name: 'Line', in: at, out: end, transform: { anchor: [-r(span / 2), 0], position: [r(c.width * 0.11), r(lineY)], scale: { $k: [{ t: at, v: [0, 1], ease: s.enter }, { t: r(at + s.pace * 2), v: [1, 1] }] }, opacity: fadeOut }, props: { size: [r(span), r(Math.max(2, u * 0.004))], fill: s.ink } });
    events.forEach((ev, i) => {
      const t0 = r(at + 0.25 + (i * s.pace * 1.6)), x = r(c.width * 0.11 + (span * (i + 0.5)) / events.length), above = i % 2 === 0;
      add(`timeline-dot-${i + 1}`, { type: 'shape.ellipse', name: ev.label, in: at, out: end, transform: { position: [x, r(lineY)], scale: { $k: [{ t: t0, v: [0, 0], ease: POP }, { t: r(t0 + s.pace * 0.6), v: [1, 1] }] }, opacity: fadeOut }, props: { size: [r(u * 0.03), r(u * 0.03)], fill: i === events.length - 1 ? s.accent : s.ink } });
      add(`timeline-label-${i + 1}`, { type: 'text', name: `${ev.label} · label`, in: at, out: end, transform: { position: [x, r(lineY + (above ? -u * 0.05 : u * 0.05))], opacity: enterThenOut(s, t0, t0 + s.pace * 0.7, end) }, props: { text: ev.label, size: labelSize, weight: 800, align: 'center', baseline: above ? 'bottom' : 'top', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
      if (ev.text) add(`timeline-text-${i + 1}`, { type: 'text', name: ev.text, in: at, out: end, transform: { position: [x, r(lineY + (above ? -u * 0.05 - labelSize * 1.35 : u * 0.05 + labelSize * 1.35))], opacity: enterThenOut(s, t0 + s.pace * 0.3, t0 + s.pace * 0.9, end) }, props: { text: ev.text, size: textSize, weight: 500, align: 'center', baseline: above ? 'bottom' : 'top', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    });
    return { ops: done(), label: `Timeline of ${events.length} event(s)`, text: `Timeline of ${events.length} event(s), the line drawn from ${at} to ${r(at + s.pace * 2)} s, one dot every ${r(s.pace * 1.6)} s, on screen until ${end} s.` };
  },
};

// ── a split screen ───────────────────────────────────────────
const splitScreen: ToolType<{ assets?: string[]; layout?: 'half' | 'thirds'; gap?: number; at?: number; duration?: number }> = {
  name: 'split-screen', title: 'Split screen', description: 'two or three pictures or videos side by side, their panels sliding in one after the other with a gap between them',
  input: {
    type: 'object',
    properties: {
      assets: { type: 'array', items: { type: 'string', format: 'asset', assetType: ['image', 'video'] }, title: 'Media', description: 'two or three assets; picked from the selection or the project otherwise' },
      layout: { enum: ['half', 'thirds'], title: 'Layout' },
      gap: { type: 'number', title: 'Gap (px)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
  },
  ai: { when: 'comparing two takes, a before and an after, or three faces of the same story; keep the panels the same length', avoid: 'more than three panels, or a portrait film with three of them' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(Math.min(at + (a.duration ?? c.duration - at), c.duration));
    const media = Object.entries(doc.assets).filter(([, x]) => x.type === 'image' || x.type === 'video');
    // the selection holds layer ids: their own media come first, and the tools' own files (depth maps, cut-outs) are never picked
    const usable = media.filter(([mid, x]) => !isToolAsset(mid, x));
    const picked = a.assets?.length ? a.assets : [...mediaAssetsOf(doc, ctx.compId, ctx.selection, ['image', 'video']), ...usable.map(([mid]) => mid)].filter((id, i, all) => all.indexOf(id) === i);
    const n = a.layout === 'thirds' ? 3 : 2;
    const ids = picked.slice(0, n);
    if (ids.length !== n) throw new Error(`split-screen: ${n} media are needed (${ids.length} found)`);
    const u = Math.min(c.width, c.height), gap = r(a.gap ?? Math.max(3, u * 0.008));
    const cellW = (c.width - gap * (n - 1)) / n;
    const { add, done } = adder(doc, ctx.compId);
    add('split-bg', { type: 'shape.rect', name: 'Split · background', in: at, out: end, transform: { position: [r(c.width / 2), r(c.height / 2)] }, props: { size: [c.width, c.height], fill: doc.tokens?.plate?.type === 'color' ? '@plate' : '#000000' } });
    ids.forEach((id, i) => {
      const kind = (doc.assets[id]?.type ?? 'image') as 'image' | 'video';
      const x0 = r(cellW * (i + 0.5) + gap * i), t0 = r(at + i * Math.max(s.stagger * 2, 0.12));
      const from: Vec2 = x0 < c.width / 2 ? [r(x0 - c.width), r(c.height / 2)] : [r(x0 + c.width), r(c.height / 2)];
      const props: Record<string, unknown> = kind === 'image' ? { image: id, size: [r(cellW), c.height], fit: 'cover' } : { video: id, size: [r(cellW), c.height], fit: 'cover', muted: i > 0 };
      add(`split-panel-${i + 1}`, { type: kind, name: doc.assets[id]?.name ?? id, in: at, out: end, transform: { position: { $k: [{ t: t0, v: from, ease: s.emphasized }, { t: r(t0 + s.pace * 1.8), v: [x0, r(c.height / 2)] }] } }, props });
    });
    return { ops: done(), label: `Split screen (${n} panels)`, text: `Split screen of ${n} panel(s) (${ids.join(', ')}), sliding in from ${at} s every ${r(Math.max(s.stagger * 2, 0.12))} s, until ${end} s. The first panel keeps its sound, the others are muted.` };
  },
};

// ── a journey on a map ───────────────────────────────────────
/** "0.2,0.3 0.5,0.6 0.8,0.4": the stops as fractions of the frame, in order (written with or without spaces after the commas) */
export function parseStops(stops: string): Vec2[] {
  return [...stops.matchAll(/([0-9.]+)\s*[,;]\s*([0-9.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as Vec2).filter((v) => v.every((x) => Number.isFinite(x)));
}

const mapJourney: ToolType<{ stops: string; names?: string; map?: string; at?: number; duration?: number }> = {
  name: 'map-journey', title: 'Map journey', description: 'a line that travels from stop to stop on a map (or a picture), a dot marking each stop: the route of a trip, a delivery, a story',
  input: {
    type: 'object',
    properties: {
      stops: { type: 'string', title: 'Stops', description: '"x,y" pairs as fractions of the frame, in order, e.g. "0.18,0.32 0.5,0.62 0.82,0.38"' },
      names: { type: 'string', title: 'Names', description: 'one name per stop, separated by commas' },
      map: { type: 'string', format: 'asset', assetType: 'image', title: 'Map' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
    required: ['stops'],
  },
  ai: { when: 'telling a route: a trip, a tour, a delivery; two to five stops stay readable', avoid: 'more than six stops, or stops outside the frame' },
  run(a, ctx) {
    const stops = parseStops(a.stops);
    if (stops.length < 2) throw new Error('map-journey: two stops at least (expected "0.18,0.32 0.5,0.62")');
    if (stops.length > 6) throw new Error('map-journey: six stops at most');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at);
    const u = Math.min(c.width, c.height), pts = stops.map(([fx, fy]) => [r(fx * c.width), r(fy * c.height)] as Vec2);
    const names = (a.names ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const plate = doc.tokens?.plate?.type === 'color' ? '@plate' : '#FFFFFF';
    // the dot's ride: the whole trip lasts pace×1.8 s a leg, shared between the legs by their length
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const start = r(at + 0.3), totalLen = Math.max(lens.reduce((t, l) => t + l, 0), 1e-9), travel = Math.max(1.2, s.pace * 1.8 * (pts.length - 1));
    const arriveAt = [start];
    let t = start;
    // a key's ease shapes the leg that leaves it: every leg eased, the first one too
    const dotKeys: Record<string, unknown>[] = [{ t: start, v: pts[0], ease: s.enter }];
    pts.slice(1).forEach((p, i) => {
      t = r(t + travel * (lens[i] / totalLen));
      arriveAt.push(t);
      dotKeys.push({ t, v: p, ease: s.enter });
    });
    // the last name needs a breath before the whole thing fades
    const end = r(Math.max(at + (a.duration ?? 5), t + 0.8));
    const { add, done } = adder(doc, ctx.compId);
    const fadeOut = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    if (a.map) add('journey-map', { type: 'image', name: doc.assets[a.map]?.name ?? a.map, in: at, out: end, transform: { position: [r(c.width / 2), r(c.height / 2)], scale: { $k: [{ t: at, v: [1, 1], ease: s.standard }, { t: end, v: [1.05, 1.05] }] }, opacity: fadeOut }, props: { image: a.map, size: [c.width, c.height], fit: 'cover' } });
    // the line draws itself with the path's trim, in step with the dot: the fraction of the route's length at each stop,
    // keyed at the same moments with the same eases (the dot rides the legs linearly, the trim follows their lengths)
    let walked = 0;
    const fracs = pts.map((p, i) => (i === 0 ? 0 : (walked += lens[i - 1]) / totalLen));
    const trimKeys: Record<string, unknown>[] = [{ t: start, v: 0, ease: s.enter }];
    pts.slice(1).forEach((_, i) => { trimKeys.push({ t: arriveAt[i + 1], v: fracs[i + 1], ease: s.enter }); });
    add('journey-path', { type: 'shape.path', name: 'Journey · route', in: at, out: end, transform: { position: [0, 0], opacity: fadeOut }, props: { path: { v: pts, closed: false }, stroke: s.accent, strokeWidth: r(Math.max(3, u * 0.012)), lineCap: 'round', lineJoin: 'round', trimStart: 0, trimEnd: { $k: trimKeys } } });
    add('journey-dot', { type: 'shape.ellipse', name: 'Journey · dot', in: at, out: end, transform: { position: { $k: dotKeys }, opacity: fadeOut }, props: { size: [r(u * 0.03), r(u * 0.03)], fill: s.accent2 } });
    pts.forEach(([x, y], i) => {
      add(`journey-stop-${i + 1}`, { type: 'shape.ellipse', name: `Stop ${i + 1}`, in: at, out: end, transform: { position: [x, y], scale: { $k: [{ t: r(arriveAt[i] - 0.15), v: [0, 0], ease: POP }, { t: r(arriveAt[i] + s.pace * 0.5), v: [1, 1] }] }, opacity: fadeOut }, props: { size: [r(u * 0.022), r(u * 0.022)], fill: plate } });
      if (names[i]) add(`journey-name-${i + 1}`, { type: 'text', name: names[i], in: at, out: end, transform: { position: [x, r(y + u * 0.035)], opacity: enterThenOut(s, arriveAt[i], arriveAt[i] + s.pace * 0.6, end) }, props: { text: names[i], size: Math.round(u * 0.032), weight: 700, align: 'center', baseline: 'top', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    });
    return { ops: done(), label: `Map journey (${stops.length} stops)`, text: `Map journey of ${stops.length} stop(s)${names.length ? ` (${names.join(', ')})` : ''}, the line drawn from ${start} s, on screen until ${end} s${a.map ? `, over "${a.map}"` : ''}.` };
  },
};


// ── style kits ───────────────────────────────────────────────
const tok = (type: 'color' | 'ease' | 'number', value: unknown, description?: string) => ({ type, value, ...(description ? { description } : {}) });

// the kits' fonts: Fontsource files at a pinned version (the same file for every film), the variable ones under "<id>:vf"
export const BUILTIN_KITS: KitType[] = [
  { name: 'editorial', title: 'Editorial', description: 'paper and ink, a burnt orange accent, unhurried curves', font: { family: 'Newsreader', url: 'https://cdn.jsdelivr.net/fontsource/fonts/newsreader:vf@5.3.0/latin-wght-normal.woff2', weight: '200 800' }, tokens: { plate: tok('color', '#F4EFE6'), ink: tok('color', '#1B1A17'), accent: tok('color', '#C2410C'), accent2: tok('color', '#1E3A8A'), enter: tok('ease', [0.22, 1, 0.36, 1]), exit: tok('ease', [0.64, 0, 0.78, 0]), standard: tok('ease', [0.42, 0, 0.24, 1]), emphasized: tok('ease', [0.2, 0.8, 0.16, 1]), pace: tok('number', 0.7, 'seconds of an entrance'), stagger: tok('number', 0.07, 'seconds between siblings') } },
  { name: 'hairline', title: 'Hairline', description: 'technical line drawings on paper: thin strokes, one accent, figures that answer the pointer', font: { family: 'IBM Plex Mono', url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@5.3.0/latin-400-normal.woff2' }, tokens: { plate: tok('color', '#F7F5F0'), ink: tok('color', '#24241F'), accent: tok('color', '#0F62FE'), accent2: tok('color', '#9A968C'), enter: tok('ease', [0.16, 1, 0.3, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.4, 0, 0.2, 1]), emphasized: tok('ease', [0.2, 0, 0, 1]), pace: tok('number', 0.5, 'seconds of an entrance'), stagger: tok('number', 0.05, 'seconds between siblings') } },
  { name: 'punchy', title: 'Punchy', description: 'black and white with a yellow accent, fast entrances that overshoot', font: { family: 'Archivo Black', url: 'https://cdn.jsdelivr.net/fontsource/fonts/archivo-black@5.3.0/latin-400-normal.woff2' }, tokens: { plate: tok('color', '#0E0E10'), ink: tok('color', '#FFFFFF'), accent: tok('color', '#FFD400'), accent2: tok('color', '#FF4D6D'), enter: tok('ease', [0.34, 1.56, 0.64, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.3, 0, 0.15, 1]), emphasized: tok('ease', [0.34, 1.3, 0.5, 1]), pace: tok('number', 0.4, 'seconds of an entrance'), stagger: tok('number', 0.04, 'seconds between siblings') } },
  { name: 'calm', title: 'Calm', description: 'soft blue-grey, slow and smooth movements', font: { family: 'Karla', url: 'https://cdn.jsdelivr.net/fontsource/fonts/karla:vf@5.3.0/latin-wght-normal.woff2', weight: '200 800' }, tokens: { plate: tok('color', '#E8EEF2'), ink: tok('color', '#23313B'), accent: tok('color', '#5B8DB8'), accent2: tok('color', '#8FB89A'), enter: tok('ease', [0.45, 0, 0.2, 1]), exit: tok('ease', [0.55, 0, 0.55, 1]), standard: tok('ease', [0.45, 0, 0.25, 1]), emphasized: tok('ease', [0.25, 0.3, 0.2, 1]), pace: tok('number', 1, 'seconds of an entrance'), stagger: tok('number', 0.1, 'seconds between siblings') } },
  { name: 'neon', title: 'Neon', description: 'a night plate, cyan and pink accents, sharp curves', font: { family: 'Space Grotesk', url: 'https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk:vf@5.3.0/latin-wght-normal.woff2', weight: '300 700' }, tokens: { plate: tok('color', '#07060F'), ink: tok('color', '#F2F0FF'), accent: tok('color', '#22D3EE'), accent2: tok('color', '#F0ABFC'), enter: tok('ease', [0.16, 1, 0.3, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.3, 0, 0.1, 1]), emphasized: tok('ease', [0.18, 0.9, 0.2, 1]), pace: tok('number', 0.5, 'seconds of an entrance'), stagger: tok('number', 0.05, 'seconds between siblings') } },
];

const kit: ToolType<{ kit: string; background?: boolean; font?: boolean }> = {
  name: 'kit', title: 'Style kit', description: 'applies a motion language (colours, curves, pace, font) as the design tokens that recipes and dressings follow',
  input: {
    type: 'object',
    properties: {
      kit: { type: 'string', format: 'kit', title: 'Kit' },
      background: { type: 'boolean', title: 'Background', description: 'the composition takes the kit\'s plate' },
      font: { type: 'boolean', title: 'Font', description: 'bring the kit\'s font file into the project (yes by default)' },
    },
    required: ['kit'],
  },
  ai: { when: 'at the start of a project or when the user asks for a style; apply it before recipes so they pick it up' },
  run(a, ctx) {
    const found = ctx.registry.listKits().find((k) => k.kit.name === a.kit);
    if (!found) throw new Error(`unknown kit: ${a.kit} (${ctx.registry.listKits().map((k) => k.kit.name).join(', ')})`);
    const ops: Op[] = Object.entries(found.kit.tokens).map(([n, value]) => ({ op: 'add', path: pointer('tokens', n), value }));
    if (a.background !== false && found.kit.tokens.plate) ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'background'), value: '@plate' });
    const done = (fontNote: string) => ({ ops, label: `Style kit ${found.kit.title ?? found.kit.name}`, text: `Kit ${found.kit.name}: tokens ${Object.keys(found.kit.tokens).join(', ')} set${a.background !== false && found.kit.tokens.plate ? ', background @plate' : ''}${fontNote}. Existing layers keep their colours unless they use these tokens.` });
    // the kit's font: fetched once, kept as a project file, so the film holds its voice offline too
    const f = found.kit.font, has = Object.values(ctx.doc.assets).some((x) => x.type === 'font');
    if (!f || a.font === false) return done('');
    if (has) return done('. The project already has a font: it stays; remove it first to take the kit\'s');
    return (async () => {
      const slug = f.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      try {
        const r = await fetch(f.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const src = await ctx.writeFile(`assets/fonts/${slug}.woff2`, await r.blob());
        ops.push({ op: 'add', path: pointer('assets', `font-${slug}`), value: { type: 'font', src, family: f.family, name: f.family, ...(f.weight ? { weight: f.weight } : {}) } });
        return done(`, its font ${f.family} brought in as a font asset (recipes and dressings now write in it)`);
      } catch (e) {
        // a font the network refuses must not lose the kit: its tokens are applied all the same
        return done(`, but its font ${f.family} could not be brought in (${(e as Error).message}): the tokens are set, the texts keep the project's font`);
      }
    })();
  },
};

export const RECIPE_TOOLS: ToolType[] = [kineticTitle, barChart, stat, transition, quote, logoReveal, listRecipe, timeline, splitScreen, mapJourney, kit];
