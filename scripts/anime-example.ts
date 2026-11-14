// Builds the anime example (examples/anime), "Paper Wings": a paper plane at
// sunset, in four shots. Its drawings are made as SVG, with the slight wobble
// of a line redrawn by hand from one drawing to the next ("boil") and flat cel
// colours, turned into PNG in Chrome: cumulus clouds lit from the side, the
// plane banking, drawn frame by frame, telephone wires, a town's roofs with
// their windows lit, speed lines. The project then animates them: sequence
// layers on twos, parallax, a camera push, a low sun with its glow.
//
//   node scripts/anime-example.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyDoc, type TrammeDoc, type Layer } from '@tramme/core';
import { launch } from '../packages/cli/src/browser.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'examples', 'anime');
const W = 1920, H = 1080, FPS = 24;
const INK = '#1A1424';
const TITLE = 'Paper Wings';

type P = [number, number];
interface Drawing { folder: string; name: string; w: number; h: number; svg: string }

/** the same random numbers every run */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n = (v: number) => v.toFixed(1);
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** a hand's wobble: each drawing moves the points a little */
const boil = (r: () => number, amp: number) => (p: P): P => [p[0] + (r() - 0.5) * 2 * amp, p[1] + (r() - 0.5) * 2 * amp];
const poly = (pts: P[]) => `M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L')}Z`;
const pad = (i: number) => String(i + 1).padStart(2, '0');

// the evening's colours, shared by the drawings and the document
const C = {
  skyTop: '#2C3A78', skyHigh: '#5D4F94', skyMid: '#D9879A', skyLow: '#FFB984', horizon: '#FFE2A8',
  sun: '#FFF3D2', cloudLight: '#FFE1C6', cloudMid: '#EFA9A2', cloudShade: '#A9759B', cloudDeep: '#5F4880',
  town: '#2A2140', townRim: '#8A5E7E', window: '#FFC874', windowDark: '#3A2E55', wire: '#1D172C',
  paper: '#FBF6EE', paperShade: '#D9C8D6', paperDeep: '#9C86A8',
};

// ── cumulus: puffs in tiers, lit from the upper right, cel-shaded ──
function cloud(name: string, seed: number, w: number, h: number, tiers: number): Drawing {
  const r = rand(seed), base = h * 0.84;
  const puffs: [number, number, number][] = [];
  const low = 13;
  for (let i = 0; i < low; i++) {
    const t = i / (low - 1), dome = Math.sin(Math.PI * t);
    const rad = h * (0.09 + 0.1 * dome) + r() * h * 0.035;
    puffs.push([w * (0.08 + 0.84 * t), base - rad * 0.55 - dome * h * 0.07, rad]);
  }
  for (let k = 1; k <= tiers; k++) {
    const m = 9 - k * 2, span = 0.72 - k * 0.16;
    for (let i = 0; i < m; i++) {
      const t = (i + 0.5) / m;
      const rad = h * (0.12 - k * 0.012) + r() * h * 0.04;
      puffs.push([w * (0.52 + (t - 0.5) * span) + (r() - 0.5) * w * 0.05, base - h * (0.16 + k * 0.19) + (r() - 0.5) * h * 0.05, rad]);
    }
  }
  const circles = (dx: number, dy: number, k: number, fill: string) => puffs.map(([x, y, rad]) => `<circle cx="${n(x + dx * rad)}" cy="${n(y + dy * rad)}" r="${n(rad * k)}" fill="${fill}"/>`).join('');
  const shape = `${circles(0, 0, 1, '#000')}<ellipse cx="${n(w / 2)}" cy="${n(base - h * 0.02)}" rx="${n(w * 0.43)}" ry="${n(h * 0.07)}" fill="#000"/>`;
  let body = `<defs><clipPath id="c">${shape.replace(/fill="#000"/g, '')}</clipPath>`;
  body += `<linearGradient id="under" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${C.cloudDeep}" stop-opacity="0"/><stop offset="1" stop-color="${C.cloudDeep}" stop-opacity="0.75"/></linearGradient></defs>`;
  body += `<g clip-path="url(#c)">`;
  body += `<rect width="${w}" height="${h}" fill="${C.cloudShade}"/>`;
  // the lit sides: the same puffs moved toward the sun, a mid tone then the light
  body += circles(0.2, -0.24, 0.86, C.cloudMid);
  body += circles(0.38, -0.44, 0.66, C.cloudLight);
  body += `<rect width="${w}" height="${h}" fill="url(#under)"/>`;
  body += `</g>`;
  return { folder: 'clouds', name, w, h, svg: svg(w, h, body) };
}

