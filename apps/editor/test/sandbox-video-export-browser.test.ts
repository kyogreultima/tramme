import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { CHROME, launch } from '../../../packages/cli/src/browser.ts';
import { readConfig, serveFile, Server } from '../../../packages/cli/src/server.ts';

const ffmpeg = createRequire(new URL('../../../packages/cli/package.json', import.meta.url))('ffmpeg-static') as string | null;

it.skipIf(!CHROME || !ffmpeg)('exports overlapping 4K video with blur and keeps the sped-up clip in sync', async () => {
  const { doc } = newProject({ name: 'Sandbox sync', width: 1920, height: 1080, fps: 24, duration: 0.5 });
  doc.assets.clip = { type: 'video', src: 'clip.webm' };
  doc.assets.fixture = { type: 'module', src: 'fixture.js' };
  doc.plugins = ['fixture'];
  const comp = doc.compositions[doc.root];
  comp.motionBlur = { samples: 8, shutter: 1 };
  comp.layers = {
    main: { type: 'video', transform: { position: [960, 540] }, props: { video: 'clip', rate: 4 } },
    overlay: { type: 'video', transform: { position: [480, 270], opacity: 0.7 }, props: { video: 'clip', size: [640, 360], rate: 8, start: 0.5, muted: true } },
    mark: { type: 'fixture.mark', transform: { position: [100, 100] }, props: {} },
  };
  comp.order = ['main', 'overlay', 'mark'];

  const files = await mkdtemp(path.join(tmpdir(), 'tramme-sandbox-export-'));
  const source = path.join(files, 'clip.webm');
  const server = new Server(readConfig(path.join(files, 'document.tramme.json')));
  let browser: Awaited<ReturnType<typeof launch>>['browser'] | undefined;
  try {
    // The color change and tone start at the same source timestamp (1 s), so
    // the unmuted shot at 4× should place both at 0.25 s in the exported file.
    await promisify(execFile)(ffmpeg!, [
      '-v', 'error',
      '-f', 'lavfi', '-i', "color=blue:s=3840x2160:r=24,drawbox=c=red:t=fill:enable='gte(t,1)'",
      '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=0.24,volume=4,adelay=1000,apad',
      '-t', '4.5', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-threads', '4',
      '-c:a', 'libopus', source,
    ], { timeout: 90_000 });
    const bundle = await build({
      stdin: { resolveDir: path.resolve(import.meta.dirname, '../src'), contents: `
        import { exportInBrowser } from './webexport.ts';
        import { prefs } from './settings.ts';
        import { builtinRegistry } from '@tramme/nodes';
        import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
        globalThis.runExport = async (doc) => {
          prefs.value = { ...prefs.peek(), sandboxPreview: true };
          let frames = 0;
          const { blob } = await exportInBrowser(doc, location.href, 'webm', {
            compId: doc.root, registry: builtinRegistry(), watermark: false, onProgress: (done) => { frames = done; },
          });
          const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
          try {
            const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
            let decodedFrames = 0, flash = null, tone = null, plugin = false, overlay = false, beforeFlash = false;
            for await (const { canvas, timestamp } of new CanvasSink(video).canvases()) {
              decodedFrames++;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              const [r, , b] = ctx.getImageData(960, 540, 1, 1).data;
              if (r > 100 && r >= b && flash === null) flash = timestamp;
              if (b > 100 && b > r && timestamp < 0.2) beforeFlash = true;
              const [pr, pg, pb] = ctx.getImageData(100, 100, 1, 1).data;
              if (pg > 180 && pr < 70 && pb < 70) plugin = true;
              const [or, , ob] = ctx.getImageData(480, 270, 1, 1).data;
              if (or > 80 && ob > 40 && timestamp < 0.2) overlay = true;
            }
            for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
              const i = buffer.getChannelData(0).findIndex(x => Math.abs(x) > 0.1);
              if (i >= 0) { tone = timestamp + i / buffer.sampleRate; break; }
            }
            return { frames, decodedFrames, width: video.displayWidth, height: video.displayHeight, flash, tone, plugin, overlay, beforeFlash };
          } finally { input.dispose(); }
        };
      ` },
      bundle: true, write: false, format: 'iife',
      loader: { '.svg': 'text', '.md': 'text', '.css': 'empty' },
      jsx: 'automatic', jsxImportSource: 'preact',
    });
    server.use((req, res, url) => {
      if (url.pathname === '/project/clip.webm') { serveFile(req, res, source); return true; }
      if (url.pathname === '/project/document.tramme.json') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><script defer src="/fixture-export.js"></script>');
        return true;
      }
      if (url.pathname === '/fixture-export.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(bundle.outputFiles[0].text);
        return true;
      }
      if (url.pathname === '/project/fixture.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(`export const nodes = [{
          type: 'fixture.mark', title: 'Mark', category: 'Test', props: {},
          render: { canvas2d(ctx) { ctx.fillStyle = '#00ff00'; ctx.fillRect(-32, -32, 64, 64); } },
        }];`);
        return true;
      }
      return false;
    });
    const port = await server.start();
    const launched = await launch();
    browser = launched.browser;
    const { page } = launched;
    const cdp = await browser.target().createCDPSession();
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    const renderer = String(gpu.auxAttributes?.glRenderer ?? '');
    if (process.env.TRAMME_REQUIRE_GPU === '1') {
      expect(gpu.featureStatus?.webgl).toBe('enabled');
      expect(renderer).toMatch(/./);
      expect(renderer).not.toMatch(/SwiftShader|Basic Render Driver|llvmpipe|software/i);
    }
    await page.goto(`http://127.0.0.1:${port}/project/document.tramme.json`);
    const result = await page.evaluate((project) => {
      const run = (globalThis as unknown as { runExport: (d: typeof project) => Promise<{
        frames: number; decodedFrames: number; width: number; height: number; flash: number | null; tone: number | null;
        plugin: boolean; overlay: boolean; beforeFlash: boolean;
      }> }).runExport;
      return run(project);
    }, doc);
    expect(result).toMatchObject({ frames: 12, decodedFrames: 12, width: 1920, height: 1080, plugin: true, overlay: true, beforeFlash: true });
    expect(result.flash).not.toBeNull();
    expect(result.tone).not.toBeNull();
    expect(Math.abs(result.flash! - 0.25)).toBeLessThanOrEqual(1 / comp.fps);
    expect(Math.abs(result.tone! - 0.25)).toBeLessThan(0.02);
    const offset = (result.flash! - result.tone!) * 1000;
    console.log(`Sandbox video export: ${renderer}; flash ${result.flash}s, tone ${result.tone}s, offset ${offset.toFixed(1)} ms`);
    expect(Math.abs(offset)).toBeLessThanOrEqual(1000 / comp.fps);
  } finally {
    await browser?.close();
    server.close();
    await rm(files, { recursive: true, force: true });
  }
}, 180_000);
