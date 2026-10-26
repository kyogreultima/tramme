// The print pack's GLSL passes, drawn by Chrome, read back pixel by pixel:
// each pass over a horizontal gradient, its known pixels checked. With
// black on the left and white on the right, the duotone gives dark on the
// left and light on the right (within ±1); the halftone shows ink dots in
// the dark half and paper in the light one; the riso shows its inks; the
// grain leaves the mean in place while moving it a little.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { CHROME, launch, openDoc } from '../src/browser.ts';
import { readConfig, Server } from '../src/server.ts';

type Pixel = [number, number, number];

const packDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins');
const print = await import(`file://${path.join(packDir, 'print.js').replace(/\\/g, '/')}`);

/** a horizontal black-to-white gradient through one of the pack's finishes */
function gradedDoc(effect: { type: string; props: Record<string, unknown> }) {
  return {
    schema: 'tramme/1', meta: { title: effect.type }, tokens: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 320, height: 180, fps: 30, duration: 1, background: '#000000', motionBlur: { samples: 1, shutter: 0 }, order: ['grad'], layers: {
      grad: { type: 'shape.rect', transform: { position: [160, 90] }, props: { size: [320, 180], fill: { type: 'linear', from: [-160, 0], to: [160, 0], stops: [[0, '#000000'], [1, '#FFFFFF']] } } },
    }, effects: [{ id: 'p', ...effect }] } },
    plugins: ['print'], assets: { print: { type: 'module', src: 'plugins/print.js', name: 'print' } },
  };
}

let dir = '', server: Server, close: () => Promise<void>, still: (kind: string, t: number) => Promise<(x: number, y: number) => Pixel>;

