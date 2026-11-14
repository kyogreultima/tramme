// The charter of a dressed video: one graphic world decided before the first
// insert and kept to the last. Its colours (plate, ink, accent, accent2) are
// the project's tokens, which every recipe and dressing reads; its backdrop
// is a composition (a living surface in those colours, a pass of light, the
// grain) that every full-frame insert is laid on. Taken from the footage by
// default, so the graphics belong to the room the speaker is in.

import { pointer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { freshId } from './model.ts';
import { dominant, pictureCanvas } from './perception.ts';
import { SURFACES, surfaceLayer, type SurfaceKind } from './surfaces.ts';
import { t } from './i18n/index.ts';

export const BACKDROP = 'charter-backdrop';

type RGB = [number, number, number];
type HSL = [number, number, number];

function hsl([r, g, b]: RGB): HSL {
  const x = r / 255, y = g / 255, z = b / 255, mx = Math.max(x, y, z), mn = Math.min(x, y, z), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === x ? ((y - z) / d + 6) % 6 : mx === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, s, l];
}

function hex([h, s, l]: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export interface CharterColours { plate: string; ink: string; accent: string; accent2: string }

/**
 * The charter's colours from the main colours of the footage: the accent is
 * its most vivid colour, made vivid enough to carry a word; the plate is the
 * hue of the room taken deep (dark) or pale (light); the ink reads on it.
 */
export function charterColours(colours: { rgb: RGB; share: number }[], tone: 'dark' | 'light' = 'dark'): CharterColours {
  const all = colours.map((c) => ({ ...c, hsl: hsl(c.rgb) }));
  const vivid = [...all].filter((c) => c.hsl[1] > 0.2 && c.hsl[2] > 0.12 && c.hsl[2] < 0.9).sort((a, b) => b.hsl[1] * (0.4 + b.share) - a.hsl[1] * (0.4 + a.share));
  const accentOf = vivid[0]?.hsl ?? [30, 0.8, 0.55];
  // the room: the largest coloured area, else the accent's hue
  const room = [...all].filter((c) => c.hsl[1] > 0.12).sort((a, b) => b.share - a.share)[0]?.hsl ?? accentOf;
  const dark = tone === 'dark';
  const accent: HSL = [accentOf[0], clamp(Math.max(accentOf[1], 0.7), 0, 0.95), dark ? clamp(accentOf[2], 0.52, 0.62) : clamp(accentOf[2], 0.4, 0.5)];
  return {
    plate: hex([room[0], clamp(room[1], 0.25, 0.55), dark ? 0.07 : 0.94]),
    ink: hex([room[0], 0.15, dark ? 0.95 : 0.08]),
    accent: hex(accent),
    accent2: hex([accent[0], accent[1], dark ? 0.8 : 0.3]),
  };
}

interface Input { video?: string; at?: number; tone?: 'dark' | 'light'; plate?: string; ink?: string; accent?: string; under?: SurfaceKind; over?: SurfaceKind[]; backdrop?: { at: number; duration: number }[] }

const UNDER = Object.entries(SURFACES).filter(([, s]) => s.under).map(([k]) => k), OVER = Object.entries(SURFACES).filter(([, s]) => !s.under).map(([k]) => k);

/** the footage the charter is taken from: the one asked for, else the video the composition plays longest */
function footageOf(ctx: ToolContext, wanted?: string): string | null {
  if (wanted) { if (!ctx.doc.assets[wanted]) throw new Error(`charter: no asset ${wanted}`); return wanted; }
  const c = ctx.doc.compositions[ctx.compId], played = new Map<string, number>();
  for (const l of Object.values(c.layers)) {
    const id = l.type === 'video' ? String(l.props?.video ?? '') : '';
    if (ctx.doc.assets[id]) played.set(id, (played.get(id) ?? 0) + (l.out ?? c.duration) - (l.in ?? 0));
  }
  return [...played].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const charter: ToolType<Input> = {
  name: 'charter', title: 'Graphic charter', description: 'sets the one graphic world of a dressed video before its first insert: the colours (plate, ink, accent, accent2 as tokens, taken from the footage unless given) and a backdrop composition (a living surface, a pass of light, the grain) every full-frame insert is laid on; backdrop lays it over spans of the film',
  input: {
    type: 'object',
    properties: {
      video: { type: 'string', format: 'asset', assetType: ['video', 'image'], title: 'From', description: 'the footage or picture the colours come from; the video the film plays longest by default' },
      at: { type: 'number', minimum: 0, title: 'Frame (s)', description: 'the moment of the footage read (its first second by default)' },
      tone: { enum: ['dark', 'light'], title: 'Tone', description: 'a deep plate with light ink (by default) or a pale one with dark ink' },
      plate: { type: 'string', title: 'Plate', description: 'a colour of the brief instead of the footage\'s (#RRGGBB)' },
      ink: { type: 'string', title: 'Ink' },
      accent: { type: 'string', title: 'Accent' },
      under: { enum: UNDER, title: 'Surface', description: 'the backdrop\'s plate (gradient by default)' },
      over: { type: 'array', items: { enum: OVER }, title: 'Passes', description: 'the passes over it, in order (grain by default; glow, ribbons or bokeh add light)' },
      backdrop: { type: 'array', title: 'Inserts', description: 'spans of the film where a full-frame insert goes: the backdrop is laid there, on top of the stack, for its content to go over', items: { type: 'object', properties: { at: { type: 'number', minimum: 0 }, duration: { type: 'number', minimum: 0.5 } }, required: ['at', 'duration'] } },
    },
  },
  ai: {
    when: 'dressing a video where someone speaks, after the cuts and before the first insert or keyword: every insert then takes the same plate, type and accent; again with backdrop for each full-frame insert',
    avoid: 'a second charter halfway through a film; colours outside it on an insert',
  },
  async run(a, ctx) {
    const doc = ctx.doc, c = doc.compositions[ctx.compId], ops: Op[] = [];
    const lines: string[] = [];
    const set = !doc.compositions[BACKDROP] || a.plate || a.ink || a.accent || a.under || a.over || a.tone;
    if (set) {
      const from = footageOf(ctx, a.video);
      const found = from ? charterColours(dominant((await pictureCanvas(ctx, from, a.at ?? 1)).getImageData(0, 0, 96, 96).data), a.tone) : charterColours([], a.tone);
      const colours: CharterColours = { ...found, ...(a.plate ? { plate: a.plate } : {}), ...(a.ink ? { ink: a.ink } : {}), ...(a.accent ? { accent: a.accent, accent2: a.accent } : {}) };
      for (const [n, value] of Object.entries(colours)) ops.push({ op: 'add', path: pointer('tokens', n), value: { type: 'color', value, description: 'the charter' } });
      const under = a.under ?? 'gradient', over = a.over ?? ['grain'];
      const layers: Record<string, unknown> = {}, order: string[] = [];
      const lay = (kind: SurfaceKind, colors: [string, string], amount?: number) => { const id = freshId(layers, kind); layers[id] = surfaceLayer(kind, c, colors, { amount }); order.push(id); };
      // the plate barely moving between the plate and the accent, the light in the accent, the grain last
      lay(under, ['@plate', '@accent'], under === 'gradient' ? 0.3 : undefined);
      for (const k of over) lay(k, k === 'grain' ? ['#FFFFFF', '#000000'] : ['@plate', '@accent'], k === 'grain' ? 0.05 : 0.35);
      ops.push({ op: 'add', path: pointer('compositions', BACKDROP), value: { name: 'Backdrop (charter)', width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: '@plate', layers, order } });
      lines.push(`Charter set from ${from ?? 'no footage (a default warm accent)'}: plate ${colours.plate}, ink ${colours.ink}, accent ${colours.accent}, accent2 ${colours.accent2} as tokens; backdrop composition "${BACKDROP}" (${[under, ...over].join(', ')}).`);
    }
    const taken: Record<string, unknown> = { ...c.layers };
    for (const span of a.backdrop ?? []) {
      const id = freshId(taken, 'backdrop'); taken[id] = 1;
      const end = Math.min(c.duration, span.at + span.duration);
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: 'comp', name: `Backdrop ${span.at.toFixed(1)} s`, in: +span.at.toFixed(3), out: +end.toFixed(3), transform: { position: [c.width / 2, c.height / 2] }, props: { comp: BACKDROP } } });
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'order', '-'), value: id });
      lines.push(`Backdrop laid as ${id} from ${span.at.toFixed(2)} to ${end.toFixed(2)} s, on top of the stack: lay the insert's content after it.`);
    }
    if (!lines.length) return { text: `The charter is set (tokens plate, ink, accent, accent2; backdrop "${BACKDROP}"). Give backdrop spans to lay it under inserts, or colours to change it.`, label: t('charter.kept') };
    lines.push('Every insert keeps to it: laid on the backdrop when it fills the frame, its words in @ink in the display face, the one word that matters in @accent (@accent2 for a second), no other colour. The recipes and dressings read these tokens already. The face never shares the frame with a full-frame insert: the insert replaces it, then the face comes back.');
    return { ops, label: t('charter.set'), notice: t('charter.set'), text: lines.join('\n') };
  },
};

export const CHARTER_TOOLS: ToolType[] = [charter];
