// Effects drawn by Chrome, read back pixel by pixel. The transitions: a red
// shot, a blue one overlapping it from 1 s, a transition of 1 s on the blue
// one. The key: a red subject on a green screen, keyed over white.
// Contributors without Chrome skip these (CHROME_PATH points to one).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOps, detachPlan, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { CHROME, launch, openDoc } from '../src/browser.ts';
import { readConfig, Server } from '../src/server.ts';

type Pixel = [number, number, number];
const KINDS = ['crossfade', 'dip', 'push', 'slide', 'zoom', 'whip', 'luma', 'glitch'];

function doc(kind: string) {
  const full = { transform: { position: [160, 90] } };
  return {
    schema: 'tramme/1', meta: { title: kind }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 3, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['m', 'a', 'b'], layers: {
      a: { type: 'shape.rect', in: 0, out: 2, ...full, props: { size: [320, 180], fill: '#FF0000' } },
      b: { type: 'shape.rect', in: 1, out: 3, ...full, props: { size: [320, 180], fill: '#0000FF' }, effects: [{ id: 'tr', type: 'fx.transition', props: { from: 'a', kind, duration: 1, color: '#FFFFFF', map: 'm' } }] },
      // the luma wipe's picture: dark on the left
      m: { type: 'shape.rect', visible: false, ...full, props: { size: [320, 180], fill: { type: 'linear', from: [-160, 0], to: [160, 0], stops: [[0, '#000000'], [1, '#FFFFFF']] } } },
    } } },
  };
}

/** a red disc on a green screen (a little lighter at the top: a screen is never even), keyed */
function keyed(view: 'result' | 'matte', tolerance = 0.12) {
  const full = { transform: { position: [160, 90] } };
  return {
    schema: 'tramme/1', meta: { title: 'key' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#FFFFFF', motionBlur: { samples: 1, shutter: 0 }, order: ['shot'], layers: {
      shot: { type: 'group', children: ['screen', 'subject'], effects: [{ id: 'k', type: 'fx.key', props: { color: '#00B140', tolerance, view } }] },
      screen: { type: 'shape.rect', ...full, props: { size: [320, 180], fill: { type: 'linear', from: [0, -90], to: [0, 90], stops: [[0, '#10C850'], [1, '#00A038']] } } },
      subject: { type: 'shape.ellipse', ...full, props: { size: [80, 80], fill: '#D02020' } },
    } } },
  };
}

/** a blue frame over white, cut by the masks given (a disc of radius 50 at the centre, a band across the top) */
const DISC = { v: [[0, -50], [50, 0], [0, 50], [-50, 0]], i: [[-27.6, 0], [0, -27.6], [27.6, 0], [0, 27.6]], o: [[27.6, 0], [0, 27.6], [-27.6, 0], [0, -27.6]], closed: true };
const BAND = { v: [[-160, -90], [160, -90], [160, -40], [-160, -40]], closed: true };
function masked(masks: unknown[]) {
  return {
    schema: 'tramme/1', meta: { title: 'masks' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#FFFFFF', motionBlur: { samples: 1, shutter: 0 }, order: ['frame'], layers: {
      frame: { type: 'shape.rect', transform: { position: [160, 90] }, props: { size: [320, 180], fill: '#0000FF' }, masks },
    } } },
  };
}
const MASKS: Record<string, unknown[]> = {
  disc: [{ id: 'm', props: { path: DISC } }],
  hole: [{ id: 'm', props: { path: DISC, mode: 'subtract' } }],
  inverted: [{ id: 'm', props: { path: DISC, invert: true } }],
  grown: [{ id: 'm', props: { path: DISC, expansion: 20 } }],
  feathered: [{ id: 'm', props: { path: DISC, feather: 30 } }],
  // the disc and the band, then only where both are
  both: [{ id: 'a', props: { path: { v: [[-160, -90], [160, -90], [160, 90], [-160, 90]], closed: true } } }, { id: 'b', props: { path: DISC, mode: 'intersect' } }, { id: 'c', props: { path: BAND, mode: 'subtract' } }],
};

