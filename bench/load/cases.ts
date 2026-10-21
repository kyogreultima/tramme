// Load cases (docs/performance-roadmap.md, step 1): documents that each push
// one part of a frame, rendered by `tramme load` to tell whether the
// JavaScript, the GPU, video decoding or the transfer is the bottleneck.
// They are built here rather than kept as JSON: hundreds of layers, and a 4K
// source made by ffmpeg on the machine instead of a file in the repository.

import type { Composition, Layer, Prop, TrammeDoc, Vec2 } from '@tramme/core';

export interface LoadCase {
  id: string;
  /** what the case pushes, and the part of a frame it should weigh on */
  title: string;
  doc: TrammeDoc;
  /** media the document points to, made by ffmpeg before rendering: path relative to the document -> ffmpeg arguments writing it */
  media?: Record<string, string[]>;
}

const W = 1920, H = 1080, FPS = 30, DURATION = 2;

const comp = (name: string, layers: Record<string, Layer>, extra: Partial<Composition> = {}): Composition => ({
  name, width: W, height: H, fps: FPS, duration: DURATION, background: '#101216',
  layers, order: Object.keys(layers).filter((id) => !Object.values(layers).some((l) => l.children?.includes(id))),
  ...extra,
});

const doc = (title: string, main: Composition, assets: TrammeDoc['assets'] = {}): TrammeDoc => ({
  schema: 'tramme/1', meta: { title }, tokens: {}, assets, root: 'main', compositions: { main },
});

/** a value that runs from a to b over the case */
const ramp = <T>(a: T, b: T) => ({ $k: [{ t: 0, v: a }, { t: DURATION, v: b }] });

/** a small, stable pseudo-random sequence: the same case on every machine */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const PALETTE = ['#2EC4B6', '#FF4F79', '#FFC857', '#F4F5F7', '#5B8CFF'];

/** 400 animated shapes: the Evaluator and Canvas 2D calls, many small ones */
function manyLayers(): LoadCase {
  const r = rand(1), layers: Record<string, Layer> = {};
  for (let i = 0; i < 400; i++) {
    const x = r() * W, y = r() * H, s = 20 + r() * 80;
    layers[`s${i}`] = {
      type: i % 2 ? 'shape.ellipse' : 'shape.rect',
      transform: { position: ramp([x, y], [x + (r() - 0.5) * 400, y + (r() - 0.5) * 300]), rotation: ramp(0, (r() - 0.5) * 360), opacity: 0.8 },
      props: { size: [s, s], fill: PALETTE[i % PALETTE.length] },
    };
  }
  return { id: 'layers', title: '400 animated shapes (JavaScript: evaluation and drawing)', doc: doc('Load: many layers', comp('Many layers', layers)) };
}

/** blurs, shadows and glows on 20 layers, the look of the composition, motion blur: Canvas 2D filters and the GPU's finish */
function effects(): LoadCase {
  const r = rand(2), layers: Record<string, Layer> = {};
  for (let i = 0; i < 20; i++) {
    const x = r() * W, y = r() * H;
    layers[`fx${i}`] = {
      type: 'shape.ellipse',
      transform: { position: ramp([x, y], [x + (r() - 0.5) * 600, y]) },
      props: { size: [120, 120], fill: PALETTE[i % PALETTE.length] },
      effects: [
        { id: 'blur', type: 'fx.blur', props: { radius: ramp(0, 24) } },
        { id: 'shadow', type: 'fx.shadow', props: { blur: 30, offset: [0, 16] } },
        { id: 'glow', type: 'fx.glow', props: { radius: 18, strength: 2 } },
      ],
    };
  }
  const main = comp('Effects', layers, {
    motionBlur: { samples: 4, shutter: 0.5 },
    effects: [
      { id: 'bloom', type: 'look.bloom', props: { amount: 0.3, threshold: 0.7 } },
      { id: 'chroma', type: 'look.chromatic', props: { amount: 2 } },
      { id: 'vignette', type: 'look.vignette', props: { amount: 0.25 } },
      { id: 'grain', type: 'look.grain', props: { amount: 0.02 } },
    ],
  });
  return { id: 'effects', title: '20 layers with blur, shadow and glow, a look and motion blur (Canvas 2D filters, the GPU)', doc: doc('Load: blurs and effects', main) };
}

const SOURCE_4K = 'media/source-4k.webm';
/**
 * a 4K test picture, a keyframe a second, long enough for two shots 4 s apart;
 * VP9, which every Chromium decodes (the open builds the tests run on have no H.264)
 */
const source4k = (): Record<string, string[]> => ({
  [SOURCE_4K]: ['-f', 'lavfi', '-i', `testsrc2=size=3840x2160:rate=${FPS}:duration=${DURATION + 5}`, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '20M', '-pix_fmt', 'yuv420p', '-g', String(FPS)],
});

