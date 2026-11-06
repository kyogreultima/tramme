import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME, launch } from '../src/browser.ts';
import { readConfig, Server } from '../src/server.ts';

describe.skipIf(!CHROME)('the served project sandbox', () => {
  let server: Server, browser: Awaited<ReturnType<typeof launch>>['browser'], page: Awaited<ReturnType<typeof launch>>['page'];
  let port = 0;
  beforeAll(async () => {
    server = new Server(readConfig(path.resolve(import.meta.dirname, 'fixtures/night-sky/document.tramme.json')));
    server.use((_req, res, url) => {
      if (url.pathname !== '/boundary-host') return false;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><div id="private">editor data</div><script>localStorage.setItem("private", "editor data")</script>');
      return true;
    });
    port = await server.start();
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
});
