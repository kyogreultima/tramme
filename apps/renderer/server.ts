// The renderer of the exports in the cloud: the command line's render (Chrome
// and ffmpeg, packages/cli), behind one route, in a container of the Worker
// (apps/worker/src/container.ts, RendererContainer). The Worker's queue sends it
// a project's .tramme archive; it answers the film (MP4). One render at a time:
// the queue never sends two.
//
//   POST /render?comp=<id>&format=mp4|premiere   body: the .tramme archive    -> the MP4, or the Premiere Pro timeline (a zip)
//   GET  /health
//
//   node apps/renderer/server.ts            (PORT, 8080 by default; CHROME_PATH for Chrome)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'packages/cli/src/main.ts');
/** the largest archive taken (the Worker reads exports whole too) */
const MAX_ARCHIVE = 512 * 1024 * 1024;

/** a command of the CLI, its output kept for an error message */
function cli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    child.stdout.on('data', (d) => { said = (said + d).slice(-4000); });
    child.stderr.on('data', (d) => { said = (said + d).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(said.trim().split('\n').slice(-3).join(' ') || `the CLI ended with ${code}`))));
  });
}

/** what a render hands back: the film, or the Premiere Pro timeline with its clips (a zip) */
export type Format = 'mp4' | 'premiere';

/** a project's archive rendered: unpacked (and checked) by the CLI, then rendered as the desktop export does, or as a Premiere Pro timeline */
export async function render(archive: Buffer, comp?: string, format: Format = 'mp4'): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-render-'));
  try {
    const file = path.join(dir, 'project.tramme'), folder = path.join(dir, 'project'), out = path.join(dir, format === 'premiere' ? 'premiere.zip' : 'film.mp4');
    fs.writeFileSync(file, archive);
    await cli(['unpack', file, '--out', folder]);
    const on = comp ? ['--comp', comp] : [];
    if (format === 'premiere') await cli(['premiere', folder, '--out', path.join(dir, 'premiere'), '--zip', out, ...on]);
    else await cli(['render', folder, '--format', 'mp4', '--out', out, ...on]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

let busy = false;

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://renderer');
  if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200).end('ok'); return; }
  if (req.method !== 'POST' || url.pathname !== '/render') { res.writeHead(404).end(); return; }
  if (busy) { res.writeHead(429).end('one render at a time'); return; }
  busy = true;
  try {
    const comp = url.searchParams.get('comp') ?? undefined;
    if (comp && !/^[\w-]{1,64}$/.test(comp)) throw new Error('invalid composition');
    const format: Format = url.searchParams.get('format') === 'premiere' ? 'premiere' : 'mp4';
    const film = await render(await body(req), comp, format);
    res.writeHead(200, { 'content-type': format === 'premiere' ? 'application/zip' : 'video/mp4', 'content-length': film.length }).end(film);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end((e as Error).message);
  } finally {
    busy = false;
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  server.listen(port, () => console.log(`renderer on ${port}`));
}
