import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../src/browser.ts';
import { readConfig, Server } from '../src/server.ts';
import { newProject } from '@tramme/project';
import { PNG } from 'pngjs';

describe.skipIf(!CHROME)('the served project sandbox', () => {
  let server: Server, browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  let port = 0;
  let privateReads = 0;
  let fontReads = 0;
  let moduleReads = 0;
  let blankSandbox = false;
  let unsafeDoc: string | null = null;
  let unsafeModuleReads = 0;
  beforeAll(async () => {
    server = new Server(readConfig(path.resolve(import.meta.dirname, 'fixtures/night-sky/document.tramme.json')));
    server.use((_req, res, url) => {
      if (unsafeDoc && url.pathname === '/project/unsafe-code.tramme.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(unsafeDoc); return true; }
      if (url.pathname === '/project/plugins/unused.js') { unsafeModuleReads++; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('if (typeof document !== "undefined") throw new Error("module executed in trusted page"); export default { init() { globalThis.__codeInit = (globalThis.__codeInit || 0) + 1; }, render(ctx) { ctx.fillStyle = globalThis.__codeInit === 1 ? "#ff0000" : "#0000ff"; ctx.fillRect(0, 0, 64, 64); } };'); return true; }
      if (blankSandbox && url.pathname === '/project-sandbox.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return true; }
      if (url.pathname === '/api/private') { privateReads++; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('private account data'); return true; }
      if (url.pathname === '/project/assets/fonts/test.woff2') { fontReads++; res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(Buffer.from([0, 1, 2, 3])); return true; }
      if (url.pathname === '/project/oversized.js') { moduleReads++; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(' '.repeat(1024 * 1024 + 1)); return true; }
      if (url.pathname === '/project/holder.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export const tools = [{ name: "hold", description: "waits", run: () => new Promise(() => {}) }];'); return true; }
      if (url.pathname === '/project/forger.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(`postMessage({ kind: 'ask', call: 1, id: 999, q: { kind: 'fetch', url: 'http://127.0.0.1:${port}/api/private' } }); export const tools = [];`); return true; }
      if (url.pathname === '/project/spying.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(`let storage; try { storage = indexedDB.open('private').readyState; } catch (error) { storage = error.name; } fetch('http://127.0.0.1:${port}/api/private').catch(() => {}); export const meta = { name: storage }; export const tools = [];`); return true; }
      if (url.pathname === '/plugins/shipped.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('export const tools = [];'); return true; }
      if (url.pathname === '/font-host') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><script type="module">import {browserHost} from "/__tramme/font-host/host.js"; window.makeHost = browserHost;</script>');
        return true;
      }
      if (url.pathname === '/scope-host') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><script type="module">import {pluginHost,pluginToolHost} from "/__tramme/scope-host/index.js"; window.makeProjectHost = pluginHost; window.makeToolHost = pluginToolHost;</script>');
        return true;
      }
      if (url.pathname !== '/boundary-host') return false;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><div id="private">editor data</div><script>localStorage.setItem("private", "editor data")</script>');
      return true;
    });
    port = await server.start();
    await server.bundle('font-host', path.resolve(import.meta.dirname, '../../../apps/editor/src/plugins/host.ts'));
    await server.bundle('scope-host', path.resolve(import.meta.dirname, '../../../apps/editor/src/plugins/index.ts'));
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
        try { await fetch(api, { mode: 'no-cors' }); result.noCors = 'reached'; } catch (e) { result.noCors = e.name; }
        try { await import(api); result.import = 'reached'; } catch (e) { result.import = e.name; }
        result.xhr = await new Promise(resolve => { try { const xhr = new XMLHttpRequest(); xhr.open('GET', api); xhr.onload = () => resolve('reached'); xhr.onerror = () => resolve('blocked'); xhr.send(); } catch (e) { resolve(e.name); } });
        result.socket = await new Promise(resolve => { try { const socket = new WebSocket(api.replace('http:', 'ws:')); socket.onopen = () => { socket.close(); resolve('reached'); }; socket.onerror = () => resolve('blocked'); } catch (e) { resolve(e.name); } });
        result.eventSource = await new Promise(resolve => { if (typeof EventSource === 'undefined') { resolve('unsupported'); return; } try { const source = new EventSource(api); const timer = setTimeout(() => { source.close(); resolve('blocked'); }, 500); source.onopen = () => { clearTimeout(timer); source.close(); resolve('reached'); }; source.onerror = () => { clearTimeout(timer); source.close(); resolve('blocked'); }; } catch (e) { resolve(e.name); } });
        result.nested = await new Promise(resolve => { const source = 'fetch(' + JSON.stringify(api) + ').then(() => postMessage("reached")).catch(() => postMessage("blocked"))'; const worker = new Worker('data:text/javascript,' + encodeURIComponent(source), { type: 'module' }); worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = () => resolve('blocked'); });
        postMessage(result);`;
      frame.contentWindow!.postMessage({ kind: 'start', code }, '*');
      return answer;
    });
    expect(results.storage).toBe('SecurityError');
    for (const key of ['fetch', 'noCors', 'import', 'xhr', 'socket', 'eventSource', 'nested']) expect(results[key]).not.toBe('reached');
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

  it('refuses an oversized project module before transferring it to the worker', async () => {
    moduleReads = 0;
    await page.goto(`http://127.0.0.1:${port}/font-host`);
    await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
    const reason = await page.evaluate(async () => {
      const host = (window as any).makeHost(`${location.origin}/project/document.tramme.json`);
      try {
        await host.ensure([{ id: 'huge', url: `${location.origin}/project/oversized.js` }]);
        return 'loaded';
      } catch (error) { return (error as Error).message; }
      finally { host.dispose(); }
    });
    expect(reason).toContain('plugin module exceeds 1 MB');
    expect(moduleReads).toBe(1);
  }, 30_000);

  it('keeps a forged request from a second plugin away from an active tool grant', async () => {
    privateReads = 0;
    await page.goto(`http://127.0.0.1:${port}/font-host`);
    await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
    const result = await page.evaluate(async () => {
      const base = `${location.origin}/project/document.tramme.json`;
      const holder = (window as any).makeHost(base), forger = (window as any).makeHost(base);
      try {
        await holder.ensure([{ id: 'holder', url: `${location.origin}/project/holder.js` }]);
        let privilegedCalls = 0;
        const pending = holder.runTool('hold', {}, {
          doc: { assets: {} }, compId: 'main', time: 0, selection: [], signal: new AbortController().signal,
          fetch: () => { privilegedCalls++; return fetch('/api/private'); },
        }).catch(() => {});
        await forger.ensure([{ id: 'forger', url: `${location.origin}/project/forger.js` }]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        holder.dispose();
        await pending;
        return privilegedCalls;
      } finally { holder.dispose(); forger.dispose(); }
    });
    expect(result).toBe(0);
    expect(privateReads).toBe(0);
  }, 30_000);

  it('blocks private API and storage access during project module initialization', async () => {
    privateReads = 0;
    await page.goto(`http://127.0.0.1:${port}/font-host`);
    await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
    const storage = await page.evaluate(async () => {
      const base = `${location.origin}/project/document.tramme.json`;
      const host = (window as any).makeHost(base);
      try {
        const declarations = await host.ensure([{ id: 'spy', url: `${location.origin}/project/spying.js` }]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return declarations.get('spy')?.meta?.name;
      } finally { host.dispose(); }
    });
    expect(storage).toBe('SecurityError');
    expect(privateReads).toBe(0);
  }, 30_000);

  it('transfers an editor-shipped pack only under its pack identity', async () => {
    await page.goto(`http://127.0.0.1:${port}/font-host`);
    await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
    const result = await page.evaluate(async () => {
      const base = `${location.origin}/project/document.tramme.json`;
      const url = `${location.origin}/plugins/shipped.js`;
      const pack = (window as any).makeHost(base), project = (window as any).makeHost(base);
      try {
        const allowed = await pack.ensure([{ id: 'packs:shipped.js', url }]);
        let refused = '';
        try { await project.ensure([{ id: 'project-owned', url }]); }
        catch (error) { refused = (error as Error).message; }
        return { loaded: allowed.has('packs:shipped.js'), refused };
      } finally { pack.dispose(); project.dispose(); }
    });
    expect(result.loaded).toBe(true);
    expect(result.refused).toContain('plugin module must belong to this project');
  }, 30_000);

  it('replaces one-plugin workers when their module or project changes', async () => {
    await page.goto(`http://127.0.0.1:${port}/scope-host`);
    await page.waitForFunction(() => typeof (window as any).makeToolHost === 'function');
    const result = await page.evaluate(() => {
      const base = `${location.origin}/project/document.tramme.json`;
      const main = (window as any).makeProjectHost(base);
      const first = (window as any).makeToolHost(base, 'one', 'blob:first');
      const other = (window as any).makeToolHost(base, 'two', 'blob:other');
      const same = (window as any).makeToolHost(base, 'one', 'blob:first');
      const updated = (window as any).makeToolHost(base, 'one', 'blob:updated');
      const replaced = first.closed() && same === first && updated !== first && !other.closed();
      const next = (window as any).makeProjectHost(`${location.origin}/next/document.tramme.json`);
      const projectCleared = updated.closed() && other.closed();
      main.dispose(); next.dispose();
      return { replaced, projectCleared };
    });
    expect(result).toEqual({ replaced: true, projectCleared: true });
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

  it('bounds queued document and draw messages while the isolated worker is starting', async () => {
    blankSandbox = true;
    try {
      await page.goto(`http://127.0.0.1:${port}/font-host`);
      await page.waitForFunction(() => typeof (window as any).makeHost === 'function');
      const reason = await page.evaluate(async () => {
        const base = `${location.origin}/project/document.tramme.json`;
        const host = (window as any).makeHost(base);
        const pending: Promise<unknown>[] = [];
        const payload = { frame: 0, comp: { width: 10, height: 10, duration: 1, fps: 30 }, layers: [], items: [] };
        for (let i = 0; i < 64; i++) {
          host.setDoc({ doc: { index: i }, docUrl: base, images: {}, json: {}, fonts: [] });
          pending.push(host.draw(payload).catch(() => {}));
        }
        try { await host.ensure([{ id: 'extra', url: `${location.origin}/project/extra.js` }]); return 'accepted'; }
        catch (error) { await Promise.all(pending); return (error as Error).message; }
        finally { host.dispose(); }
      });
      expect(reason).toContain('too many queued sandbox messages');
    } finally { blankSandbox = false; }
  }, 20_000);

  it('renders a Free code module in the worker without executing it on the trusted page', async () => {
    const doc = newProject({ name: 'Unsafe code', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.assets.unused = { type: 'module', src: 'plugins/unused.js' };
    doc.compositions.main.layers.code = { type: 'code', transform: {}, props: { module: 'unused', entry: 'default', params: null } } as never;
    doc.compositions.main.order = ['code'];
    unsafeDoc = JSON.stringify(doc);
    unsafeModuleReads = 0;
    try {
      await page.goto(`http://127.0.0.1:${port}/__tramme/?doc=/project/unsafe-code.tramme.json`);
      const urls = await page.evaluate(async () => { await (window as any).TRAMME.ready; const first = await (window as any).TRAMME.still(0); const second = await (window as any).TRAMME.still(0); return [first, second]; }) as string[];
      for (const url of urls) {
        const png = PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
        expect([...png.data.subarray((10 * png.width + 10) * 4, (10 * png.width + 10) * 4 + 3)]).toEqual([255, 0, 0]);
      }
      expect(unsafeModuleReads).toBe(1);
    } finally { unsafeDoc = null; }
  }, 30_000);
});