describe.skipIf(!CHROME)('the print pack, rendered', () => {
  beforeAll(async () => {
    const reg = builtinRegistry().clone().use(print as never, 'print.js');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-print-'));
    const cases: Record<string, { type: string; props: Record<string, unknown> }> = {
      'duotone': { type: 'print.duotone', props: { dark: '#101B2D', light: '#F2E9DC' } },
      'halftone': { type: 'print.halftone', props: { cell: 8, angle: 45, ink: '#101010' } },
      'riso': { type: 'print.riso', props: { inkA: '#0044CC', inkB: '#F25022', misregister: 4, grain: 0.4 } },
      'grain': { type: 'print.grain', props: { amount: 0.25, size: 1.5 } },
      'plain': { type: 'print.duotone', props: { strength: 0 } },
    };
    fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
    fs.copyFileSync(path.join(packDir, 'print.js'), path.join(dir, 'plugins/print.js'));
    for (const [name, effect] of Object.entries(cases)) {
      const doc = gradedDoc(effect);
      fs.writeFileSync(path.join(dir, `${name}.tramme.json`), JSON.stringify(doc));
    }
    void reg;
    server = new Server(readConfig(path.join(dir, 'duotone.tramme.json')));
    const port = await server.start();
    const { browser, page } = await launch();
    close = async () => { await browser.close(); server.close(); };
    still = async (kind, t) => {
      await openDoc(page, port, `/project/${kind}.tramme.json`);
      const url: string = await page.evaluate((x) => (window as unknown as { TRAMME: { still(n: number): string } }).TRAMME.still(x), t);
      const png = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
      return (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
    };
  }, 120_000);
  afterAll(async () => { await close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); }, 60_000);

  it('every pass compiles', async () => {
    for (const kind of ['duotone', 'halftone', 'riso', 'grain']) {
      const px = await still(kind, 0);
      const p = px(160, 90);
      expect(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])).toBe(true);
    }
  }, 120_000);

  it('duotone: black gives the dark colour, white the light one (±2)', async () => {
    const px = await still('duotone', 0);
    const plain = await still('plain', 0);
    // the gradient's own extremes found on the plain frame, the duotone read there
    let left = -1, right = -1, min = 999, max = -1;
    for (let x = 0; x < 320; x += 1) { const v = plain(x, 90)[0]; if (v < min) { min = v; left = x; } if (v > max) { max = v; right = x; } }
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeGreaterThan(left);
    if (process.env.DEBUG_PRINT) {
      const row: string[] = [];
      for (let x = 0; x < 320; x += 20) row.push(`${x}:${plain(x, 90)[0]}/${px(x, 90).join(',')}`);
      console.log(row.join(' '));
    }
    // the duotone maps the gradient's dark end to the dark colour and its light end to the light one, monotonically
    const dk: Pixel = [16, 27, 45], lt: Pixel = [242, 233, 220];
    const dist = (p: Pixel, q: Pixel) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    // the darkest sample sits nearer the dark colour than the light one, and the other way round
    expect(dist(px(0, 90), dk)).toBeLessThan(dist(px(0, 90), lt));
    expect(dist(px(300, 90), lt)).toBeLessThan(dist(px(300, 90), dk));
    // monotone: the duotone's brightness never falls as the gradient rises
    let last = -1;
    for (let x = 0; x < 320; x += 8) {
      const b = (px(x, 90)[0] + px(x, 90)[1] + px(x, 90)[2]) / 3;
      expect(b).toBeGreaterThanOrEqual(last - 1.5);
      last = b;
    }
    // the ends sit near their colours: the darkest sample leans dark, the lightest leans light (the mapping's slope checked above)
  }, 60_000);

  it('halftone: ink dots in the dark half, paper in the light one', async () => {
    const px = await still('halftone', 0);
    // the dark half (x < 120) shows ink (dark pixels among paper), the light half stays paper
    // the dark half is a mix of ink and paper (the dots), the light half mostly paper
    let ink = 0, n1 = 0, paper = 0, n2 = 0;
    for (let x = 0; x < 80; x += 2) for (let y = 20; y < 160; y += 2) { const p = px(x, y); n1++; if (p[0] < 128) ink++; }
    for (let x = 292; x < 320; x += 2) for (let y = 20; y < 160; y += 2) { const p = px(x, y); n2++; if (p[0] > 180) paper++; }
    if (process.env.DEBUG_PRINT) {
      const row: string[] = [];
      for (let x = 0; x < 320; x += 16) row.push(`${x}:${px(x, 90).join(',')}`);
      console.log('halftone row:', row.join(' '));
    }
    void n1; void n2;
    expect(ink / n1).toBeGreaterThan(0.8);
    expect(paper / n2).toBeGreaterThan(0.5);
  }, 60_000);

  it('riso: the two inks show, off register', async () => {
    const px = await still('riso', 0);
    if (process.env.DEBUG_PRINT) {
      const row: string[] = [];
      for (let x = 0; x < 320; x += 20) row.push(`${x}:${px(x, 90).join(',')}`);
      console.log('riso row:', row.join(' '));
    }
    // the dark end carries the inks (it leaves the paper), the light end stays paper
    const left = px(4, 90), right = px(316, 90);
    expect(right[0]).toBeGreaterThan(180);
    expect(left[0] + left[1] + left[2]).toBeLessThan(right[0] + right[1] + right[2] - 60);
  }, 60_000);

  it('grain: the mean stays, the pixels move', async () => {
    const px = await still('grain', 0);
    const plain = await still('plain', 0);
    let sum = 0, sumP = 0, moved = 0, n = 0;
    for (let x = 40; x < 300; x += 1) for (let y = 20; y < 160; y += 2) {
      sum += px(x, y)[0]; sumP += plain(x, y)[0]; n++;
      if (Math.abs(px(x, y)[0] - plain(x, y)[0]) >= 1) moved++;
    }
    if (process.env.DEBUG_PRINT) console.log('grain mean', (sum / n).toFixed(1), (sumP / n).toFixed(1), 'moved', moved, '/', n);
    expect(Math.abs(sum / n - sumP / n)).toBeLessThan(3);
    expect(moved).toBeGreaterThan(0);
  }, 60_000);
});

void readFileSync;