/** a 4K VP9 source drawn into a 1080p frame: video decoding */
function video4k(): LoadCase {
  const src = SOURCE_4K;
  const main = comp('4K source', {
    clip: { type: 'video', transform: { position: [W / 2, H / 2] }, props: { video: 'source', size: [W, H], fit: 'cover', muted: true } },
  });
  return {
    id: 'video4k', title: 'a 4K video decoded and drawn (video decoding)',
    doc: doc('Load: a 4K source video', main, { source: { type: 'video', src } }),
    media: source4k(),
  };
}

/** a crossfade between two shots of one 4K take, 4 s apart in the file: two layers reading one file at two moments */
function crossfade4k(): LoadCase {
  const shot = (start: number, opacity: Prop<number>): Layer => ({
    type: 'video', transform: { position: [W / 2, H / 2], opacity }, props: { video: 'source', start, size: [W, H], fit: 'cover', muted: true },
  });
  const main = comp('Crossfade', { first: shot(0, 1), second: shot(4, ramp(0, 1)) });
  return {
    id: 'crossfade4k', title: 'a crossfade between two shots of one 4K file (video decoding, two play positions)',
    doc: doc('Load: a crossfade within one 4K file', main, { source: { type: 'video', src: SOURCE_4K } }),
    media: source4k(),
  };
}

/** particles, cloth, a rope and a flock stepped every frame: the simulations' JavaScript */
function simulation(): LoadCase {
  const main = comp('Simulation', {
    sparks: { type: 'particles', transform: { position: [W / 2, H * 0.8] }, props: { rate: 2000, life: 1.5, speed: 700, spread: 80, size: 4, preroll: 1, seed: 7 } },
    cloth: { type: 'cloth', transform: { position: [W * 0.25, H * 0.3] }, props: { columns: 48, rows: 48, width: 600, height: 500, stiffness: 8 } },
    rope: { type: 'rope', transform: { position: [W * 0.75, H * 0.15] }, props: { segments: 64, length: 600, wind: 400 } },
    flock: { type: 'flock', transform: { position: [W / 2, H / 2] }, props: { count: 400 } },
  });
  return { id: 'simulation', title: 'particles, cloth, a rope and a flock (the simulations’ JavaScript)', doc: doc('Load: simulations', main) };
}

/** every load case, in the order they are run */
/**
 * A card component (a plate, a dot, a bar, their entrance) placed 400 times
 * by one distribution, its colour from the palette, played as a ripple by a
 * time field, a wiggle smoothed on the dot: the Evaluator for many
 * instances (docs/performance-roadmap.md, step 3)
 */
function instances(): LoadCase {
  const enter = (a: unknown, b: unknown) => ({ $k: [{ t: 0, v: a, ease: [0.16, 1, 0.3, 1] }, { t: 0.6, v: b }] }) as { $k: { t: number; v: never }[] };
  const card: Composition = {
    name: 'Card', width: 80, height: 48, fps: FPS, duration: DURATION, background: null,
    params: { color: { type: 'paint', targets: ['plate.fill'] } },
    layers: {
      plate: { type: 'shape.rect', transform: { position: [40, 24], scale: enter([0.4, 0.4], [1, 1]), opacity: enter(0, 1) }, props: { size: [72, 40], radius: 8, fill: '#FFFFFF' } },
      dot: { type: 'shape.ellipse', transform: { position: { ...enter([20, 24], [60, 24]), $mod: [{ type: "wiggle", freq: 1.5, amp: 3 }, { type: "smooth", window: 0.2 }] } as Prop<Vec2>, opacity: enter(0, 1) }, props: { size: [12, 12], fill: '#101216' } },
      bar: { type: 'shape.rect', transform: { position: [40, 36] }, props: { size: enter([0, 4], [56, 4]), fill: '#101216' } },
    },
    order: ['plate', 'dot', 'bar'],
  };
  const main = comp('Many instances', {
    grid: {
      type: 'comp', transform: { position: [W / 2, H / 2] }, props: { comp: 'card', crop: false },
      distribute: { count: 400, layout: { type: 'grid', columns: 25, spacing: [76, 66] }, params: { color: { $palette: 'random', colors: PALETTE } }, time: { mode: 'distance', amount: 1.2 } },
    },
  });
  return { id: 'instances', title: '400 instances of a component, a time field over them (the Evaluator for many instances)', doc: { ...doc('Load: many instances', main), compositions: { main, card } } };
}

export const loadCases = (): LoadCase[] => [manyLayers(), effects(), video4k(), crossfade4k(), simulation(), instances()];
