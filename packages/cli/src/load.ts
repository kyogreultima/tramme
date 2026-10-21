// tramme load [case...] [--frames n] [--out folder] [--json file] [--before file]:
// the load cases of bench/load rendered one after the other, each in its own
// project folder (the media it needs made once by ffmpeg), and the time per
// frame broken down into its parts. --json keeps the figures, --before
// compares with figures kept earlier (docs/performance-roadmap.md, step 1).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCUMENT } from '@tramme/project';
import { loadCases } from '../../../bench/load/cases.ts';
import { launch } from './browser.ts';
import { renderVideo } from './jobs.ts';
import { loadTable, type LoadResult } from './load-report.ts';
import { FFMPEG } from './media.ts';
import { readConfig, Server } from './server.ts';

export interface LoadOptions {
  /** frames rendered per case (all of it by default) */
  frames?: number;
  /** where the cases' projects and media are written (kept between runs, so the media is made once) */
  out?: string;
  /** a file the figures are written to */
  json?: string;
  /** a file of earlier figures to compare with */
  before?: string;
}

export async function runLoad(names: string[], opts: LoadOptions = {}): Promise<LoadResult[]> {
  const all = loadCases();
  const unknown = names.filter((n) => !all.some((c) => c.id === n));
  if (unknown.length) throw new Error(`unknown load case: ${unknown.join(', ')} (${all.map((c) => c.id).join(', ')})`);
  const cases = names.length ? all.filter((c) => names.includes(c.id)) : all;
  const root = path.resolve(opts.out ?? path.join(os.tmpdir(), 'tramme-load'));
  const before: LoadResult[] = opts.before ? JSON.parse(fs.readFileSync(opts.before, 'utf8')) : [];
  const results: LoadResult[] = [], failed: string[] = [];
  for (const c of cases) {
    const dir = path.join(root, c.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, DOCUMENT);
    fs.writeFileSync(file, JSON.stringify(c.doc, null, 2));
    for (const [rel, args] of Object.entries(c.media ?? {})) {
      const target = path.join(dir, rel);
      if (fs.existsSync(target)) continue;
      console.log(`${c.id}: making ${rel}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args, target], { stdio: 'inherit' });
    }
    const main = c.doc.compositions[c.doc.root];
    const to = opts.frames ? Math.min(main.duration, opts.frames / main.fps) : undefined;
    console.log(`${c.id}: ${c.title}`);
    const server = new Server(readConfig(file));
    await server.start();
    const { browser, page } = await launch();
    try {
      const r = await renderVideo(server, page, { docUrl: '/project/' + DOCUMENT, doc: c.doc, to, mute: true, out: path.join(dir, 'out.mp4') });
      results.push({ id: c.id, title: c.title, frames: r.frames, ms: r.msPerFrame, parts: r.parts });
    } catch (e) {
      // one case that cannot run here (a codec this Chrome lacks) does not lose the others' figures
      failed.push(`${c.id}: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await browser.close();
      server.close();
    }
  }
  console.log('\n' + loadTable(results, before));
  for (const f of failed) console.log(`not measured: ${f}`);
  if (opts.json) {
    fs.mkdirSync(path.dirname(path.resolve(opts.json)), { recursive: true });
    fs.writeFileSync(opts.json, JSON.stringify(results, null, 2) + '\n');
    console.log(`figures kept in ${opts.json}`);
  }
  return results;
}
