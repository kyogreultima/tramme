import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { validate, type TrammeDoc } from '@tramme/core';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHROME, launch } from '../src/browser.ts';
import { renderVideo } from '../src/jobs.ts';
import { FFMPEG } from '../src/media.ts';
import { readConfig, Server } from '../src/server.ts';

const loops = await import('../../../plugins/motion-loops.js');

describe('native periodic motion loops', () => {
  for (const kind of ['orbit', 'ribbons', 'grid']) {
    it(`${kind} draws identically at the same time, out of order, and after one period`, () => {
      const draw = (t: number) => {
        const calls: unknown[] = [];
        const ctx = new Proxy({}, {
          get: (_target, key) => (...args: unknown[]) => calls.push([key, ...args]),
          set: (_target, key, value) => { calls.push([key, value]); return true; },
        });
        loops.nodes[0].render.canvas2d(ctx, { kind, size: [800, 450], period: 6, count: 8, background: '#101010', color: '#DDEEFF', accent: '#FF7840' }, { t });
        return calls;
      };
      const first = draw(1.25);
      draw(4.8); draw(0.1);
      expect(draw(1.25)).toEqual(first);
      expect(draw(7.25)).toEqual(first);
      expect(draw(0)).toEqual(draw(6));
      expect(draw(2)).not.toEqual(draw(0));
    });
  }

  it('has a native editable six-second product-film fixture', () => {
    const doc = JSON.parse(readFileSync(new URL('../../../examples/product-loop/document.tramme.json', import.meta.url), 'utf8')) as TrammeDoc;
    const registry = builtinRegistry().clone().use(loops as never, 'motion-loops.js');
    expect(validate(doc, registry)).toEqual([]);
    expect(doc.compositions[doc.root]).toMatchObject({ duration: 6, fps: 30 });
    expect(Object.values(doc.compositions[doc.root].layers).some((l) => l.type === 'solid.3d')).toBe(true);
    expect(Object.values(doc.compositions[doc.root].layers).some((l) => l.type === 'motion.loop')).toBe(true);
  });
});

describe.skipIf(!CHROME)('a moving plugin project, delivered', () => {
  it('encodes the current sandbox frame rather than a stale framebuffer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-sandbox-delivery-'));
    let server: Server | undefined, close: (() => Promise<void>) | undefined;
    try {
      fs.mkdirSync(path.join(dir, 'plugins'));
      fs.copyFileSync(new URL('../../../plugins/motion-loops.js', import.meta.url), path.join(dir, 'plugins/motion-loops.js'));
      const doc = {
        schema: 'tramme/1', meta: { title: 'Moving square' }, tokens: {}, assets: { loop: { type: 'module', src: 'plugins/motion-loops.js' } }, plugins: ['loop'], root: 'main',
        compositions: { main: { name: 'Main', width: 320, height: 180, fps: 10, duration: 1, motionBlur: { samples: 1, shutter: 0 }, order: ['bg', 'box'], layers: {
          bg: { type: 'motion.loop', props: { kind: 'grid', size: [320, 180], period: 1, background: '#001100', color: '#001100', accent: '#001100' }, transform: { position: [160, 90] } },
          box: { type: 'shape.rect', props: { size: [40, 40], fill: '#FF0000' }, transform: { position: { $k: [{ t: 0, v: [40, 90] }, { t: 1, v: [280, 90] }] } } },
        } } },
      } as unknown as TrammeDoc;
      const input = path.join(dir, 'film.tramme.json'), output = path.join(dir, 'film.mp4');
      fs.writeFileSync(input, JSON.stringify(doc));
      server = new Server(readConfig(input)); await server.start();
      const b = await launch(); close = () => b.browser.close();
      await renderVideo(server, b.page, { docUrl: '/project/film.tramme.json', doc, out: output });
      const frames = execFileSync(FFMPEG, ['-v', 'error', '-i', output, '-vf', 'select=eq(n\\,0)+eq(n\\,9)', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      const red = (frame: number, x: number) => frames[frame * 320 * 180 * 3 + (90 * 320 + x) * 3];
      expect(red(0, 40)).toBeGreaterThan(240);
      expect(red(1, 40)).toBeLessThan(20);
      expect(red(1, 256)).toBeGreaterThan(240);
    } finally { await close?.(); server?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
