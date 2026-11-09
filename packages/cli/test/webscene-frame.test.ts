// The web scene preview frame in a real browser: the same document the editor builds, inside
// a sandboxed iframe. It must draw like the export does, and it must reach nothing.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { buildSceneFrame, SCENE_FRAME_SANDBOX } from '../../../apps/editor/src/webscene-frame.ts';
import { CHROME, launch } from '../src/browser.ts';
import { compareFiles } from '../src/compare.ts';
import { engineCapture } from '../src/webscene.ts';

const SCENE = fileURL('../../../bench/web-scenes/css-svg');
function fileURL(rel: string) { return new URL(rel, import.meta.url); }
const FPS = 6, FRAMES = 6, MIN_PSNR = 26;

const runtimeSource = async () => (await build({ entryPoints: [new URL('../../project/src/scene-runtime.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, format: 'esm', platform: 'browser', write: false })).outputFiles[0].text;
const reader = (root: string) => async (p: string) => {
  const file = path.join(root, p);
  return file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? new Uint8Array(fs.readFileSync(file)) : null;
};

describe.skipIf(!CHROME)('web scene preview frame', () => {
  let work: string, runtime: string, browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  let server: http.Server, hits: string[];
  let port: number;

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-frame-'));
    runtime = await runtimeSource();
    hits = [];
    server = http.createServer((request, response) => { hits.push(request.url ?? ''); response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/javascript' }).end('window.reached = true; export default 1;'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    ({ browser, page } = await launch());
    await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.close(); if (work) fs.rmSync(work, { recursive: true, force: true }); });

  /** the frame in a page of its own, with the messages it sent collected */
  const open = async (srcdoc: string) => {
    await page.goto('about:blank');
    await page.evaluate((doc, sandbox) => {
      const w = window as unknown as { messages: unknown[]; frame: HTMLIFrameElement };
      w.messages = [];
      addEventListener('message', (e) => { if (e.source === w.frame.contentWindow) w.messages.push(e.data); });
      document.body.style.margin = '0';
      const frame = w.frame = document.createElement('iframe');
      frame.setAttribute('sandbox', sandbox);
      frame.style.cssText = 'width:320px;height:180px;border:0;display:block';
      frame.srcdoc = doc;
      document.body.append(frame);
    }, srcdoc, SCENE_FRAME_SANDBOX);
    await page.waitForFunction(() => (window as unknown as { messages: { kind: string }[] }).messages.some((m) => m.kind === 'ready'), { timeout: 15_000 });
  };
  const send = (message: unknown) => page.evaluate((m) => (window as unknown as { frame: HTMLIFrameElement }).frame.contentWindow!.postMessage(m, '*'), message);

  // the export side of this comparison is the engine's own Chrome: see webscene-parity.test.ts
  it.skipIf(!!process.env.CI)('draws like the export, frame by frame (PSNR)', async () => {
    const scene = path.join(work, 'project', 'scenes', 'title');
    fs.cpSync(SCENE, scene, { recursive: true });
    await engineCapture({ dir: scene, entry: 'index.html', size: [320, 180], fps: FPS, frames: FRAMES, out: path.join(work, 'export'), css: '', projectDir: path.join(work, 'project'), params: null });
    await open(await buildSceneFrame({ folder: 'scenes/title', entry: 'index.html', css: '', runtime, read: reader(path.join(work, 'project')) }));
    const scores: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate(() => { (window as unknown as { messages: unknown[] }).messages.length = 0; });
      await send({ kind: 'seek', t: i / FPS, id: i });
      await page.waitForFunction((n) => (window as unknown as { messages: { kind: string; id?: number }[] }).messages.some((m) => m.kind === 'sought' && m.id === n), { timeout: 5000 }, i);
      const shot = path.join(work, `frame_${i}.png`);
      await page.screenshot({ path: shot, omitBackground: true });
      scores.push(compareFiles(path.join(work, 'export', `frame_${String(i).padStart(6, '0')}.png`), shot).psnr);
    }
    expect(Math.min(...scores), `PSNR per frame: ${scores.map((s) => s.toFixed(1)).join(', ')}`).toBeGreaterThanOrEqual(MIN_PSNR);
  }, 120_000);

  it('reaches nothing: no network by any door, no parent, no storage, no navigation', async () => {
    const root = path.join(work, 'evil');
    fs.mkdirSync(path.join(root, 'scenes', 'evil'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scenes', 'evil', 'index.html'), `<!doctype html><html><head></head><body><script>
      const url = 'http://127.0.0.1:${port}/';
      const results = {};
      const attempt = async (name, fn) => { try { const r = await fn(); results[name] = 'reached:' + String(r); } catch (e) { results[name] = 'blocked:' + (e && e.name); } };
      (async () => {
        await attempt('fetch', () => fetch(url + 'fetch'));
        await attempt('fetch-no-cors', () => fetch(url + 'nocors', { mode: 'no-cors' }));
        await attempt('xhr', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url + 'xhr'); x.onload = () => res(x.status); x.onerror = () => rej(new Error('xhr')); x.send(); }));
        await attempt('websocket', () => new Promise((res, rej) => { const s = new WebSocket('ws://127.0.0.1:${port}/ws'); s.onopen = () => res('open'); s.onerror = () => rej(new Error('ws')); }));
        await attempt('image', () => new Promise((res, rej) => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => rej(new Error('img')); i.src = url + 'img.png'; }));
        await attempt('import', () => import(url + 'module.js'));
        await attempt('beacon', () => navigator.sendBeacon(url + 'beacon', 'x') ? 'queued' : Promise.reject(new Error('refused')));
        await attempt('frame', () => new Promise((res, rej) => { const f = document.createElement('iframe'); f.onload = () => res('loaded'); f.onerror = () => rej(new Error('f')); f.src = url + 'frame'; document.body.append(f); setTimeout(() => rej(new Error('timeout')), 800); }));
        await attempt('parent-dom', () => parent.document.title);
        await attempt('top-location', () => top.location.href);
        await attempt('cookie', () => document.cookie);
        await attempt('localStorage', () => localStorage.length);
        await attempt('indexedDB', () => new Promise((res, rej) => { try { const r = indexedDB.open('x'); r.onsuccess = () => res('open'); r.onerror = () => rej(new Error('idb')); } catch (e) { rej(e); } }));
        await attempt('navigate', () => { location.href = url + 'nav'; return 'set'; });
        parent.postMessage({ kind: 'probe', results }, '*');
      })();
    </script></body></html>`);
    hits.length = 0;
    await open(await buildSceneFrame({ folder: 'scenes/evil', entry: 'index.html', css: '', runtime, read: reader(root) }));
    await page.waitForFunction(() => (window as unknown as { messages: { kind: string }[] }).messages.some((m) => m.kind === 'probe'), { timeout: 15_000 });
    const probe = await page.evaluate(() => (window as unknown as { messages: { kind: string; results: Record<string, string> }[] }).messages.find((m) => m.kind === 'probe')!.results);
    await new Promise((r) => setTimeout(r, 300));
    expect(hits, `requests that reached the server: ${hits.join(', ')}`).toEqual([]);
    // (a blocked frame still fires its load event, so the frame door is judged by the server's silence above)
    for (const name of ['fetch', 'fetch-no-cors', 'xhr', 'websocket', 'image', 'import', 'parent-dom', 'top-location', 'cookie', 'localStorage', 'indexedDB'])
      expect(probe[name], name).toMatch(/^blocked:/);
  }, 60_000);

  it('hears only its parent', async () => {
    const root = path.join(work, 'deaf');
    fs.mkdirSync(path.join(root, 'scenes', 'deaf'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scenes', 'deaf', 'index.html'), `<!doctype html><html><head></head><body><script type="module">
      import { sceneController } from '/vendor/scene-runtime.js';
      const c = sceneController(2); window.seen = []; c.register((t) => { window.seen.push(t); }); c.install(window);
    </script></body></html>`);
    await open(await buildSceneFrame({ folder: 'scenes/deaf', entry: 'index.html', css: '', runtime, read: reader(root) }));
    // a sibling window talking to the frame is not heard: the frame checks who sent the message
    await page.evaluate(() => {
      (window as unknown as { messages: unknown[] }).messages.length = 0;
      const other = document.createElement('iframe');
      other.setAttribute('sandbox', 'allow-scripts');
      other.srcdoc = '<script>parent.frames[0].postMessage({ kind: "seek", t: 1.5, id: "intruder" }, "*")</' + 'script>';
      document.body.append(other);
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await page.evaluate(() => (window as unknown as { messages: { id?: string }[] }).messages.some((m) => m.id === 'intruder'))).toBe(false);
    await send({ kind: 'seek', t: 1.25, id: 'mine' });
    await page.waitForFunction(() => (window as unknown as { messages: { kind: string; id?: string }[] }).messages.some((m) => m.kind === 'sought' && m.id === 'mine'), { timeout: 5000 });
  }, 60_000);
});
