// Parity of the scene's two paths: the page seeked to t (what an iframe preview
// shows) against the engine's alpha capture (what an export renders), by PSNR.
// Measured on the CSS/SVG prototype scene: 28.3 to 36.9 dB over six frames (Chrome 156 page, engine Chrome); the threshold leaves room for the browser versions differing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../src/browser.ts';
import { compareFiles } from '../src/compare.ts';
import { engineCapture, serveScene } from '../src/webscene.ts';

const SCENE = new URL('../../../bench/web-scenes/css-svg', import.meta.url);
const FPS = 6, FRAMES = 6, MIN_PSNR = 26;

describe.skipIf(!CHROME)('web scene preview against export', () => {
  let work: string, browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  let served: Awaited<ReturnType<typeof serveScene>>;

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-parity-'));
    const scene = path.join(work, 'scene');
    fs.cpSync(SCENE, scene, { recursive: true });
    await engineCapture({ dir: scene, entry: 'index.html', size: [320, 180], fps: FPS, frames: FRAMES, out: path.join(work, 'export'), css: '', projectDir: work, params: null });
    served = await serveScene(scene, '', work);
    ({ browser, page } = await launch());
    await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
    await page.goto(served.url);
    await page.evaluate(() => document.fonts.ready);
  }, 120_000);
  afterAll(async () => { await browser?.close(); await served?.close(); if (work) fs.rmSync(work, { recursive: true, force: true }); });

  it('stays within the PSNR threshold on every frame', async () => {
    const scores: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate((t) => (window as unknown as { __hf: { seek(t: number): void } }).__hf.seek(t), i / FPS);
      const preview = path.join(work, `preview_${i}.png`);
      await page.screenshot({ path: preview, omitBackground: true });
      scores.push(compareFiles(path.join(work, 'export', `frame_${String(i).padStart(6, '0')}.png`), preview).psnr);
    }
    expect(Math.min(...scores), `PSNR per frame: ${scores.map((s) => s.toFixed(1)).join(', ')}`).toBeGreaterThanOrEqual(MIN_PSNR);
  }, 60_000);
});
