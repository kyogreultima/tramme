// The renderer of the exports in the cloud: the command line's render (Chrome
// and ffmpeg, packages/cli), in a container of the Worker (apps/worker/src/
// container.ts, RendererContainer). The Worker's queue sends it a project's
// .tramme archive and is answered at once with the render's id; it then asks
// where the render is until it is over, and takes the film. No request is held
// for the length of a render: a film of several minutes outlasts what a
// Durable Object's alarm, a sleeping container or a fetch waits for. One render
// at a time: the queue never sends two.
//
//   POST   /render?comp=<id>&format=mp4|premiere   body: the .tramme archive   -> 202 {id}
//   GET    /render/<id>                            -> {status: rendering|done|failed, error?}
//   GET    /render/<id>/film                       -> the MP4, or the Premiere Pro timeline (a zip)
//   DELETE /render/<id>                            the film taken: its folder removed
//   GET    /health
//
//   node apps/renderer/server.ts            (PORT, 8080 by default; CHROME_PATH for Chrome)

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastReason } from '../../packages/cli/src/plain-error.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'packages/cli/src/main.ts');
/** the largest archive taken (the Worker reads exports whole too) */
const MAX_ARCHIVE = 512 * 1024 * 1024;
/** a render over and not taken is forgotten after this long (its film removed) */
const KEEP_MS = 60 * 60_000;

/** a command of the CLI; when it fails, the reason it printed last (its errors, stacks left out) */
function cli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // offline: the project's code runs on the render page at full speed, its Chrome cut off from all but the local render server (browser.ts)
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRAMME_OFFLINE: '1' } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out = (out + d).slice(-8000); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(lastReason(err) || lastReason(out) || `the CLI ended with ${code}`))));
  });
}

/** what a render hands back: the film, or the Premiere Pro timeline with its clips (a zip) */
export type Format = 'mp4' | 'premiere';

/** a project's archive rendered into `dir`: unpacked (and checked) by the CLI, then rendered as the desktop export does, or as a Premiere Pro timeline; the file made */
export async function render(dir: string, archive: Buffer, comp?: string, format: Format = 'mp4'): Promise<string> {
  const file = path.join(dir, 'project.tramme'), folder = path.join(dir, 'project'), out = path.join(dir, format === 'premiere' ? 'premiere.zip' : 'film.mp4');
  fs.writeFileSync(file, archive);
  // the archive's issues are named by its project, not by the folder it was unpacked into here
  await cli(['unpack', file, '--out', folder]).catch((e: Error) => { throw new Error(e.message.replaceAll(file, 'the project')); });
  const on = comp ? ['--comp', comp] : [];
  if (format === 'premiere') await cli(['premiere', folder, '--out', path.join(dir, 'premiere'), '--zip', out, ...on]);
  else await cli(['render', folder, '--format', 'mp4', '--out', out, ...on]);
  return out;
}

interface Render { id: string; status: 'rendering' | 'done' | 'failed'; error?: string; dir: string; file?: string; format: Format; over?: number }
const renders = new Map<string, Render>();

function drop(r: Render) {
  renders.delete(r.id);
  fs.rmSync(r.dir, { recursive: true, force: true });
}

/** the renders over and never taken (the queue gave up on them) */
function forget(now = Date.now()) {
  for (const r of renders.values()) if (r.over && now - r.over > KEEP_MS) drop(r);
}

function body(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_ARCHIVE) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://renderer');
  const [, route, id, sub] = url.pathname.split('/');
  try {
    if (req.method === 'GET' && route === 'health') { res.writeHead(200).end('ok'); return; }
    if (route !== 'render') { res.writeHead(404).end(); return; }
    forget();
    if (req.method === 'POST' && !id) {
      if ([...renders.values()].some((r) => r.status === 'rendering')) { res.writeHead(429).end('one render at a time'); return; }
      const comp = url.searchParams.get('comp') ?? undefined;
      if (comp && !/^[\w-]{1,64}$/.test(comp)) { res.writeHead(400).end('invalid composition'); return; }
      const format: Format = url.searchParams.get('format') === 'premiere' ? 'premiere' : 'mp4';
      const archive = await body(req);
      const r: Render = { id: randomUUID(), status: 'rendering', dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-render-')), format };
      renders.set(r.id, r);
      render(r.dir, archive, comp, format)
        .then((file) => Object.assign(r, { status: 'done', file }))
        .catch((e: Error) => Object.assign(r, { status: 'failed', error: e.message || 'the render failed' }))
        .finally(() => { r.over = Date.now(); });
      json(res, 202, { id: r.id });
      return;
    }
    const r = id ? renders.get(id) : undefined;
    // a render this renderer does not know: it restarted (the container slept or stopped) since it took it
    if (!r) { json(res, 404, { error: 'the renderer stopped during the export' }); return; }
    if (req.method === 'GET' && !sub) { json(res, 200, { status: r.status, ...(r.error ? { error: r.error } : {}) }); return; }
    if (req.method === 'GET' && sub === 'film' && r.status === 'done' && r.file) {
      res.writeHead(200, { 'content-type': r.format === 'premiere' ? 'application/zip' : 'video/mp4', 'content-length': fs.statSync(r.file).size });
      fs.createReadStream(r.file).pipe(res);
      return;
    }
    if (req.method === 'DELETE' && !sub) { drop(r); res.writeHead(204).end(); return; }
    res.writeHead(404).end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end((e as Error).message);
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  server.listen(port, () => console.log(`renderer on ${port}`));
}