// ── the plane, banking, 8 drawings ───────────────────────────
function plane(): Drawing[] {
  const w = 640, h = 360;
  return Array.from({ length: 8 }, (_, i) => {
    const r = rand(900 + i), wob = boil(r, 1.3);
    const ph = (Math.PI * 2 * i) / 8, b = 26 * Math.sin(ph), lift = 8 * Math.cos(ph);
    const N = wob([586, 168 + lift * 0.3]), Cc = wob([150, 182 + lift]);
    const far = wob([128, 84 - b * 0.6]), near = wob([78, 232 + b]), keel = wob([196, 252 + b * 0.25]);
    const stroke = `stroke="${INK}" stroke-width="5" stroke-linejoin="round"`;
    let body = '';
    body += `<path d="${poly([N, far, Cc])}" fill="${C.paperShade}" ${stroke}/>`;
    body += `<path d="${poly([N, Cc, keel])}" fill="${C.paperDeep}" ${stroke}/>`;
    body += `<path d="${poly([N, Cc, near])}" fill="${C.paper}" ${stroke}/>`;
    // the fold on the near wing, and the light catching its edge
    const fold = wob([196, 214 + b * 0.5]);
    body += `<path d="M${n(N[0] - 30)} ${n(N[1] + 4)} L${n(fold[0])} ${n(fold[1])}" stroke="${C.paperShade}" stroke-width="4" stroke-linecap="round"/>`;
    body += `<path d="M${n(N[0] - 16)} ${n(N[1] - 2)} L${n(far[0] + 60)} ${n(far[1] + 14)}" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.9"/>`;
    return { folder: 'plane', name: `plane-${pad(i)}`, w, h, svg: svg(w, h, body) };
  });
}

// ── telephone poles and their wires, 3 drawings (the line boils) ──
function wires(): Drawing[] {
  const w = 3840, h = 1080, poles = [520, 1880, 3240];
  return Array.from({ length: 3 }, (_, i) => {
    const r = rand(1200 + i), wob = boil(r, 1.6);
    let body = '';
    const arms: P[][] = poles.map((x) => [[x - 150, 214], [x + 150, 214], [x - 110, 292], [x + 110, 292]]);
    for (const x of poles) {
      const top = wob([x, 110]), foot = [x, h + 20] as P;
      body += `<path d="${poly([[top[0] - 13, top[1]], [top[0] + 13, top[1]], [foot[0] + 22, foot[1]], [foot[0] - 22, foot[1]]])}" fill="${C.wire}"/>`;
      body += `<rect x="${x - 160}" y="204" width="320" height="18" rx="4" fill="${C.wire}"/><rect x="${x - 120}" y="282" width="240" height="16" rx="4" fill="${C.wire}"/>`;
      for (const dx of [-140, -70, 70, 140]) body += `<rect x="${x + dx - 6}" y="190" width="12" height="18" rx="3" fill="${C.wire}"/>`;
      // a transformer drum on the middle pole
      if (x === 1880) body += `<rect x="${x + 18}" y="360" width="70" height="110" rx="12" fill="${C.wire}"/>`;
    }
    // the wires sag between the poles, and run out of the frame on both sides
    const sag = (a: P, z: P, depth: number) => {
      const pts: P[] = [];
      for (let k = 0; k <= 24; k++) { const t = k / 24; pts.push(wob([a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t + depth * 4 * t * (1 - t)])); }
      return `M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L')}`;
    };
    for (let k = 0; k < 4; k++) {
      const pts = [[-200, arms[0][k][1] + 40] as P, ...arms.map((a) => a[k]), [w + 200, arms[2][k][1] + 40] as P];
      for (let j = 0; j < pts.length - 1; j++) body += `<path d="${sag(pts[j], pts[j + 1], 70 + k * 8)}" fill="none" stroke="${C.wire}" stroke-width="${k < 2 ? 5 : 4}" stroke-linecap="round"/>`;
    }
    return { folder: 'wires', name: `wires-${pad(i)}`, w, h, svg: svg(w, h, body) };
  });
}

