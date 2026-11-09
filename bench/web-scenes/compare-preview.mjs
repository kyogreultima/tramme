// Compare an iframe preview seek against HyperFrames' PNG sequence for one scene.
// node bench/web-scenes/compare-preview.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-css-svg-export
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../../packages/cli/src/browser.ts';
import { compareFiles } from '../../packages/cli/src/compare.ts';
import { serveScene } from './serve.mjs';

const [sceneDir, exportDir] = process.argv.slice(2).map((p) => path.resolve(p));
if (!sceneDir || !exportDir) throw new Error('usage: compare-preview.mjs <scene-dir> <png-sequence-dir>');
const frames = fs.readdirSync(exportDir).filter((name) => /^frame_\d+\.png$/.test(name)).sort();
if (!frames.length) throw new Error(`no exported PNG frames in ${exportDir}`);
const outDir = path.resolve('.cache/roadmaps/webscene-preview');
fs.mkdirSync(outDir, { recursive: true });
const served = await serveScene(sceneDir);
const { browser, page } = await launch();
try {
  await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
  await page.goto(`${served.url}preview`);
  await page.waitForFunction(() => window.webscenePreview?.readyState === true, { timeout: 10_000 });
  const iframe = await page.$('iframe');
  const frame = await iframe.contentFrame();
  if (!frame) throw new Error('iframe preview did not load');
  const { width, height, fps } = await frame.evaluate(() => {
    const root = document.querySelector('[data-composition-id]');
    return { width: Number(root?.getAttribute('data-width')), height: Number(root?.getAttribute('data-height')), fps: Number(root?.getAttribute('data-fps')) };
  });
  if (width !== 320 || height !== 180 || !fps) throw new Error(`unexpected scene dimensions or fps: ${width}x${height} @ ${fps}`);
  const scores = [];
  for (const [index, name] of frames.entries()) {
    const time = index / fps;
    await page.evaluate((t) => window.webscenePreview.seek(t), time);
    const preview = path.join(outDir, name);
    await page.screenshot({ path: preview, omitBackground: true });
    scores.push({ frame: index, time, psnr: compareFiles(path.join(exportDir, name), preview).psnr });
  }
  console.log(JSON.stringify(scores, null, 2));
} finally { await browser.close(); await served.close(); }