/** a red frame through a LUT that swaps red and blue, at a strength */
const SWAP_CUBE = `LUT_3D_SIZE 2\n${[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${b} ${g} ${r}`))).join('\n')}\n`;
function graded(strength: number) {
  return {
    schema: 'tramme/1', meta: { title: 'lut' }, tokens: {}, assets: { swap: { type: 'lut', src: 'swap.cube' } }, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['frame'], layers: {
      frame: { type: 'shape.rect', transform: { position: [160, 90] }, props: { size: [320, 180], fill: '#FF0000' }, effects: [{ id: 'g', type: 'fx.lut', props: { lut: 'swap', strength } }] },
    } } },
  };
}

/** a mid grey frame through tone curves */
function toned(props: Record<string, unknown>) {
  return {
    schema: 'tramme/1', meta: { title: 'curves' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['frame'], layers: {
      frame: { type: 'shape.rect', transform: { position: [160, 90] }, props: { size: [320, 180], fill: '#808080' }, effects: [{ id: 'c', type: 'fx.curves', props }] },
    } } },
  };
}

/** a frame of the colour given, through colour wheels */
function wheeled(fill: string, props: Record<string, unknown>) {
  return {
    schema: 'tramme/1', meta: { title: 'wheels' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['frame'], layers: {
      frame: { type: 'shape.rect', transform: { position: [160, 90] }, props: { size: [320, 180], fill }, effects: [{ id: 'w', type: 'fx.wheels', props }] },
    } } },
  };
}

/** a 440 Hz tone of 2 s, 16-bit mono WAV at 48 kHz */
function tone(): Buffer {
  const rate = 48000, n = rate * 2, out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return out;
}
/** the tone on a sound layer with the props given */
function voiced(props: Record<string, unknown>) {
  return {
    schema: 'tramme/1', meta: { title: 'voice' }, tokens: {}, assets: { tone: { type: 'audio', src: 'tone.wav' } }, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 2, background: '#000000', sound: { loudness: null }, order: ['s'], layers: {
      s: { type: 'audio', props: { audio: 'tone', ...props } },
    } } },
  };
}
/** the main frequency of a WAV's first channel, from 0.5 s to 1 s, by its rising zero crossings */
function frequencyOf(b64: string): number {
  const wav = Buffer.from(b64, 'base64'), channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24), data = 44;
  const at = (i: number) => wav.readInt16LE(data + i * 2 * channels);
  let n = 0;
  for (let i = rate / 2 + 1; i < rate; i++) if (at(i - 1) < 0 && at(i) >= 0) n++;
  return n / 0.5;
}

/**
 * A badge component (its colour, its size and its spin exposed, a dot linked
 * to its plate) in a scene of three instances: one with its default, one
 * animated and overridden, one starting later; and the same scene with every
 * instance detached into plain layers.
 */
function badges(): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'badges' }, tokens: { brand: { type: 'color', value: '#E03070' } }, assets: {}, root: 'main',
    compositions: {
      badge: {
        name: 'Badge', width: 120, height: 80, fps: 30, duration: 2, background: '#203040',
        params: {
          color: { type: 'color', targets: ['plate.fill'], default: '#40A0E0' },
          spin: { type: 'number', targets: ['dot.transform.rotation'] },
        },
        layers: {
          plate: { type: 'shape.rect', transform: { position: [60, 40] }, props: { size: [100, 60], radius: 12, fill: '#FFFFFF' } },
          dot: { type: 'shape.rect', transform: { position: { $k: [{ t: 0, v: [20, 40] }, { t: 1, v: [100, 40] }] }, rotation: 0 }, props: { size: [30, 30], fill: { $link: 'plate.fill' } } },
          // reaches past the frame on the right: cropped
          tail: { type: 'shape.ellipse', in: 0.5, transform: { position: [120, 70] }, props: { size: [40, 40], fill: '#F0D020' } },
        },
        order: ['plate', 'dot', 'tail'],
      },
      main: {
        name: 'Main', width: 320, height: 180, fps: 30, duration: 3, background: '#000000', motionBlur: { samples: 1, shutter: 0 },
        layers: {
          a: { type: 'comp', transform: { position: [70, 50] }, props: { comp: 'badge' } },
          b: { type: 'comp', transform: { position: [220, 60], rotation: 15, scale: [1.2, 1.2] }, props: { comp: 'badge' }, params: { color: '@brand', spin: { $k: [{ t: 0, v: 0 }, { t: 2, v: 90 }] } }, overrides: { 'plate.radius': 30 } },
          c: { type: 'comp', in: 0.4, transform: { position: [150, 140], opacity: 0.7 }, props: { comp: 'badge' } },
        },
        order: ['a', 'b', 'c'],
      },
    },
  };
}

function detachedBadges(): TrammeDoc {
  let d = badges();
  for (const id of ['a', 'b', 'c']) {
    const plan = detachPlan(d, builtinRegistry(), 'main', id);
    if ('error' in plan) throw new Error(`${id}: ${plan.error}`);
    d = applyOps(d, plan.ops).doc;
  }
  return d;
}

/**
 * Fine grey stripes (4 px) beside a red and blue edge, smoothed through a
 * mask over the left half only
 */
function smoothed(props: Record<string, unknown>) {
  const stops: [number, string][] = [];
  for (let i = 0; i <= 80; i++) stops.push([i / 80, i % 2 ? '#909090' : '#707070'], [Math.min(1, (i + 0.999) / 80), i % 2 ? '#909090' : '#707070']);
  return {
    schema: 'tramme/1', meta: { title: 'smooth' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['mask', 'face'], layers: {
      mask: { type: 'shape.rect', visible: false, transform: { position: [80, 90] }, props: { size: [160, 180], fill: '#FFFFFF' } },
      face: { type: 'group', children: ['stripes', 'red', 'blue'], effects: [{ id: 's', type: 'fx.smooth', props: { mask: 'mask', ...props } }] },
      stripes: { type: 'shape.rect', transform: { position: [160, 45] }, props: { size: [320, 90], fill: { type: 'linear', from: [-160, 0], to: [160, 0], stops } } },
      red: { type: 'shape.rect', transform: { position: [40, 135] }, props: { size: [80, 90], fill: '#FF0000' } },
      blue: { type: 'shape.rect', transform: { position: [120, 135] }, props: { size: [80, 90], fill: '#0000FF' } },
    } } },
  };
}

let dir = '', server: Server, close: () => Promise<void>, still: (kind: string, t: number) => Promise<(x: number, y: number) => Pixel>, mix: (kind: string) => Promise<string>;

describe.skipIf(!CHROME)('effects, rendered', () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-transitions-'));
    for (const k of KINDS) fs.writeFileSync(path.join(dir, `${k}.tramme.json`), JSON.stringify(doc(k)));
    fs.writeFileSync(path.join(dir, 'key.tramme.json'), JSON.stringify(keyed('result')));
    fs.writeFileSync(path.join(dir, 'swap.cube'), SWAP_CUBE);
    fs.writeFileSync(path.join(dir, 'tone.wav'), tone());
    fs.writeFileSync(path.join(dir, 'voice-pitch.tramme.json'), JSON.stringify(voiced({ voice: 'pitch', semitones: 12 })));
    fs.writeFileSync(path.join(dir, 'voice-fast.tramme.json'), JSON.stringify(voiced({ rate: 2 })));
    fs.writeFileSync(path.join(dir, 'voice-kept.tramme.json'), JSON.stringify(voiced({ rate: 2, keepPitch: true })));
    fs.writeFileSync(path.join(dir, 'voice-phone.tramme.json'), JSON.stringify(voiced({ voice: 'telephone' })));
    fs.writeFileSync(path.join(dir, 'curves-same.tramme.json'), JSON.stringify(toned({})));
    fs.writeFileSync(path.join(dir, 'wheels-same.tramme.json'), JSON.stringify(wheeled('#808080', {})));
    fs.writeFileSync(path.join(dir, 'wheels-lift.tramme.json'), JSON.stringify(wheeled('#000000', { liftLevel: 0.2 })));
    fs.writeFileSync(path.join(dir, 'wheels-gain.tramme.json'), JSON.stringify(wheeled('#808080', { gainLevel: 0.5 })));
    // the shadows toward red (the wheel's angle 0): a black frame turns red
    fs.writeFileSync(path.join(dir, 'wheels-warm.tramme.json'), JSON.stringify(wheeled('#000000', { lift: [1, 0] })));
    fs.writeFileSync(path.join(dir, 'curves-bright.tramme.json'), JSON.stringify(toned({ master: { v: [[0, 0], [0.5, 0.75], [1, 1]], closed: false } })));
    fs.writeFileSync(path.join(dir, 'curves-cast.tramme.json'), JSON.stringify(toned({ blue: { v: [[0, 0], [1, 0]], closed: false } })));
    fs.writeFileSync(path.join(dir, 'lut.tramme.json'), JSON.stringify(graded(1)));
    fs.writeFileSync(path.join(dir, 'lut-half.tramme.json'), JSON.stringify(graded(0.5)));
    for (const [name, masks] of Object.entries(MASKS)) fs.writeFileSync(path.join(dir, `mask-${name}.tramme.json`), JSON.stringify(masked(masks)));
    fs.writeFileSync(path.join(dir, 'key-matte.tramme.json'), JSON.stringify(keyed('matte')));
    fs.writeFileSync(path.join(dir, 'badges.tramme.json'), JSON.stringify(badges()));
    fs.writeFileSync(path.join(dir, 'smooth.tramme.json'), JSON.stringify(smoothed({ strength: 1, radius: 8, tolerance: 0.2 })));
    fs.writeFileSync(path.join(dir, 'smooth-off.tramme.json'), JSON.stringify(smoothed({ strength: 0 })));
    fs.writeFileSync(path.join(dir, 'badges-detached.tramme.json'), JSON.stringify(detachedBadges()));
    const row = badges();
    row.compositions.main.layers = { row: { type: 'comp', transform: { position: [160, 90] }, props: { comp: 'badge' }, distribute: { count: 3, layout: { type: 'list', spacing: 100 }, params: { color: { $palette: 'order', colors: ['#FF0000', '#00FF00', '#0000FF'] }, spin: { $expr: 'index * 45' } } } } };
    row.compositions.main.order = ['row'];
    fs.writeFileSync(path.join(dir, 'badges-row.tramme.json'), JSON.stringify(row));
    // apart, so no frame covers another
    row.compositions.main.layers.row.distribute = { ...row.compositions.main.layers.row.distribute!, layout: { type: 'list', spacing: 130 }, time: { mode: 'rank', amount: 1 } };
    fs.writeFileSync(path.join(dir, 'badges-wave.tramme.json'), JSON.stringify(row));
    server = new Server(readConfig(path.join(dir, 'crossfade.tramme.json')));
    const port = await server.start();
    const { browser, page } = await launch();
    close = async () => { await browser.close(); server.close(); };
    still = async (kind, t) => {
      await openDoc(page, port, `/project/${kind}.tramme.json`);
      const url: string = await page.evaluate((x) => (window as any).TRAMME.still(x), t);
      const png = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
      return (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
    };
    mix = async (kind) => {
      await openDoc(page, port, `/project/${kind}.tramme.json`);
      return page.evaluate(() => (window as any).TRAMME.mix(0, 2));
    };
  }, 120_000);
  afterAll(async () => { await close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  const near = (a: Pixel, b: Pixel) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
  const RED: Pixel = [255, 0, 0], BLUE: Pixel = [0, 0, 255];

  it('crossfades linearly and dips through a colour', async () => {
    expect(near((await still('crossfade', 1.5))(160, 90), [128, 0, 128])).toBe(true);
    expect(near((await still('dip', 1.5))(160, 90), [255, 255, 255])).toBe(true);
    expect(near((await still('dip', 1.25))(160, 90), [255, 128, 128])).toBe(true);
  }, 60_000);

  it('pushes the new shot in from the side its direction names, blurred along the move', async () => {
    const half = await still('push', 1.5);
    expect(near(half(20, 90), RED)).toBe(true);
    expect(near(half(300, 90), BLUE)).toBe(true);
    // the edge spread over pixels rather than a hard line
    const edge = half(160, 90);
    expect(edge[0]).toBeGreaterThan(40);
    expect(edge[2]).toBeGreaterThan(40);
  }, 60_000);

  it('opens a luma wipe where its picture is dark first', async () => {
    const f = await still('luma', 1.25);
    expect(near(f(20, 90), BLUE)).toBe(true);
    expect(near(f(300, 90), RED)).toBe(true);
  }, 60_000);

  it('shows the outgoing shot before and the incoming one after, whatever the kind', async () => {
    for (const k of KINDS) {
      expect(near((await still(k, 0.5))(160, 90), RED), `${k} before`).toBe(true);
      expect(near((await still(k, 2.5))(160, 90), BLUE), `${k} after`).toBe(true);
    }
  }, 120_000);

  it('keys a green screen out, the subject kept, the matte to judge it', async () => {
    const f = await still('key', 0.5);
    // the screen gone at the top and the bottom (light and shade alike): the white background through it
    expect(near(f(10, 5), [255, 255, 255])).toBe(true);
    expect(near(f(10, 175), [255, 255, 255])).toBe(true);
    expect(near(f(160, 90), [208, 32, 32])).toBe(true);
    const m = await still('key-matte', 0.5);
    expect(near(m(10, 5), [0, 0, 0])).toBe(true);
    expect(near(m(160, 90), [255, 255, 255])).toBe(true);
  }, 60_000);

  it('cuts a layer by its masks: added, taken away, inverted, grown, feathered, combined', async () => {
    const WHITE: Pixel = [255, 255, 255];
    const disc = await still('mask-disc', 0.5);
    expect(near(disc(160, 90), BLUE)).toBe(true);
    expect(near(disc(10, 10), WHITE)).toBe(true);
    const hole = await still('mask-hole', 0.5);
    expect(near(hole(160, 90), WHITE)).toBe(true);
    expect(near(hole(10, 10), BLUE)).toBe(true);
    const inv = await still('mask-inverted', 0.5);
    expect(near(inv(160, 90), WHITE)).toBe(true);
    expect(near(inv(10, 10), BLUE)).toBe(true);
    // 60 px from the centre: outside the disc, inside it grown by 20
    expect(near(disc(220, 90), WHITE)).toBe(true);
    expect(near((await still('mask-grown', 0.5))(220, 90), BLUE)).toBe(true);
    // feathered: its edge between the two
    const edge = (await still('mask-feathered', 0.5))(210, 90);
    expect(edge[2]).toBe(255);
    expect(edge[0]).toBeGreaterThan(30);
    expect(edge[0]).toBeLessThan(225);
    // the frame, intersected with the disc, without the band: the disc's top is gone
    const both = await still('mask-both', 0.5);
    expect(near(both(160, 90), BLUE)).toBe(true);
    expect(near(both(160, 45), WHITE)).toBe(true);
    expect(near(both(10, 170), WHITE)).toBe(true);
  }, 120_000);

  it('grades through a .cube LUT, at its strength', async () => {
    expect(near((await still('lut', 0.5))(160, 90), BLUE)).toBe(true);
    expect(near((await still('lut-half', 0.5))(160, 90), [128, 0, 128])).toBe(true);
  }, 60_000);

  it('tones through its curves: the identity by default, the master on all, a channel alone', async () => {
    expect(near((await still('curves-same', 0.5))(160, 90), [128, 128, 128])).toBe(true);
    expect(near((await still('curves-bright', 0.5))(160, 90), [191, 191, 191])).toBe(true);
    expect(near((await still('curves-cast', 0.5))(160, 90), [128, 128, 0])).toBe(true);
  }, 60_000);

  it('grades by wheels: the identity at rest, the levels, a hue in the shadows', async () => {
    expect(near((await still('wheels-same', 0.5))(160, 90), [128, 128, 128])).toBe(true);
    expect(near((await still('wheels-lift', 0.5))(160, 90), [51, 51, 51])).toBe(true);
    expect(near((await still('wheels-gain', 0.5))(160, 90), [192, 192, 192])).toBe(true);
    const warm = (await still('wheels-warm', 0.5))(160, 90);
    expect(warm[0]).toBeGreaterThan(30);
    expect(warm[1]).toBeLessThan(5);
    expect(warm[2]).toBeLessThan(5);
  }, 60_000);

  it('moves a voice’s pitch and keeps its length, the same worklet as the preview’s', async () => {
    expect(frequencyOf(await mix('voice-pitch'))).toBeCloseTo(880, -1.5);
    // twice as fast: an octave up; kept, the tone stays at 440 Hz
    expect(frequencyOf(await mix('voice-fast'))).toBeCloseTo(880, -1.5);
    expect(frequencyOf(await mix('voice-kept'))).toBeCloseTo(440, -1.5);
    // the telephone keeps the 440 Hz tone (in its band)
    expect(frequencyOf(await mix('voice-phone'))).toBeCloseTo(440, -1.5);
  }, 120_000);

  it('draws an instance and its detached copy the same', async () => {
    const d = detachedBadges();
    expect(validate(d, builtinRegistry())).toEqual([]);
    expect(Object.values(d.compositions.main.layers).some((l) => l.type === 'comp')).toBe(false);
    for (const t of [0.2, 0.7, 1.5, 2.5]) {
      const a = await still('badges', t), b = await still('badges-detached', t);
      let worst = 0, lit = 0;
      for (let y = 0; y < 180; y += 2) for (let x = 0; x < 320; x += 2) {
        const p = a(x, y), q = b(x, y);
        worst = Math.max(worst, ...p.map((v, i) => Math.abs(v - q[i])));
        if (p.some((v) => v > 0)) lit++;
      }
      expect(lit, `something drawn at ${t}`).toBeGreaterThan(1000);
      expect(worst, `at ${t}`).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  it('draws a distribution: each instance at its place, its colour from the palette', async () => {
    const f = await still('badges-row', 0.5);
    expect(near(f(60, 90), RED)).toBe(true);
    expect(near(f(160, 90), [0, 255, 0])).toBe(true);
    expect(near(f(260, 90), BLUE)).toBe(true);
    // between two badges: the black of the scene
    expect(near(f(110, 20), [0, 0, 0])).toBe(true);
  }, 60_000);

  it('plays a distribution through its time field: each instance later than the one before', async () => {
    // at 0.7 s the first badge's tail (from 0.5 s) is out, the second badge still holds its first pose
    const f = await still('badges-wave', 0.7);
    expect(near(f(85, 125), [240, 208, 32])).toBe(true);
    expect(near(f(215, 125), [32, 48, 64])).toBe(true);
    const g = await still('badges-wave', 1.7);
    expect(near(g(215, 125), [240, 208, 32])).toBe(true);
  }, 60_000);

  it('smooths the skin where its mask is, and keeps the edges', async () => {
    const on = await still('smooth', 0.5), off = await still('smooth-off', 0.5);
    // the stripes: 112 and 144 as drawn; through the mask, close to their mean; outside it, as drawn
    const spread = (f: (x: number, y: number) => Pixel, x0: number) => { let lo = 255, hi = 0; for (let x = x0; x < x0 + 16; x++) { const g = f(x, 45)[1]; lo = Math.min(lo, g); hi = Math.max(hi, g); } return hi - lo; };
    expect(spread(off, 40)).toBeGreaterThan(25);
    expect(spread(on, 40)).toBeLessThan(10);
    expect(spread(on, 240)).toBeGreaterThan(25);
    // red against blue: far apart in colour, never averaged: the edge stays where it was
    expect(near(on(77, 135), RED)).toBe(true);
    expect(near(on(83, 135), BLUE)).toBe(true);
  }, 60_000);
});