// ── the town: roofs against the sky, windows lit ─────────────
function town(): Drawing {
  const w = 3840, h = 620, r = rand(1500);
  let body = '', x = -40;
  while (x < w) {
    const bw = 140 + r() * 220, bh = 140 + r() * 330, top = h - bh, kind = r();
    const right = x + bw;
    let roof: P[];
    if (kind < 0.35) roof = [[x, top + 46], [x + bw / 2, top - 24], [right, top + 46]];
    else if (kind < 0.55) roof = [[x, top + 30], [right, top]];
    else roof = [[x, top], [right, top]];
    body += `<path d="${poly([...roof, [right, h], [x, h]])}" fill="${C.town}"/>`;
    // the sun behind: a thin warm rim along the roof line
    body += `<path d="M${roof.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L')}" fill="none" stroke="${C.townRim}" stroke-width="5" stroke-linejoin="round"/>`;
    if (kind >= 0.55 && r() < 0.5) {
      const tx = x + bw * (0.25 + r() * 0.4);
      body += `<rect x="${n(tx)}" y="${n(top - 60)}" width="56" height="44" rx="6" fill="${C.town}"/><rect x="${n(tx + 8)}" y="${n(top - 16)}" width="6" height="18" fill="${C.town}"/><rect x="${n(tx + 42)}" y="${n(top - 16)}" width="6" height="18" fill="${C.town}"/>`;
    }
    if (r() < 0.3) body += `<path d="M${n(x + bw * 0.7)} ${n(top)} L${n(x + bw * 0.7)} ${n(top - 90)} M${n(x + bw * 0.7 - 24)} ${n(top - 70)} L${n(x + bw * 0.7 + 24)} ${n(top - 70)}" stroke="${C.town}" stroke-width="4"/>`;
    for (let wy = top + 70; wy < h - 40; wy += 54) {
      for (let wx = x + 22; wx < right - 36; wx += 46) {
        if (r() < 0.15) continue;
        body += `<rect x="${n(wx)}" y="${n(wy)}" width="22" height="28" rx="2" fill="${r() < 0.32 ? C.window : C.windowDark}"/>`;
      }
    }
    x = right + (r() < 0.25 ? 20 + r() * 40 : 0);
  }
  return { folder: 'town', name: 'town', w, h, svg: svg(w, h, body) };
}

// ── speed lines, a new set every frame, 6 drawings ──────────
function speedLines(): Drawing[] {
  return Array.from({ length: 6 }, (_, i) => {
    const r = rand(700 + i);
    let body = '';
    for (let k = 0; k < 34; k++) {
      const y = r() * H, x0 = -200 + r() * 1500, len = 300 + r() * 1000, t = 2 + r() * 8;
      body += `<path d="M${n(x0)} ${n(y)} L${n(x0 + len)} ${n(y - t / 2)} L${n(x0 + len + 24)} ${n(y)} L${n(x0 + len)} ${n(y + t / 2)}Z" fill="#FFF4E4" opacity="${(0.45 + r() * 0.45).toFixed(2)}"/>`;
    }
    return { folder: 'speed-lines', name: `speed-lines-${pad(i)}`, w: W, h: H, svg: svg(W, H, body) };
  });
}

