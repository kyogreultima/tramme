// Browser proof for the candidate project-code transport. Run with:
//   node scripts/verify-project-boundary.mjs
// This probes browser policy, not the editor integration or desktop webviews.
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { launch } from '../packages/cli/src/browser.ts';

const csp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; worker-src data:; connect-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const frame = `<!doctype html><script>
addEventListener('message', async (event) => {
  if (event.data !== 'probe') return;
  const result = { parentDom: false, cookie: '', storage: '', indexedDb: '', caches: '', fetch: '', worker: '' };
  try { result.parentDom = !!parent.document.getElementById('secret'); } catch (e) { result.parentDom = e.name; }
  try { result.cookie = document.cookie; } catch (e) { result.cookie = e.name; }
  try { result.storage = localStorage.getItem('secret'); } catch (e) { result.storage = e.name; }
  try { result.indexedDb = indexedDB.open('private').readyState; } catch (e) { result.indexedDb = e.name; }
  try { result.caches = await caches.keys(); } catch (e) { result.caches = e.name; }
  try { result.fetch = await (await fetch('/api/private')).text(); } catch (e) { result.fetch = e.name; }
  try {
    const script = \`postMessage({ origin: self.origin, canvas: typeof OffscreenCanvas !== 'undefined', webgl: (() => { try { return !!new OffscreenCanvas(8,8).getContext('webgl2'); } catch { return false; } })() });
      fetch('/api/private').then(r => r.text()).then(x => postMessage({ leak: x })).catch(e => postMessage({ network: e.name }));\`;
    const url = 'data:text/javascript,' + encodeURIComponent(script);
    const worker = new Worker(url, { type: 'module' });
    const messages = [];
    worker.onmessage = (e) => { messages.push(e.data); if (messages.length === 2) { result.worker = messages; worker.terminate(); parent.postMessage(result, '*'); } };
    worker.onerror = (e) => { result.worker = 'error:' + JSON.stringify({ message: e.message, filename: e.filename, lineno: e.lineno }); parent.postMessage(result, '*'); };
  } catch (e) { result.worker = e.name + ':' + e.message; parent.postMessage(result, '*'); }
});
</script>`;
const host = `<!doctype html><div id="secret">private DOM</div><script>localStorage.setItem('secret','private storage');document.cookie='secret=private-cookie';</script><iframe sandbox="allow-scripts" src="/frame"></iframe>`;
const server = createServer((req, res) => {
  if (req.url === '/frame') { res.setHeader('Content-Security-Policy', csp); res.setHeader('Content-Type', 'text/html'); res.end(frame); }
  else if (req.url === '/api/private') { res.setHeader('Content-Type', 'text/plain'); res.end('private-api'); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(host); }
  else res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { browser, page } = await launch();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('iframe');
  const result = await page.evaluate(() => new Promise((resolve) => {
    addEventListener('message', function got(event) { if (event.source !== document.querySelector('iframe').contentWindow) return; removeEventListener('message', got); resolve({ ...event.data, messageOrigin: event.origin }); });
    document.querySelector('iframe').contentWindow.postMessage('probe', '*');
  }));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.messageOrigin, 'null');
  assert.equal(result.parentDom, 'SecurityError');
  assert.equal(result.storage, 'SecurityError');
  assert.equal(result.indexedDb, 'SecurityError');
  assert.equal(result.caches, 'SecurityError');
  assert.notEqual(result.fetch, 'private-api');
  assert(Array.isArray(result.worker), 'an opaque frame must create an isolated worker');
  assert.equal(result.worker[0].origin, 'null');
  assert.equal(result.worker[0].canvas, true);
  assert.equal(result.worker[0].webgl, true);
  assert.notEqual(result.worker[1].leak, 'private-api');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }



