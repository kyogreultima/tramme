import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../src/browser.ts';
import { readConfig, Server } from '../src/server.ts';

describe.skipIf(!CHROME)('the served project sandbox', () => {
  let server: Server, browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  let port = 0;
  let privateReads = 0;
  let fontReads = 0;
  let blankSandbox = false;
  beforeAll(async () => {
    server = new Server(readConfig(path.resolve(import.meta.dirname, 'fixtures/night-sky/document.tramme.json')));
    server.use((_req, res, url) => {
      if (blankSandbox && url.pathname === '/project-sandbox.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return true; }
      if (url.pathname === '/api/private') { privateReads++; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('private account data'); return true; }
      if (url.pathname === '/project/assets/fonts/test.woff2') { fontReads++; res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(Buffer.from([0, 1, 2, 3])); return true; }
      if (url.pathname === '/font-host') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><script type="module">import {browserHost} from "/__tramme/font-host/host.js"; window.makeHost = browserHost;</script>');
        return true;
      }
      if (url.pathname !== '/boundary-host') return false;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><div id="private">editor data</div><script>localStorage.setItem("private", "editor data")</script>');
      return true;
    });
    port = await server.start();
    await server.bundle('font-host', path.resolve(import.meta.dirname, '../../../apps/editor/src/plugins/host.ts'));
    ({ browser, page } = await launch());
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.close(); });

  it('serves a network-denying header and transfers a working opaque worker', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/project-sandbox.html`);
    expect(response.headers.get('content-security-policy')).toContain("sandbox allow-scripts");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    await page.goto(`http://127.0.0.1:${port}/boundary-host`);
    const result = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.sandbox.add('allow-scripts');
      frame.src = '/project-sandbox.html';
      document.body.append(frame);
      await new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
      const result = new Promise<{ origin: string; parent: string; storage: string; network: string; canvas: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sandbox did not answer')), 5000);
        addEventListener('message', function onMessage(event) {
          if (event.source !== frame.contentWindow || event.data?.kind !== 'worker') return;
          clearTimeout(timer);
          removeEventListener('message', onMessage);
          resolve({ ...event.data.data, origin: event.origin });
        });
      });
      const code = `let parentAccess; try { parentAccess = parent.document.getElementById('private').textContent; } catch (e) { parentAccess = e.name; }
        let storage; try { storage = localStorage.getItem('private'); } catch (e) { storage = e.name; }
        fetch('/api/private').then(() => postMessage({ network: 'reached' })).catch(e => postMessage({ parent: parentAccess, storage, network: e.name, canvas: typeof OffscreenCanvas !== 'undefined' }));`;
      frame.contentWindow!.postMessage({ kind: 'start', code }, '*');
      return result;
    });
    expect(result.origin).toBe('null');
    expect(result.parent).not.toBe('editor data');
    expect(result.storage).not.toBe('editor data');
    expect(result.network).not.toBe('reached');
    expect(result.canvas).toBe(true);
  }, 30_000);

  it('blocks direct network and remote imports, including from a nested worker', async () => {
    privateReads = 0;
    await page.goto(`http://127.0.0.1:${port}/boundary-host`);
    const results = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.sandbox.add('allow-scripts');
      frame.src = '/project-sandbox.html';
      document.body.append(frame);
      await new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
      const answer = new Promise<Record<string, string>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('sandbox did not answer')), 5000);
        addEventListener('message', function onMessage(event) {
          if (event.source !== frame.contentWindow || event.data?.kind !== 'worker') return;
          clearTimeout(timer);
          removeEventListener('message', onMessage);
          resolve(event.data.data);
        });
      });
      const api = `${location.origin}/api/private`;
      const code = `const api = ${JSON.stringify(api)};
        const result = {};
        try { result.storage = indexedDB.open('private').readyState; } catch (e) { result.storage = e.name; }
        try { await fetch(api); result.fetch = 'reached'; } catch (e) { result.fetch = e.name; }
        try { await import(api); result.import = 'reached'; } catch (e) { result.import = e.name; }
        result.xhr = await new Promise(resolve => { try { const xhr = new XMLHttpRequest(); xhr.open('GET', api); xhr.onload = () => resolve('reached'); xhr.onerror = () => resolve('blocked'); xhr.send(); } catch (e) { resolve(e.name); } });
        result.socket = await new Promise(resolve => { try { const socket = new WebSocket(api.replace('http:', 'ws:')); socket.onopen = () => { socket.close(); resolve('reached'); }; socket.onerror = () => resolve('blocked'); } catch (e) { resolve(e.name); } });
        result.nested = await new Promise(resolve => { const source = 'fetch(' + JSON.stringify(api) + ').then(() => postMessage("reached")).catch(() => postMessage("blocked"))'; const worker = new Worker('data:text/javascript,' + encodeURIComponent(source), { type: 'module' }); worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = () => resolve('blocked'); });
        postMessage(result);`;
      frame.contentWindow!.postMessage({ kind: 'start', code }, '*');
      return answer;
    });
    expect(results.storage).toBe('SecurityError');
    for (const key of ['fetch', 'import', 'xhr', 'socket', 'nested']) expect(results[key]).not.toBe('reached');
    expect(privateReads).toBe(0);
  }, 30_000);

  it('supplies approved font bytes through the host and refuses a private route as a font', async () => {
    fontReads = 0;
    privateReads = 0;
    await page.goto(`http://127.0.0.1:${port}/font-host`);
    await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
    const ok = await page.evaluate(async () => {
      const base = `${location.origin}/project/document.tramme.json`;
      const host = (window as any).makeHost(base);
      host.setDoc({ doc: { assets: {}, compositions: {} }, docUrl: base, images: {}, json: {}, fonts: [{ url: `${location.origin}/project/assets/fonts/test.woff2`, family: 'Test' }] });
      try { return await host.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] }); }
      finally { host.dispose(); }
    });
    expect(ok).toEqual([]);
    expect(fontReads).toBe(1);
    const refused = await page.evaluate(async () => {
      const base = `${location.origin}/project/document.tramme.json`;
      const host = (window as any).makeHost(base);
      host.setDoc({ doc: { assets: {}, compositions: {} }, docUrl: base, images: {}, json: {}, fonts: [{ url: `${location.origin}/api/private`, family: 'Private' }] });
      try { await host.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] }); return 'allowed'; }
      catch (error) { return (error as Error).message; }
      finally { host.dispose(); }
    });
    expect(refused).toContain('font must belong to this project');
    expect(privateReads).toBe(0);
  }, 30_000);

  it('fails closed if the isolated page never starts its worker', async () => {
    blankSandbox = true;
    try {
      await page.goto(`http://127.0.0.1:${port}/font-host`);
      await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
      const reason = await page.evaluate(async () => {
        const host = (window as any).makeHost(`${location.origin}/project/document.tramme.json`);
        try { await host.draw({ frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] }); return 'rendered'; }
        catch (error) { return (error as Error).message; }
        finally { host.dispose(); }
      });
      expect(reason).toContain('the isolated project worker did not start');
    } finally { blankSandbox = false; }
  }, 20_000);
});
