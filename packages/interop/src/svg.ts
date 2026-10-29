// Export of one frame as SVG: shapes, paths, text (fonts embedded), images
// (embedded), groups and nested compositions stay vector; clips become
// clipPaths; layer effects become SVG filters; blend modes become
// mix-blend-mode. Nodes drawn by code (code, shader, particles) are left out
// and reported. Finishing effects (grain, bloom) and motion blur are not part
// of a vector frame.

import { drawingAt, Evaluator, isTilted, isTrimmed, localFrame, parseColor, trimRuns, type TrammeDoc, type EvaluatedLayer, type Paint, type PathValue, type Registry, type SvgHost, type TrimProps } from '@tramme/core';
import { toBase64 } from './bytes.ts';

export interface SvgOptions {
  compId?: string;
  readAsset?: (assetId: string) => { data: Uint8Array; mime: string; width: number; height: number } | null;
}

const n = (x: number) => String(Math.round(x * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = toBase64;

/** colour and its opacity as SVG attributes */
function colorAttrs(css: string, name: 'fill' | 'stroke' | 'stop-color' | 'flood-color'): string {
  const [r, g, b, a] = parseColor(css);
  const hex = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const op = name === 'stop-color' ? 'stop-opacity' : name === 'flood-color' ? 'flood-opacity' : `${name}-opacity`;
  return a < 1 ? `${name}="${hex}" ${op}="${n(a)}"` : `${name}="${hex}"`;
}

function matrix(tr: EvaluatedLayer['transform']): string {
  const r = (tr.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * tr.scale[0], b = sin * tr.scale[0], c = -sin * tr.scale[1], d = cos * tr.scale[1];
  const e = tr.position[0] - tr.anchor[0] * a - tr.anchor[1] * c, f = tr.position[1] - tr.anchor[0] * b - tr.anchor[1] * d;
  return `matrix(${[a, b, c, d, e, f].map(n).join(' ')})`;
}

export function pathData(p: PathValue): string {
  if (!p.v.length) return '';
  const z = [0, 0];
  let d = `M${n(p.v[0][0])} ${n(p.v[0][1])}`;
  const seg = (a: number, b: number) => {
    const o = p.o?.[a] ?? z, i = p.i?.[b] ?? z, [ax, ay] = p.v[a], [bx, by] = p.v[b];
    d += !o[0] && !o[1] && !i[0] && !i[1] ? `L${n(bx)} ${n(by)}` : `C${n(ax + o[0])} ${n(ay + o[1])} ${n(bx + i[0])} ${n(by + i[1])} ${n(bx)} ${n(by)}`;
  };
  for (let k = 0; k < p.v.length - 1; k++) seg(k, k + 1);
  if (p.closed) { if (p.v.length > 1) seg(p.v.length - 1, 0); d += 'Z'; }
  return d;
}

const BLEND: Record<string, string> = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', add: 'plus-lighter' };

class SvgWriter {
  doc: TrammeDoc; ev: Evaluator; reg: Registry; opts: SvgOptions;
  defs: string[] = [];
  fonts = new Set<string>();
  warnings: string[] = [];
  private ids = 0;
  constructor(doc: TrammeDoc, reg: Registry, opts: SvgOptions) { this.doc = doc; this.reg = reg; this.opts = opts; this.ev = new Evaluator(doc, reg); }
  id(p: string) { return `${p}${++this.ids}`; }
  warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }

  paint(p: Paint, attr: 'fill' | 'stroke'): string {
    if (p === null || p === undefined) return `${attr}="none"`;
    if (typeof p === 'string') return colorAttrs(p, attr);
    const id = this.id('g');
    const stops = p.stops.map(([o, c]) => `<stop offset="${n(o)}" ${colorAttrs(c, 'stop-color')}/>`).join('');
    this.defs.push(p.type === 'linear'
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(p.from[0])}" y1="${n(p.from[1])}" x2="${n(p.to[0])}" y2="${n(p.to[1])}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(p.center[0])}" cy="${n(p.center[1])}" r="${n(p.radius)}">${stops}</radialGradient>`);
    return `${attr}="url(#${id})"`;
  }

  strokeAttrs(p: Record<string, any>) {
    if (!p.stroke || !(p.strokeWidth > 0)) return '';
    // a trimmed stroke draws its window: the length is normalized (pathLength 1) and the dash set to the runs
    let trim = '';
    if (isTrimmed(p)) {
      const runs = trimRuns(p as TrimProps);
      if (!runs) trim = '';
      else if (!runs.length) return ''; // nothing of the stroke shows
      else if (runs.length === 1) {
        const [a, b] = runs[0];
        trim = ` pathLength="1" stroke-dasharray="${n(b - a)} ${n(1 - (b - a))}"${a > 0 ? ` stroke-dashoffset="${n(-a)}"` : ''}`;
      } else {
        const [a] = runs[0], [, b] = runs[1];
        trim = ` pathLength="1" stroke-dasharray="${n(b)} ${n(a - b)} ${n(1 - a)}"`;
      }
    }
    return ` ${this.paint(p.stroke, 'stroke')} stroke-width="${n(p.strokeWidth)}"${p.lineCap && p.lineCap !== 'butt' ? ` stroke-linecap="${p.lineCap}"` : ''}${p.lineJoin && p.lineJoin !== 'miter' ? ` stroke-linejoin="${p.lineJoin}"` : ''}${trim}`;
  }

  /** the node's own drawing in its local space */
  content(L: EvaluatedLayer, compId: string, t: number): string {
    const p = L.props as Record<string, any>;
    switch (L.layer.type) {
      case 'shape.rect': {
        const [w, h] = p.size, r = Math.min(p.radius, Math.abs(w) / 2, Math.abs(h) / 2);
        // trimmed, the outline starts where the preview's and Lottie's do: a path, since <rect> starts elsewhere
        if (isTrimmed(p)) return `<path d="${rectOutline(Math.abs(w), Math.abs(h), Math.max(0, r))}" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
        return `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"${r > 0 ? ` rx="${n(r)}"` : ''} ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      }
      case 'shape.ellipse': {
        const rx = Math.abs(p.size[0]) / 2, ry = Math.abs(p.size[1]) / 2;
        if (isTrimmed(p)) return `<path d="M0,${n(-ry)}A${n(rx)},${n(ry)} 0 0 1 0,${n(ry)}A${n(rx)},${n(ry)} 0 0 1 0,${n(-ry)}Z" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
        return `<ellipse cx="0" cy="0" rx="${n(rx)}" ry="${n(ry)}" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      }
      case 'shape.path': return `<path d="${pathData(p.path)}" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      case 'text': case 'text.counter': {
        if (L.layer.type === 'text.counter') this.warn(`counter "${L.layer.name ?? L.id}": exported as fixed text`);
        const family = p.font ? this.doc.assets[p.font]?.family || p.font : 'sans-serif';
        if (p.font) this.fonts.add(p.font);
        const text: string = L.layer.type === 'text' ? String(p.text) : String(p.progress >= 1 ? p.to : p.from);
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        const lines = text.split('\n');
        const color = typeof p.color === 'string' ? colorAttrs(p.color, 'fill') : this.paint(p.color, 'fill');
        const attrs = `font-family="${esc(family)}, sans-serif" font-size="${n(p.size)}" font-weight="${Math.round(p.weight)}"${p.italic ? ' font-style="italic"' : ''}${p.tracking ? ` letter-spacing="${n(p.tracking * p.size)}"` : ''} text-anchor="${anchor}" ${color}`;
        if (lines.length === 1) return `<text x="0" y="0" ${attrs} xml:space="preserve">${esc(text)}</text>`;
        return `<text ${attrs} xml:space="preserve">${lines.map((l, i) => `<tspan x="0" y="${n(i * (p.lineHeight ?? 1.2) * p.size)}">${esc(l)}</tspan>`).join('')}</text>`;
      }
      case 'image': {
        if (!p.image) return '';
        const file = this.opts.readAsset?.(p.image);
        if (!file) { this.warn(`image "${p.image}" not embedded`); return ''; }
        const [w, h] = p.size;
        const box = p.box ?? this.doc.assets[p.image]?.box ?? [0, 0, file.width, file.height];
        const bw = box[2] - box[0], bh = box[3] - box[1];
        const s = p.fit === 'fill' ? [(w / bw) * p.zoom, (h / bh) * p.zoom] : (() => { const k = (p.fit === 'cover' ? Math.max(w / bw, h / bh) : p.fit === 'contain' ? Math.min(w / bw, h / bh) : 1) * p.zoom; return [k, k]; })();
        let ox = -(box[0] + bw * p.focus[0]) * s[0] + p.offset[0], oy = -(box[1] + bh * p.focus[1]) * s[1] + p.offset[1];
        if (p.fit === 'cover') { ox = Math.min(-w / 2, Math.max(w / 2 - file.width * s[0], ox)); oy = Math.min(-h / 2, Math.max(h / 2 - file.height * s[1], oy)); }
        let clip = '';
        if (p.crop) {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g${clip}><image href="data:${file.mime};base64,${b64(file.data)}" x="${n(ox)}" y="${n(oy)}" width="${n(file.width * s[0])}" height="${n(file.height * s[1])}" preserveAspectRatio="none"/></g>`;
      }
      case 'sequence': {
        const fps = this.doc.compositions[compId].fps;
        const d = drawingAt({ hold: p.hold, sheet: p.sheet, loop: p.loop, offset: p.offset, drawing: p.drawing, count: p.frames.length }, localFrame(t, L.layer.in ?? 0, fps));
        if (d < 0) return '';
        const file = this.opts.readAsset?.(p.frames[d]);
        if (!file) { this.warn(`drawing "${p.frames[d]}" not embedded`); return ''; }
        const [w, h] = p.size;
        const s = p.fit === 'fill' ? [w / file.width, h / file.height] : (() => { const k = p.fit === 'cover' ? Math.max(w / file.width, h / file.height) : p.fit === 'contain' ? Math.min(w / file.width, h / file.height) : 1; return [k, k]; })();
        let clip = '';
        if (p.fit === 'cover') {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g${clip}><image href="data:${file.mime};base64,${b64(file.data)}" x="${n((-file.width * s[0]) / 2)}" y="${n((-file.height * s[1]) / 2)}" width="${n(file.width * s[0])}" height="${n(file.height * s[1])}" preserveAspectRatio="none"/></g>`;
      }
      case 'comp': {
        const c = p.comp ? this.doc.compositions[p.comp] : null;
        if (!c) return '';
        let lt = p.remap ?? p.start + (t - (L.layer.in ?? 0)) * p.speed;
        if (p.loop && c.duration > 0) lt = ((lt % c.duration) + c.duration) % c.duration;
        let clip = '';
        if (p.crop) {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="0" y="0" width="${c.width}" height="${c.height}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g transform="translate(${n(-c.width / 2)} ${n(-c.height / 2)})"${clip}>${this.composition(p.comp, lt, false)}</g>`;
      }
      case 'group': case 'audio': return '';
      default:
        // a plugin node may say how it looks in SVG
        if (L.node.export?.svg) return L.node.export.svg(L.props, this.svgHost(compId));
        this.warn(`"${L.layer.name ?? L.id}" (${L.layer.type}) is drawn by code: left out of the SVG`);
        return '';
    }
  }

  /** what a plugin node's SVG hook reads besides its props: the composition's size, the JSON assets it drew from */
  private jsonCache = new Map<string, unknown>();
  svgHost(compId: string): SvgHost {
    const c = this.doc.compositions[compId];
    return {
      width: c?.width ?? 0, height: c?.height ?? 0,
      json: (id: string) => {
        if (!this.jsonCache.has(id)) {
          const f = this.opts.readAsset?.(id);
          let v: unknown = null;
          try { v = f ? JSON.parse(new TextDecoder().decode(f.data)) : null; } catch { v = null; }
          this.jsonCache.set(id, v);
        }
        return this.jsonCache.get(id) ?? null;
      },
    };
  }

  filter(L: EvaluatedLayer): string {
    const parts: string[] = [];
    let last = 'SourceGraphic', k = 0;
    const out = () => `f${++k}`;
    for (const fx of L.effects) {
      const p = fx.props as Record<string, any>;
      if (fx.type === 'fx.blur') { const o = out(); parts.push(`<feGaussianBlur in="${last}" stdDeviation="${n(p.radius)}" result="${o}"/>`); last = o; }
      else if (fx.type === 'fx.shadow') { const o = out(); parts.push(`<feDropShadow in="${last}" dx="${n(p.offset[0])}" dy="${n(p.offset[1])}" stdDeviation="${n(p.blur / 2)}" ${colorAttrs(p.color, 'flood-color')} result="${o}"/>`); last = o; }
      else if (fx.type === 'fx.glow') { for (let i = 0; i < Math.max(1, Math.round(p.strength)); i++) { const o = out(); parts.push(`<feDropShadow in="${last}" dx="0" dy="0" stdDeviation="${n(p.radius / 2)}" ${colorAttrs(p.color, 'flood-color')} result="${o}"/>`); last = o; } }
      else if (fx.type === 'fx.color') {
        const o1 = out(), o2 = out(), o3 = out();
        const b = p.brightness, c = p.contrast, ic = (1 - c) / 2;
        parts.push(`<feComponentTransfer in="${last}" result="${o1}"><feFuncR type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/><feFuncG type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/><feFuncB type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/></feComponentTransfer>`);
        parts.push(`<feColorMatrix in="${o1}" type="saturate" values="${n(p.saturation)}" result="${o2}"/>`);
        parts.push(`<feColorMatrix in="${o2}" type="hueRotate" values="${n(p.hue)}" result="${o3}"/>`);
        last = o3;
      } else if (fx.type === 'fx.tint') {
        const o1 = out(), o2 = out(), o3 = out();
        parts.push(`<feFlood ${colorAttrs(p.color, 'flood-color')} result="${o1}"/>`, `<feComposite in="${o1}" in2="${last}" operator="in" result="${o2}"/>`);
        parts.push(`<feComposite in="${o2}" in2="${last}" operator="arithmetic" k2="${n(p.amount)}" k3="${n(1 - p.amount)}" result="${o3}"/>`);
        last = o3;
      } else this.warn(`effect ${fx.type}: left out of the SVG`);
    }
    if (!parts.length) return '';
    const id = this.id('fx');
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
    return ` filter="url(#${id})"`;
  }

  layer(L: EvaluatedLayer, compId: string, t: number): string {
    if (L.transform.opacity <= 0) return '';
    if (isTilted(L.transform) || L.effects.some((e) => e.type === 'fx.pin')) this.warn(`"${L.layer.name ?? L.id}" is turned or pinned in perspective: drawn flat in SVG`);
    let clip = '';
    if (L.clip) {
      const id = this.id('c');
      this.defs.push(`<clipPath id="${id}"><g transform="${matrix(L.clip.transform)}">${this.content(L.clip, compId, t)}</g></clipPath>`);
      clip = ` clip-path="url(#${id})"`;
    }
    const style = L.layer.blend && BLEND[L.layer.blend] ? ` style="mix-blend-mode:${BLEND[L.layer.blend]}"` : '';
    const op = L.transform.opacity < 1 ? ` opacity="${n(L.transform.opacity)}"` : '';
    const inner = `<g transform="${matrix(L.transform)}">${this.content(L, compId, t)}${L.children.map((c) => this.layer(c, compId, t)).join('')}</g>`;
    const name = esc(L.layer.name ?? L.id);
    return `<g id="${esc(L.id)}" data-name="${name}"${clip}${op}${style}${this.filter(L)}>${inner}</g>`;
  }

  composition(compId: string, t: number, root: boolean): string {
    const f = this.ev.frame(t, compId);
    const c = f.comp;
    const bg = f.background ? `<rect width="${c.width}" height="${c.height}" ${colorAttrs(f.background, 'fill')}/>` : '';
    if (root && f.motionBlur.samples > 1) this.warn('motion blur: not shown in a vector image');
    if (root && f.effects.length) this.warn('finishing effects (grain, glow, vignette): not shown in SVG');
    return bg + f.layers.map((L) => this.layer(L, compId, t)).join('');
  }
}

/** one frame of a composition as an SVG document */
export function toSvg(doc: TrammeDoc, registry: Registry, t: number, opts: SvgOptions = {}): { svg: string; warnings: string[] } {
  const compId = opts.compId ?? doc.root;
  const c = doc.compositions[compId];
  const w = new SvgWriter(doc, registry, opts);
  const body = w.composition(compId, t, true);
  const fonts = [...w.fonts].map((id) => {
    const a = doc.assets[id], file = opts.readAsset?.(id);
    if (!file) return '';
    return `@font-face{font-family:"${esc(a.family || id)}";src:url(data:${file.mime};base64,${b64(file.data)});font-weight:${a.weight || '400'};font-style:${a.style || 'normal'};}`;
  }).join('');
  const defs = `${fonts ? `<style>${fonts}</style>` : ''}${w.defs.join('')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;
  return { svg, warnings: w.warnings };
}

// ── reading SVG into paths ──────────────────────────────────────────────────
// The inverse of pathData: an SVG's shapes (path, circle, ellipse, rect,
// line, polyline, polygon, with their transforms and their groups'
// presentation attributes) become PathValues, one per contour, with their
// fills and strokes. Arcs become cubic Béziers. Gradients and images are
// left out and reported. Lean on purpose: logos and icons, not the whole
// specification.

export interface SvgShape {
  /** one contour, in the SVG's own coordinates */
  path: PathValue;
  /** CSS colour, or null for none (a gradient is left out and reported) */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
  /** the element's id, when it carries one */
  id?: string;
}

export interface SvgRead {
  shapes: SvgShape[];
  /** the size the width/height or the viewBox gives, in px (1 = 1) */
  width: number;
  height: number;
  warnings: string[];
}

type Mat = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function matMul(m: Mat, k: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m, [a2, b2, c2, d2, e2, f2] = k;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

function apply(m: Mat, p: [number, number]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

function applyVec(m: Mat, v: [number, number]): [number, number] {
  return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
}

/** a transform attribute as one matrix, the functions applied right to left as SVG reads them */
function parseTransform(s: string): Mat {
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const [, name, raw] of s.matchAll(re)) {
    const v = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    let f: Mat = IDENTITY;
    if (name === 'matrix' && v.length >= 6) f = [v[0], v[1], v[2], v[3], v[4], v[5]];
    else if (name === 'translate') f = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (name === 'scale') f = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      f = [cos, sin, -sin, cos, 0, 0];
      if (v.length >= 3) f = matMul(matMul([1, 0, 0, 1, v[1], v[2]], f), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (name === 'skewX') f = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewY') f = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = matMul(f, m); // the list reads left to right, the rightmost applies first
  }
  return m;
}

const r3 = (x: number) => (Math.round(x * 1000) / 1000) + 0; // + 0 turns a minus zero back

/**
 * An SVG path's d attribute into contours: M m Z z L l H h V v C c S s Q q T t
 * A a, with the commands' implicit repetition, arcs as cubic Béziers (the
 * SVG specification's endpoint to centre, split under 90°), one PathValue
 * per contour, tangents relative to their vertex.
 */
export function parsePathData(d: string): PathValue[] {
  const tokens = d.match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: PathValue[] = [];
  let cur: PathValue | null = null;
  let cx = 0, cy = 0; // the current point
  let sx = 0, sy = 0; // the contour's start (Z returns there)
  let lastC: [number, number] | null = null, lastQ: [number, number] | null = null; // the last cubic/quad control, for S and T
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  // an arc's flag is one digit, often written against what follows (a1 1 0 012 2): the rest of the token stays for the next read
  const flag = () => {
    const t = tokens[i] ?? '';
    if (t.length <= 1 || !/^[01]/.test(t)) { i++; return Number(t); }
    tokens[i] = t.slice(1);
    return Number(t[0]);
  };
  const rel = (v: number, base: number) => (cmd === cmd.toLowerCase() ? base + v : v);
  const startContour = (x: number, y: number) => {
    cur = { v: [[r3(x), r3(y)]], closed: false };
    out.push(cur);
    sx = x; sy = y;
    cx = x; cy = y;
  };
  const point = (x: number, y: number, o?: [number, number], tin?: [number, number]) => {
    if (!cur) startContour(cx, cy);
    cx = x; cy = y;
    cur!.v.push([r3(x), r3(y)]);
    const n = cur!.v.length;
    // the out tangent belongs to the vertex the curve leaves (n - 2), the in tangent to the one it reaches (n - 1);
    // a zero tangent is left out, so a curve with one flat side keeps the arrays short
    if (o && (o[0] || o[1])) { const os = (cur!.o ??= []); while (os.length < n - 2) os.push([0, 0]); os[n - 2] = [r3(o[0]), r3(o[1])]; }
    if (tin && (tin[0] || tin[1])) { const ins = (cur!.i ??= []); while (ins.length < n - 1) ins.push([0, 0]); ins.push([r3(tin[0]), r3(tin[1])]); }
  };
  while (i < tokens.length) {
    const t = tokens[i];
    const letter = /[A-Za-z]/.test(t);
    if (letter) { cmd = t; i++; }
    const upper = cmd.toUpperCase(), isRel = cmd !== upper;
    if (upper === 'M') {
      const x = rel(num(), cx), y = rel(num(), cy);
      if (cur) { cur = null; lastC = lastQ = null; }
      startContour(x, y);
      cmd = isRel ? 'l' : 'L'; // a move's following pairs are lines
    } else if (upper === 'L') {
      const x = rel(num(), cx), y = rel(num(), cy);
      lastC = lastQ = null;
      point(x, y);
    } else if (upper === 'H') {
      const x = rel(num(), cx);
      lastC = lastQ = null;
      point(x, cy);
    } else if (upper === 'V') {
      const y = rel(num(), cy);
      lastC = lastQ = null;
      point(cx, y);
    } else if (upper === 'C') {
      const c1: [number, number] = [rel(num(), cx), rel(num(), cy)];
      const c2: [number, number] = [rel(num(), cx), rel(num(), cy)];
      const x = rel(num(), cx), y = rel(num(), cy);
      if (!cur) startContour(cx, cy);
      point(x, y, [c1[0] - cx, c1[1] - cy], [c2[0] - x, c2[1] - y]);
      lastC = c2; lastQ = null;
    } else if (upper === 'S') {
      const c1: [number, number] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
      const c2: [number, number] = [rel(num(), cx), rel(num(), cy)];
      const x = rel(num(), cx), y = rel(num(), cy);
      if (!cur) startContour(cx, cy);
      point(x, y, [c1[0] - cx, c1[1] - cy], [c2[0] - x, c2[1] - y]);
      lastC = c2; lastQ = null;
    } else if (upper === 'Q') {
      const q: [number, number] = [rel(num(), cx), rel(num(), cy)];
      const x = rel(num(), cx), y = rel(num(), cy);
      if (!cur) startContour(cx, cy);
      // the quadratic elevated to a cubic
      const c1: [number, number] = [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)];
      const c2: [number, number] = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
      point(x, y, [c1[0] - cx, c1[1] - cy], [c2[0] - x, c2[1] - y]);
      lastQ = q; lastC = null;
    } else if (upper === 'T') {
      const q: [number, number] = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
      const x = rel(num(), cx), y = rel(num(), cy);
      if (!cur) startContour(cx, cy);
      const c1: [number, number] = [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)];
      const c2: [number, number] = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
      point(x, y, [c1[0] - cx, c1[1] - cy], [c2[0] - x, c2[1] - y]);
      lastQ = q; lastC = null;
    } else if (upper === 'A') {
      const rx0 = num(), ry0 = num(), rot = num(), large = flag(), sweep = flag();
      const x = rel(num(), cx), y = rel(num(), cy);
      arcToCubics(cx, cy, rx0, ry0, rot, large === 1, sweep === 1, x, y).forEach((cu) => {
        if (!cur) startContour(cx, cy);
        point(cu[3][0], cu[3][1], [cu[1][0] - cu[0][0], cu[1][1] - cu[0][1]], [cu[2][0] - cu[3][0], cu[2][1] - cu[3][1]]);
      });
      lastC = lastQ = null;
    } else if (upper === 'Z') {
      // a number after Z repeats nothing (the path is malformed there): skipped, never read again
      if (!letter) { i++; continue; }
      const c = cur as PathValue | null;
      if (c) { c.closed = true; cur = null; }
      cx = sx; cy = sy;
      lastC = lastQ = null;
    } else {
      // a bare number after M/L/etc.: the command repeats (M becomes L, done above)
      i++;
    }
  }
  return out.filter((p) => p.v.length >= 2);
}

/** an elliptical arc as cubics, its ends (x1,y1) → (x2,y2), by the SVG specification's appendix */
function arcToCubics(x1: number, y1: number, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): [[number, number], [number, number], [number, number], [number, number]][] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0), ry = Math.abs(ry0);
  if (!rx || !ry) return [[[x1, y1], [x1, y1], [x2, y2], [x2, y2]]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = large !== sweep ? 1 : -1;
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = Math.max(0, (rx * rx * ry * ry - denom) / denom);
  const cpx = (sign * Math.sqrt(co) * rx * y1p) / ry, cpy = (-sign * Math.sqrt(co) * ry * x1p) / rx;
  const cx = cos * cpx - sin * cpy + (x1 + x2) / 2, cy = sin * cpx + cos * cpy + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cpx) / rx, (y1p - cpy) / ry);
  let dth = ang((x1p - cpx) / rx, (y1p - cpy) / ry, (-x1p - cpx) / rx, (-y1p - cpy) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2));
  const delta = dth / n;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out: [[number, number], [number, number], [number, number], [number, number]][] = [];
  let t = th1;
  const at = (a: number): [number, number] => [cos * rx * Math.cos(a) - sin * ry * Math.sin(a) + cx, sin * rx * Math.cos(a) + cos * ry * Math.sin(a) + cy];
  const der = (a: number): [number, number] => [-cos * rx * Math.sin(a) - sin * ry * Math.cos(a), -sin * rx * Math.sin(a) + cos * ry * Math.cos(a)];
  let p0 = at(t);
  for (let s = 0; s < n; s++) {
    const t2 = t + delta, p3 = at(t2), d1 = der(t), d2 = der(t2);
    out.push([p0, [p0[0] + k * d1[0], p0[1] + k * d1[1]], [p3[0] - k * d2[0], p3[1] - k * d2[1]], p3]);
    t = t2; p0 = p3;
  }
  return out;
}

/** the presentation of an element: its attributes and inline style over its groups' */
interface Present { fill?: string; stroke?: string; 'stroke-width'?: string; 'stroke-linecap'?: string; 'stroke-linejoin'?: string; opacity?: string; 'fill-opacity'?: string; 'stroke-opacity'?: string; display?: string }

const SKIP = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern', 'marker', 'style', 'script', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'filter']);
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z-:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  return out;
}

/** an SVG document into shapes: one contour each, their transforms applied, their groups' presentation inherited */
export function readSvg(text: string): SvgRead {
  const warnings: string[] = [];
  const say = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const svgTag = clean.match(/<svg[^>]*>/i)?.[0] ?? '';
  const num = (s: string | undefined, dflt: number): number => {
    const v = Number.parseFloat(String(s ?? '').replace(/[a-z%]+$/i, ''));
    return Number.isFinite(v) ? v : dflt;
  };
  // the root's own attributes (stroke-width is not width); a size in % says nothing of the drawing's size
  const rootAttrs = attrsOf(svgTag.replace(/^<svg/i, ''));
  const sized = (s: string | undefined) => (s && !s.trim().endsWith('%') ? num(s, NaN) : NaN);
  let width = sized(rootAttrs.width), height = sized(rootAttrs.height);
  const vbList = (rootAttrs.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
  const vb = vbList.length === 4 && vbList.every(Number.isFinite) && vbList[2] > 0 && vbList[3] > 0 ? vbList : null;
  if (vb) {
    if (!Number.isFinite(width) && !Number.isFinite(height)) { width = vb[2]; height = vb[3]; }
    else if (!Number.isFinite(width)) width = (height * vb[2]) / vb[3];
    else if (!Number.isFinite(height)) height = (width * vb[3]) / vb[2];
  } else if (!Number.isFinite(width) || !Number.isFinite(height)) {
    width = Number.isFinite(width) ? width : 100;
    height = Number.isFinite(height) ? height : 100;
  }
  // the viewBox into the size, as the default preserveAspectRatio does (uniform, centred)
  let rootM: Mat = IDENTITY;
  if (vb && (vb[0] || vb[1] || vb[2] !== width || vb[3] !== height)) {
    const s = Math.min(width / vb[2], height / vb[3]);
    rootM = [s, 0, 0, s, (width - vb[2] * s) / 2 - vb[0] * s, (height - vb[3] * s) / 2 - vb[1] * s];
  }
  const shapes: SvgShape[] = [];
  // the open elements: each with its presentation and its matrix; anything under a skipped container is ignored
  const stack: { tag: string; pres: Present; m: Mat; skip: boolean }[] = [{ tag: '#root', pres: {}, m: rootM, skip: false }];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (const [, close, rawTag, rawAttrs, selfClose] of clean.matchAll(tagRe)) {
    const tag = rawTag.toLowerCase();
    if (close) {
      let at = stack.length - 1;
      while (at > 0 && stack[at].tag !== tag) at--;
      if (at > 0) stack.length = at; // pop to the matching open (stray closes dropped)
      continue;
    }
    const top = stack[stack.length - 1];
    if (top.skip) { if (!selfClose && !SKIP.has(tag) && !SHAPES.has(tag) && tag !== 'g' && tag !== 'svg' && top.tag !== tag) stack.push({ tag, pres: {}, m: IDENTITY, skip: true }); continue; }
    const own = { ...attrsOf(rawAttrs), ...styleOf(rawAttrs) };
    if (SKIP.has(tag)) { if (!selfClose) stack.push({ tag, pres: {}, m: IDENTITY, skip: true }); continue; }
    const pres: Present = { ...top.pres, ...own } as Present;
    const m = own.transform ? matMul(top.m, parseTransform(own.transform)) : top.m;
    if (tag === 'g' || tag === 'svg') { if (!selfClose) stack.push({ tag, pres, m, skip: false }); continue; }
    if (!SHAPES.has(tag) || pres.display === 'none') { if (!selfClose && !SHAPES.has(tag)) stack.push({ tag, pres: {}, m: IDENTITY, skip: true }); continue; }
    const xf = (contours: PathValue[]): PathValue[] =>
      m === IDENTITY ? contours : contours.map((p) => ({
        v: p.v.map((q) => apply(m, q).map(r3) as [number, number]),
        i: p.i?.map((q) => applyVec(m, q).map(r3) as [number, number]),
        o: p.o?.map((q) => applyVec(m, q).map(r3) as [number, number]),
        closed: p.closed,
      }));
    let contours: PathValue[] = [];
    if (tag === 'path') contours = xf(parsePathData(own.d ?? ''));
    else if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(own.cx, 0), cy = num(own.cy, 0);
      const rx = tag === 'circle' ? num(own.r, 0) : num(own.rx, 0), ry = tag === 'circle' ? num(own.r, 0) : num(own.ry, 0);
      if (rx > 0 && ry > 0) contours = xf(ellipseContours(cx, cy, rx, ry));
    } else if (tag === 'rect') {
      const x = num(own.x, 0), y = num(own.y, 0), w = num(own.width, 0), h = num(own.height, 0);
      let rx = num(own.rx, NaN), ry = num(own.ry, NaN);
      if (!Number.isFinite(rx) && !Number.isFinite(ry)) { rx = 0; ry = 0; }
      if (!Number.isFinite(rx)) rx = ry;
      if (!Number.isFinite(ry)) ry = rx;
      if (w > 0 && h > 0) contours = xf(rectContours(x, y, w, h, Math.max(0, Math.min(rx, w / 2)), Math.max(0, Math.min(ry, h / 2))));
    } else {
      const pts: [number, number][] = [];
      const parts = (own.points ?? '').split(/[\s,]+/).filter(Boolean);
      for (let k = 0; k + 1 < parts.length; k += 2) pts.push([num(parts[k], 0), num(parts[k + 1], 0)]);
      if (tag === 'line') pts.length = Math.min(pts.length, 2);
      if (pts.length >= 2) contours = xf([{ v: pts.map((q) => [r3(q[0]), r3(q[1])] as [number, number]), closed: tag === 'polygon' }]);
    }
    for (const p of contours) {
      shapes.push({
        path: p,
        fill: paintOf(pres.fill ?? '#000000', pres, 'fill', say), // SVG's fill is black unless said otherwise
        stroke: paintOf(pres.stroke, pres, 'stroke', say),
        strokeWidth: own['stroke-width'] !== undefined || pres['stroke-width'] !== undefined ? num(pres['stroke-width'], 1) : null,
        lineCap: pres['stroke-linecap'] as SvgShape['lineCap'],
        lineJoin: pres['stroke-linejoin'] as SvgShape['lineJoin'],
        id: own.id,
      });
    }
  }
  return { shapes, width, height, warnings };
}

function styleOf(tag: string): Record<string, string> {
  const m = tag.match(/\bstyle\s*=\s*"([^"]*)"/);
  if (!m) return {};
  return Object.fromEntries(m[1].split(';').map((x) => x.split(':').map((y) => y.trim())).filter((x) => x.length === 2)) as Record<string, string>;
}

/** the colour of a presentation: none and references left out (reported), opacities baked in */
function paintOf(raw: string | undefined, pres: Present, which: 'fill' | 'stroke', say: (w: string) => void): string | null {
  const v = (raw ?? '').trim();
  if (!v || v === 'none' || v === 'transparent') return null;
  if (v.startsWith('url(')) { say(`a ${which} by reference (${v.slice(0, 44)}): left out`); return null; }
  const op = frac(which === 'fill' ? pres['fill-opacity'] : pres['stroke-opacity']);
  const all = frac(pres.opacity);
  const a = op * all;
  return a >= 1 ? v : withAlpha(v, a, say);
}

const frac = (s: string | undefined): number => {
  const v = Number.parseFloat(String(s ?? ''));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
};

function withAlpha(css: string, a: number, say: (w: string) => void): string {
  const parsed = parseColor(css);
  if (!parsed) { say(`the colour "${css.slice(0, 30)}" kept as written`); return css; }
  return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${Math.round(a * 1000) / 1000})`;
}

/** a centred rectangle's outline as the preview and Lottie run it: from the right side under the top right corner, clockwise */
function rectOutline(w: number, h: number, r: number): string {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const arc = (x: number, y: number) => (r > 0 ? `A${n(r)},${n(r)} 0 0 1 ${n(x)},${n(y)}` : '');
  return `M${n(x1)},${n(y0 + r)}L${n(x1)},${n(y1 - r)}${arc(x1 - r, y1)}L${n(x0 + r)},${n(y1)}${arc(x0, y1 - r)}L${n(x0)},${n(y0 + r)}${arc(x0 + r, y0)}L${n(x1 - r)},${n(y0)}${arc(x1, y0 + r)}Z`;
}

/** an ellipse as four cubic arcs, from its right point, clockwise on screen */
function ellipseContours(cx: number, cy: number, rx: number, ry: number): PathValue[] {
  const k = 0.5522847498307936; // 4/3 (√2 − 1): a quarter circle's cubic
  const ox = rx * k, oy = ry * k;
  return [{
    v: [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]],
    // o[a] leaves vertex a towards the next, i[b] arrives at vertex b from the previous
    i: [[0, -oy], [ox, 0], [0, oy], [-ox, 0]],
    o: [[0, oy], [-ox, 0], [0, -oy], [ox, 0]],
    closed: true,
  }];
}

/** a rectangle, rounded when its radius asks, clockwise from its top left corner's end */
function rectContours(x: number, y: number, w: number, h: number, rx: number, ry: number): PathValue[] {
  if (!(rx > 0 && ry > 0)) return [{ v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
  const k = 0.5522847498307936;
  const ox = rx * k, oy = ry * k;
  return [{
    v: [
      [x + rx, y], [x + w - rx, y], [x + w, y + ry], [x + w, y + h - ry],
      [x + w - rx, y + h], [x + rx, y + h], [x, y + h - ry], [x, y + ry],
    ],
    o: [[0, 0], [ox, 0], [0, 0], [0, oy], [0, 0], [-ox, 0], [0, 0], [0, -oy]],
    i: [[-ox, 0], [0, 0], [0, -oy], [0, 0], [ox, 0], [0, 0], [0, oy], [0, 0]],
    closed: true,
  }];
}
