// Surfaces: textures and light drawn by the engine (a `shader` layer from a
// preset), free and deterministic: every preset is a pure function of the
// layer's time, its size and its settings, so a frame is the same wherever it
// is rendered. A surface under the content is a plate with a material; a
// surface over it is a pass of grain, light or glints. The colours follow the
// palette tokens when the project has them.

import { freshId } from './model.ts';
import { pointer, type Op, type ToolType } from '@tramme/core';
import { t } from './i18n/index.ts';

export type SurfaceKind = 'grain' | 'paper' | 'halftone' | 'gradient' | 'glow' | 'ribbons' | 'grid' | 'bokeh' | 'caustics';

export interface Surface {
  code: string;
  blend: 'normal' | 'add' | 'screen' | 'multiply' | 'overlay';
  /** true: a plate under the content; false: a pass over it */
  under: boolean;
  /** p1 is the amount, p2 the speed, p3 and p4 are the preset's own (the halftone's cell, in px) */
  params: [number, number, number, number];
  /** the colours of a project with no palette tokens: A, then B */
  colors: [string, string];
  line: string;
}

/** a hash and a value noise, shared by the presets that need them (functions of the position only) */
const NOISE = `float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export const SURFACES: Record<SurfaceKind, Surface> = {
  grain: {
    blend: 'normal', under: false, params: [0.07, 1, 0, 0], colors: ['#FFFFFF', '#000000'],
    line: 'grain: a film grain over the whole frame, redrawn 24 times a second; the last pass over everything, kills the digital flatness',
    code: `${NOISE}vec4 shade(vec2 uv) {
  vec2 px = floor(uv * uSize);
  float n = hash(px + floor(uTime * 24.0 * max(uParams.y, 0.0)) * 17.31) - 0.5;
  vec3 c = n > 0.0 ? uColorA.rgb : uColorB.rgb;
  return vec4(c, clamp(abs(n) * 2.0 * uParams.x, 0.0, 1.0));
}`,
  },
  paper: {
    blend: 'normal', under: true, params: [1, 0, 0, 0], colors: ['#F1ECE2', '#1B1A17'],
    line: 'paper: a still paper plate with fibres and tooth, in the first colour; a warm ground under type and illustrations',
    code: `${NOISE}vec4 shade(vec2 uv) {
  vec2 p = uv * uSize;
  float f = vnoise(p * 0.012) * 0.6 + vnoise(p * 0.05) * 0.3;
  float fibres = vnoise(vec2(p.x * 0.6, p.y * 0.02)) * vnoise(vec2(p.x * 0.02, p.y * 0.6));
  float tooth = hash(floor(p / 2.0));
  float s = ((f - 0.45) * 0.10 + (fibres - 0.25) * 0.08 + (tooth - 0.5) * 0.03) * uParams.x;
  return vec4(uColorA.rgb + s, 1.0);
}`,
  },
  halftone: {
    blend: 'normal', under: true, params: [1, 1, 9, 0], colors: ['#F4EFE6', '#C2410C'],
    line: 'halftone: a dot screen at 45 degrees whose dots swell slowly from the first colour to the second; print and editorial looks (p3 is the cell, in px)',
    code: `vec4 shade(vec2 uv) {
  float cell = max(uParams.z, 3.0);
  vec2 p = uv * uSize;
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p / cell;
  vec2 c = fract(q) - 0.5;
  float k = clamp(uv.y * 0.8 + 0.1 + 0.15 * sin(uTime * 0.3 * uParams.y + uv.x * 3.0), 0.0, 1.0);
  float rad = 0.5 * k * uParams.x;
  float dot = 1.0 - smoothstep(rad - 1.0 / cell, rad, length(c));
  return vec4(mix(uColorA.rgb, uColorB.rgb, k), dot);
}`,
  },
  gradient: {
    blend: 'normal', under: true, params: [0.7, 1, 0, 0], colors: ['#14213D', '#E5B965'],
    line: 'gradient: a mesh of soft blobs drifting between the two colours; a living plate under the content, never flat',
    code: `vec4 shade(vec2 uv) {
  float asp = uSize.x / uSize.y;
  float t = uTime * 0.12 * uParams.y;
  vec2 q = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
  vec2 a = vec2(0.35 * sin(t * 1.3) * asp, 0.35 * cos(t * 1.1));
  vec2 b = vec2(0.40 * cos(t * 0.9 + 2.0) * asp, 0.30 * sin(t * 1.4 + 1.0));
  vec2 c = vec2(0.30 * sin(t * 1.7 + 4.0) * asp, 0.40 * cos(t * 0.8 + 3.0));
  float wa = exp(-dot(q - a, q - a) * 4.0);
  float wb = exp(-dot(q - b, q - b) * 5.0);
  float wc = exp(-dot(q - c, q - c) * 6.0);
  float k = clamp((wa + wb * 0.6) * uParams.x, 0.0, 1.0);
  return vec4(mix(mix(uColorA.rgb, uColorB.rgb, k), uColorA.rgb, wc * 0.6), 1.0);
}`,
  },
  glow: {
    blend: 'add', under: false, params: [0.6, 1, 0, 0], colors: ['#000000', '#E5B965'],
    line: 'glow: two or three soft lights in the second colour drifting over the content; warmth and depth on a dark frame',
    code: `vec4 shade(vec2 uv) {
  float asp = uSize.x / uSize.y;
  float t = uTime * 0.15 * uParams.y;
  vec2 q = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
  vec2 a = vec2(0.30 * sin(t * 1.1) * asp, 0.28 * cos(t * 0.9));
  vec2 b = vec2(0.35 * cos(t * 0.7 + 2.0) * asp, 0.30 * sin(t * 1.2 + 1.0));
  vec2 c = vec2(0.25 * sin(t * 1.5 + 4.0) * asp, 0.35 * cos(t * 0.6 + 3.0));
  float g = exp(-dot(q - a, q - a) * 7.0) + 0.8 * exp(-dot(q - b, q - b) * 9.0) + 0.6 * exp(-dot(q - c, q - c) * 12.0);
  return vec4(uColorB.rgb, clamp(g * uParams.x, 0.0, 1.0));
}`,
  },
  ribbons: {
    blend: 'add', under: false, params: [0.7, 1, 0, 0], colors: ['#000000', '#8FB8FF'],
    line: 'ribbons: three thin bands of light bent by sine fields, travelling over the content; tech and flow',
    code: `vec4 shade(vec2 uv) {
  float asp = uSize.x / uSize.y;
  float t = uTime * 0.25 * uParams.y;
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.30 + 0.20 * fi + 0.07 * sin(uv.x * asp * 3.0 + t + fi * 2.0) + 0.04 * sin(uv.x * asp * 7.0 - t * 1.3 + fi);
    float d = abs(uv.y - y);
    a += exp(-d * d * 4000.0) + 0.25 * exp(-d * d * 300.0);
  }
  return vec4(uColorB.rgb, clamp(a * uParams.x * 0.5, 0.0, 1.0));
}`,
  },
  grid: {
    blend: 'normal', under: true, params: [0.5, 1, 0, 0], colors: ['#000000', '#6FA8FF'],
    line: 'grid: a perspective floor of fine lines fading to the horizon, travelling toward the viewer; a stage for a product or a title',
    code: `vec4 shade(vec2 uv) {
  float asp = uSize.x / uSize.y;
  float h = 0.45;
  if (uv.y <= h) return vec4(0.0);
  float z = 1.0 / (uv.y - h);
  float gx = (uv.x - 0.5) * asp * z * 2.0;
  float gz = z + uTime * 0.5 * uParams.y;
  float lx = 1.0 - min(abs(fract(gx - 0.5) - 0.5) / fwidth(gx), 1.0);
  float lz = 1.0 - min(abs(fract(gz - 0.5) - 0.5) / fwidth(gz), 1.0);
  float fade = smoothstep(h, h + 0.35, uv.y);
  return vec4(uColorB.rgb, max(lx, lz) * fade * uParams.x);
}`,
  },
  bokeh: {
    blend: 'screen', under: false, params: [0.6, 1, 0, 0], colors: ['#FFFFFF', '#FFD9A0'],
    line: 'bokeh: out-of-focus discs of varied size and depth drifting up over the content; a shallow-focus night or a warm interior',
    code: `${NOISE}vec4 shade(vec2 uv) {
  float asp = uSize.x / uSize.y;
  float a = 0.0;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float s = 3.0 + 2.5 * fl;
    vec2 p = vec2(uv.x * asp, uv.y + uTime * 0.025 * uParams.y * (1.0 + fl)) * s;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float on = step(0.45, hash(id + fl * 13.7));
    vec2 off = (vec2(hash(id + 1.7 + fl), hash(id + 4.1 + fl)) - 0.5) * 0.5;
    float r = 0.12 + 0.2 * hash(id + 9.3);
    float disc = 1.0 - smoothstep(r - 0.04, r, length(f - off));
    a += disc * on * 0.25 / (1.0 + fl);
  }
  return vec4(mix(uColorA.rgb, uColorB.rgb, 0.7), clamp(a * uParams.x, 0.0, 1.0));
}`,
  },
  caustics: {
    blend: 'normal', under: true, params: [1, 1, 0, 0], colors: ['#0B3C5D', '#9FE3FF'],
    line: 'caustics: the light of water moving on a floor; a pool, a bathroom, a calm and cool plate',
    code: `vec4 shade(vec2 uv) {
  vec2 p = uv * vec2(uSize.x / uSize.y, 1.0) * 6.28318 - 250.0;
  float t = uTime * 0.5 * uParams.y;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  float k = clamp(pow(abs(c), 8.0) * uParams.x, 0.0, 1.0);
  return vec4(mix(uColorA.rgb, uColorB.rgb, k), 1.0);
}`,
  },
};

interface Input { kind?: SurfaceKind; colors?: [string, string]; amount?: number; speed?: number; at?: number; duration?: number; name?: string }

const surface: ToolType<Input> = {
  name: 'surface', title: 'Surface', description: 'lays a texture or a light drawn by the engine over or under the content (grain, paper, halftone, gradient, glow, light ribbons, grid, bokeh, caustics): a shader layer covering the frame, in the palette colours, free and the same on every render',
  input: {
    type: 'object',
    properties: {
      kind: { enum: Object.keys(SURFACES), title: 'Kind', description: 'which surface; none lists them all' },
      colors: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2, title: 'Colours', description: 'the two colours (A, B); the palette tokens plate and accent by default, else the preset\'s own' },
      amount: { type: 'number', minimum: 0, title: 'Amount', description: "how strong: the preset's own by default (grain 0.02 to 0.12)" },
      speed: { type: 'number', minimum: 0, title: 'Speed', description: '1 by default, 0 stills it' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: 'the whole composition by default' },
      duration: { type: 'number', minimum: 0.1, title: 'Length (s)', description: 'to the end by default' },
      name: { type: 'string', title: 'Name' },
    },
  },
  ai: {
    when: 'every frame needs material: a surface under the content (paper, gradient, halftone, grid, caustics) and one over it (grain, glow, ribbons, bokeh), in the palette colours; a flat plate is unfinished',
    avoid: 'a loud surface behind text (keep the amount low); two surfaces of the same kind in one scene; a surface instead of an object the script names',
  },
  async run(a, ctx) {
    if (!a.kind) return { text: `Surfaces:\n${Object.values(SURFACES).map((s) => `- ${s.line}`).join('\n')}\nCall surface again with a kind.`, label: t('surface.list') };
    const s = SURFACES[a.kind];
    if (!s) throw new Error(`${a.kind}: no such surface (${Object.keys(SURFACES).join(', ')})`);
    const doc = ctx.doc, c = doc.compositions[ctx.compId];
    const token = (n: string) => doc.tokens?.[n]?.type === 'color';
    const [colorA, colorB] = a.colors ?? [token('plate') ? '@plate' : s.colors[0], token('accent') ? '@accent' : s.colors[1]];
    const [p1, p2, p3, p4] = s.params;
    const id = freshId({ ...c.layers }, a.name ?? a.kind);
    const span = a.at !== undefined || a.duration !== undefined;
    const from = a.at ?? 0;
    const layer = {
      type: 'shader', name: a.name ?? a.kind, ...(span ? { in: +from.toFixed(3), out: +Math.min(c.duration, from + (a.duration ?? c.duration)).toFixed(3) } : {}),
      blend: s.blend, transform: { position: [c.width / 2, c.height / 2] },
      props: { code: s.code, size: [c.width, c.height], colorA, colorB, p1: a.amount ?? p1, p2: a.speed ?? p2, p3, p4 },
    };
    const ops: Op[] = [
      { op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: layer },
      { op: 'add', path: pointer('compositions', ctx.compId, 'order', s.under ? '0' : '-'), value: id },
    ];
    return {
      ops, label: t('surface.laid', { kind: a.kind }),
      text: `Surface "${a.kind}" laid as layer ${id}, ${s.under ? 'under the content' : 'over the content'} (${s.blend}), covering the ${c.width}×${c.height} frame in ${colorA} and ${colorB}. Look at it (check, a still): a surface is a texture, it stays quiet behind text.`,
    };
  },
};

export const SURFACE_TOOLS: ToolType[] = [surface as unknown as ToolType];