// ── rasterise in Chrome ─────────────────────────────────────
async function rasterise(drawings: Drawing[]) {
  const { browser, page } = await launch();
  try {
    await page.goto('about:blank');
    for (const d of drawings) {
      const b64: string = await page.evaluate(async (x) => {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(x.svg)))}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = x.w; c.height = x.h;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.toDataURL('image/png').split(',')[1];
      }, d);
      const file = path.join(OUT, 'assets', d.folder, `${d.name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    }
  } finally { await browser.close(); }
}

// ── the document ────────────────────────────────────────────
const ids = (ds: Drawing[]) => ds.map((d) => d.name);
const full = { position: [W / 2, H / 2] };
const sky = (stops: [number, string][]): Layer => ({ type: 'shape.rect', name: 'Sky', transform: full, props: { size: [W * 1.4, H * 1.4], fill: { type: 'linear', from: [0, -756], to: [0, 756], stops } } });
const sunAt = (x: number, y: number, size: number, glow: number): Layer => ({
  type: 'shape.ellipse', name: 'Sun', transform: { position: [x, y] }, props: { size: [size, size], fill: '@sun' },
  effects: [{ id: 'glow', type: 'fx.glow', props: { color: '@sky-low', radius: glow, strength: 3 } }],
});
/** a drawing placed at a point (or along a move), at a size; a negative size mirrors it left to right */
const img = (asset: Drawing, name: string, x: number | object, y: number, s = 1, extra: Record<string, unknown> = {}): Layer => ({
  type: 'image', name, transform: { position: typeof x === 'number' ? [x, y] : x, scale: [s, Math.abs(s)], ...((extra.transform as object) ?? {}) },
  props: { image: asset.name, size: [asset.w, asset.h], fit: 'fill' }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'transform')),
});
/** a move from one point to another over a shot */
const glide = (from: P, to: P, dur: number, ease = '@smooth') => ({ $k: [{ t: 0, v: from, ease }, { t: dur, v: to }] });
/** a few discs along the line from the sun through the middle of the frame: the lens catching it */
function flare(sx: number, sy: number, opacity: number): Record<string, Layer> {
  const out: Record<string, Layer> = {};
  [[0.35, 90, 0.16], [0.6, 40, 0.22], [0.85, 150, 0.1], [1.15, 60, 0.18]].forEach(([k, size, a], i) => {
    out[`flare${i}`] = { type: 'shape.ellipse', name: 'Flare', blend: 'add', transform: { position: [sx + (W / 2 - sx) * k * 2, sy + (H / 2 - sy) * k * 2], opacity: a * opacity }, props: { size: [size, size], fill: '#FFD9A8' }, effects: [{ id: 'soft', type: 'fx.blur', props: { radius: 6 } }] };
  });
  return out;
}

function documentOf(d: { clouds: Record<string, Drawing>; plane: Drawing[]; wires: Drawing[]; town: Drawing; lines: Drawing[] }): TrammeDoc {
  const all = [...Object.values(d.clouds), ...d.plane, ...d.wires, d.town, ...d.lines];
  const assets: TrammeDoc['assets'] = {};
  for (const x of all) assets[x.name] = { type: 'image', src: `assets/${x.folder}/${x.name}.png`, name: x.name };
  const { tower, tall, mid, small, wisp } = d.clouds;

  // shot 1: the sky at golden hour, clouds towering, the camera pushing in
  const S1 = 2.8;
  const skyShot: TrammeDoc['compositions'][string] = {
    name: 'Shot 1 · The sky', width: W, height: H, fps: FPS, duration: S1, background: '@sky-top',
    layers: {
      sky: sky([[0, '@sky-top'], [0.35, '@sky-high'], [0.66, '@sky-mid'], [0.86, '@sky-low'], [1, '@horizon']]),
      sun: sunAt(1520, 800, 230, 70),
      camera: {
        type: 'group', name: 'Camera',
        transform: { anchor: [W / 2, H / 2], position: [W / 2, H / 2], scale: { $k: [{ t: 0, v: [1, 1], ease: '@smooth' }, { t: S1, v: [1.08, 1.08] }] } },
        children: ['wisp', 'small', 'mid', 'tower'],
      },
      wisp: img(wisp, 'High cloud', glide([780, 230], [700, 230], S1), 0, 0.9, { transform: { opacity: 0.85 } }),
      small: img(small, 'Small cloud', glide([1690, 330], [1640, 330], S1), 0),
      mid: img(mid, 'Cloud', glide([420, 690], [360, 690], S1), 0),
      tower: img(tower, 'Tower cloud', glide([1150, 610], [1110, 610], S1), 0),
      ...flare(1520, 800, 1),
      dust: { type: 'particles', name: 'Light in the air', transform: { position: [W / 2, 1150] }, props: { emitter: 'rect', emitterSize: [W, 40], direction: -90, spread: 30, speed: 60, speedVar: 0.5, gravity: [0, -6], size: 4, sizeVar: 0.6, color: '#FFE8C4', life: 6, fadeOut: 0.3, rate: 18, preroll: 5, seed: 4 } },
    },
    order: ['sky', 'sun', 'camera', 'flare0', 'flare1', 'flare2', 'flare3', 'dust'],
  };

  // shot 2: the plane in flight, the clouds rushing past
  const S2 = 2.3;
  const flight: TrammeDoc['compositions'][string] = {
    name: 'Shot 2 · The flight', width: W, height: H, fps: FPS, duration: S2, background: '@sky-mid',
    layers: {
      sky: sky([[0, '@sky-high'], [0.5, '@sky-mid'], [1, '@sky-low']]),
      glow: { type: 'shape.ellipse', name: 'Sun glow', transform: { position: [2000, 760] }, props: { size: [900, 900], fill: 'rgba(255,214,160,0.55)' }, effects: [{ id: 'blur', type: 'fx.blur', props: { radius: 120 } }] },
      far: img(wisp, 'Far cloud', glide([1400, 250], [700, 250], S2, 'linear'), 0, 0.7, { transform: { opacity: 0.8 } }),
      back: img(mid, 'Cloud', glide([2300, 900], [-300, 900], S2, 'linear'), 0, 1.1),
      lines: { type: 'sequence', name: 'Speed lines', transform: { ...full, opacity: 0.32 }, props: { frames: ids(d.lines), size: [W, H], fit: 'fill', hold: 1 } },
      plane: {
        type: 'sequence', name: 'Plane',
        transform: {
          position: { $v: [980, 520], $mod: [{ type: 'wiggle', freq: 0.9, amp: 14, seed: 2 }] },
          rotation: { $v: -4, $mod: [{ type: 'wiggle', freq: 0.7, amp: 3, seed: 5 }] },
          scale: [1.7, 1.7],
        },
        props: { frames: ids(d.plane), size: [640, 360], hold: 2 },
      },
      front: img(small, 'Near cloud', glide([2600, 260], [-700, 260], S2, 'linear'), 0, 1.6, { effects: [{ id: 'blur', type: 'fx.blur', props: { radius: 10 } }] }),
      flash: { type: 'shape.rect', name: 'Flash', transform: { ...full, opacity: { $k: [{ t: 0, v: 0.85 }, { t: 0.25, v: 0 }] } }, props: { size: [W, H], fill: '#FFF6EA' } },
    },
    order: ['sky', 'glow', 'far', 'back', 'lines', 'plane', 'front', 'flash'],
  };

  // shot 3: low under the wires, the town against the sun, the plane crossing
  const S3 = 2.6;
  const wiresShot: TrammeDoc['compositions'][string] = {
    name: 'Shot 3 · The wires', width: W, height: H, fps: FPS, duration: S3, background: '@sky-low',
    layers: {
      sky: sky([[0, '@sky-high'], [0.45, '@sky-mid'], [0.8, '@sky-low'], [1, '@horizon']]),
      sun: sunAt(1240, 860, 380, 110),
      tall: img(tall, 'Cloud', glide([380, 380], [330, 380], S3), 0, 0.8, { transform: { opacity: 0.9 } }),
      town: img(d.town, 'Town', glide([2000, 790], [1820, 790], S3, 'linear'), 0),
      plane: {
        type: 'sequence', name: 'Plane',
        transform: { position: { $k: [{ t: 0.15, v: [-160, 560], ease: [0.3, 0, 0.6, 1] }, { t: S3, v: [2080, 250] }] }, rotation: -10, scale: [0.75, 0.75] },
        props: { frames: ids(d.plane), size: [640, 360], hold: 2, offset: 3 },
      },
      wires: { type: 'sequence', name: 'Wires', transform: { position: glide([1700, 540], [1100, 540], S3, 'linear') }, props: { frames: ids(d.wires), size: [3840, 1080], fit: 'fill', hold: 2 } },
      ...flare(1240, 860, 0.8),
    },
    order: ['sky', 'sun', 'tall', 'town', 'plane', 'wires', 'flare0', 'flare1', 'flare2', 'flare3'],
  };

  // shot 4: wide, the plane flying into the sun, the title
  const S4 = 2.8;
  const sunset: TrammeDoc['compositions'][string] = {
    name: 'Shot 4 · The sun', width: W, height: H, fps: FPS, duration: S4, background: '@sky-low',
    layers: {
      sky: sky([[0, '@sky-top'], [0.4, '@sky-high'], [0.7, '@sky-mid'], [0.9, '@sky-low'], [1, '@horizon']]),
      sun: sunAt(960, 790, 440, 150),
      left: img(tower, 'Tower cloud', glide([300, 430], [270, 430], S4), 0, 0.85),
      right: img(tall, 'Cloud', glide([1640, 520], [1670, 520], S4), 0, -1),
      town: img(d.town, 'Town', [1500, 960], 0, 0.55),
      plane: {
        type: 'sequence', name: 'Plane',
        transform: {
          position: { $k: [{ t: 0, v: [560, 470], ease: [0.25, 0, 0.4, 1] }, { t: S4, v: [930, 760] }] },
          scale: { $k: [{ t: 0, v: [0.9, 0.9], ease: [0.25, 0, 0.4, 1] }, { t: S4, v: [0.1, 0.1] }] },
          rotation: 8,
        },
        props: { frames: ids(d.plane), size: [640, 360], hold: 2, offset: 5 },
      },
      title: {
        type: 'text', name: 'Title', in: 0.9,
        transform: {
          position: { $k: [{ t: 0.9, v: [1780, 190], ease: '@snappy' }, { t: 1.6, v: [1780, 170] }] },
          opacity: { $k: [{ t: 0.9, v: 0 }, { t: 1.5, v: 1 }] },
        },
        props: { text: TITLE, size: 120, weight: 800, tracking: -0.01, color: '@title', align: 'right' },
        effects: [{ id: 'shadow', type: 'fx.shadow', props: { color: 'rgba(40,24,70,0.45)', blur: 26, offset: [0, 10] } }],
      },
    },
    order: ['sky', 'sun', 'left', 'right', 'town', 'plane', 'title'],
  };

  const T = [0, S1, S1 + S2, S1 + S2 + S3, S1 + S2 + S3 + S4];
  const total = T[4];
  const shot = (comp: string, name: string, k: number): Layer => ({ type: 'comp', name, in: T[k], out: T[k + 1], transform: full, props: { comp } });
  return {
    schema: 'tramme/1',
    meta: { title: TITLE, description: 'Example anime: a paper plane at sunset in four shots, its drawings made frame by frame (clouds, the plane banking, wires, a town), animated with sequences, parallax and a camera push.' },
    tokens: {
      'sky-top': { type: 'color', value: C.skyTop }, 'sky-high': { type: 'color', value: C.skyHigh }, 'sky-mid': { type: 'color', value: C.skyMid },
      'sky-low': { type: 'color', value: C.skyLow }, horizon: { type: 'color', value: C.horizon }, sun: { type: 'color', value: C.sun },
      title: { type: 'color', value: '#FFF4E2' }, ink: { type: 'color', value: INK },
      smooth: { type: 'ease', value: [0.42, 0, 0.58, 1] }, snappy: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    },
    assets,
    root: 'anime',
    compositions: {
      anime: {
        name: TITLE, width: W, height: H, fps: FPS, duration: total, background: '@sky-top',
        motionBlur: { samples: 4, shutter: 0.5 },
        markers: [
          { id: 'sky', t: T[0], label: 'The sky', kind: 'scene' },
          { id: 'flight', t: T[1], label: 'The flight', kind: 'cut' },
          { id: 'wires', t: T[2], label: 'The wires', kind: 'cut' },
          { id: 'sun', t: T[3], label: 'The sun', kind: 'cut' },
        ],
        effects: [
          { id: 'vignette', type: 'look.vignette', props: { amount: 0.24 } },
          { id: 'bloom', type: 'look.bloom', props: { amount: 0.22, threshold: 0.8 } },
          { id: 'grain', type: 'look.grain', props: { amount: 0.02, seed: { $expr: 'frame + 1' } } },
        ],
        layers: {
          shot1: shot('sky', 'Shot 1 · The sky', 0),
          shot2: shot('flight', 'Shot 2 · The flight', 1),
          shot3: shot('wires', 'Shot 3 · The wires', 2),
          shot4: shot('sun', 'Shot 4 · The sun', 3),
          fade: { type: 'shape.rect', name: 'Fade', transform: { ...full, opacity: { $k: [{ t: 0, v: 1 }, { t: 0.5, v: 0 }, { t: total - 0.6, v: 0 }, { t: total, v: 1 }] } }, props: { size: [W, H], fill: '#000000' } },
        },
        order: ['shot1', 'shot2', 'shot3', 'shot4', 'fade'],
      },
      sky: skyShot, flight, wires: wiresShot, sun: sunset,
    },
  } as TrammeDoc;
}

const drawings = {
  clouds: {
    tower: cloud('cloud-tower', 31, 1500, 980, 3),
    tall: cloud('cloud-tall', 47, 1100, 760, 2),
    mid: cloud('cloud-mid', 53, 1000, 480, 1),
    small: cloud('cloud-small', 67, 640, 300, 1),
    wisp: cloud('cloud-wisp', 71, 900, 260, 0),
  },
  plane: plane(), wires: wires(), town: town(), lines: speedLines(),
};
fs.rmSync(path.join(OUT, 'assets'), { recursive: true, force: true });
await rasterise([...Object.values(drawings.clouds), ...drawings.plane, ...drawings.wires, drawings.town, ...drawings.lines]);
const doc = documentOf(drawings);
fs.writeFileSync(path.join(OUT, 'document.tramme.json'), stringifyDoc({ $schema: '../../schema/tramme-1.schema.json', ...doc }));
const now = new Date().toISOString();
const manifestFile = path.join(OUT, 'tramme.json');
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const created = previous.created ?? now;
// the thumbnail made by scripts/example-thumbnails.ts is kept
const thumbnail = previous.thumbnail && fs.existsSync(path.join(OUT, previous.thumbnail)) ? { thumbnail: previous.thumbnail } : {};
fs.writeFileSync(manifestFile, JSON.stringify({ format: 'tramme-project/1', id: 'example-anime', name: TITLE, created, modified: now, width: W, height: H, duration: doc.compositions.anime.duration, ...thumbnail }, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(doc.assets).length} drawings`);
