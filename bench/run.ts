// node bench/run.ts <brief id> [--series baseline] [--cap 6] [--effort high] [--pictures hydracept]
//   [--model claude-opus-5-5] [--url http://localhost:8790] [--out out/bench]
//
// Runs one brief of briefs.json as a user would, alone: a new project in the
// brief's format, the brief's files put in it, the prompt sent in the chat with
// the changes applied without the user, then nothing until the turn ends. The
// turn goes through the companion (Claude Code), so it spends the subscription's
// quota: the run is stopped once its cost passes the cap (dollars at the API's
// prices, read live from Claude Code's transcripts).
//
// Needs the trial server (port 8790, its own state) and the companion running:
//   npx wrangler dev -c apps/worker/wrangler.jsonc --port 8790 --var DEV_OPEN:1 --persist-to .wrangler/state-bench
//   node packages/cli/src/main.ts agent --origin http://localhost:8790
//
// Leaves in <out>/<series>/<brief>-<n>/ the project's conversations
// (.tramme/chats, read by `node bench/usage.ts`), the Claude Code transcripts
// of the run, and run.json (cost, cap, project link). The project stays on the
// trial server, to be watched and scored.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHAT_INDEX, chatPath } from '@tramme/project';
import type { Page } from 'puppeteer-core';
import { COMPANION_PORT } from '@tramme/assistant';
import { launch } from '../packages/cli/src/browser.ts';
import { priced } from './cost.ts';
import { PRICES } from './prices.ts';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const id = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const series = flag('series', 'baseline'), cap = Number(flag('cap', '6')), effort = flag('effort', 'high');
const dry = argv.includes('--dry');
/** the Pictures settings' provider for this run (the editor's own choice by default) */
const pictures = flag('pictures', '');
const model = flag('model', 'claude-opus-5-5'), base = flag('url', 'http://localhost:8790').replace(/\/+$/, ''), outRoot = flag('out', 'out/bench');

interface Brief { id: string; split: string; format: string; seconds: number; prompt: string; files?: string[] }
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const briefs: Brief[] = JSON.parse(fs.readFileSync(path.join(here, 'briefs.json'), 'utf8')).briefs;
const brief = briefs.find((b) => b.id === id);
if (!brief) { console.error(`usage: node bench/run.ts <brief id> [--series s] [--cap dollars] [--effort level]\nbriefs: ${briefs.map((b) => b.id).join(', ')}`); process.exit(1); }

const SIZES: Record<string, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const [width, height] = SIZES[brief.format] ?? SIZES['16:9'];

/** where Claude Code keeps the companion's sessions: its working folder (the system's temporary files), escaped */
const TRANSCRIPTS = path.join(os.homedir(), '.claude', 'projects', os.tmpdir().replace(/[^A-Za-z0-9]/g, '-'));

/** the sessions Claude Code wrote since a moment, and what their requests cost at the API's prices */
function transcriptsSince(start: number): { files: string[]; dollars: number; requests: number } {
  if (!fs.existsSync(TRANSCRIPTS)) return { files: [], dollars: 0, requests: 0 };
  const files = fs.readdirSync(TRANSCRIPTS).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(TRANSCRIPTS, f))
    .filter((f) => fs.statSync(f).birthtimeMs >= start - 2000);
  let dollars = 0, requests = 0;
  for (const f of files) {
    // a request streams several lines with the same message id: its last usage counts
    const usage = new Map<string, { model: string; u: any }>();
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      try { const o = JSON.parse(line); if (o.type === 'assistant' && o.message?.id) usage.set(o.message.id, { model: o.message.model, u: o.message.usage }); } catch { /* a line being written */ }
    }
    for (const { model: m, u } of usage.values()) {
      const p = priced({ requests: 1, input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0, output: u.output_tokens ?? 0 }, PRICES[m] ? m : model);
      if (p) { dollars += p.dollars; requests++; }
    }
  }
  return { files, dollars, requests };
}

async function call<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base + p, init);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${p}: HTTP ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

const COMPANION = `http://127.0.0.1:${COMPANION_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The brief sent, then the turn watched until nothing has run for 15 s (its
 * scenes built apart included); once its cost passes the cap, the companion is
 * told to stop (straight, so a busy page cannot delay it) and so is the editor.
 * Whether it was stopped.
 */
async function watch(page: Page, start: number, token: string): Promise<boolean> {
  // send resolves when the turn is over: it is not awaited
  await page.evaluate((text) => { void (window as any).__tramme.send(text); }, brief!.prompt);
  let capped = false, seenRunning = false, idleSince = 0;
  while (!(idleSince && Date.now() - idleSince > 15000 && (seenRunning || Date.now() - start > 90000))) {
    await sleep(5000);
    const live = transcriptsSince(start);
    process.stdout.write(`\r${((Date.now() - start) / 60000).toFixed(1)} min, ${live.requests} requests, $${live.dollars.toFixed(2)}   `);
    if (live.dollars > cap && !capped) {
      capped = true;
      console.log('\ncap passed: stopping the turn');
      await fetch(`${COMPANION}/stop`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
      await page.evaluate(() => (window as any).__tramme.stop());
    }
    const isRunning = await page.evaluate(() => (window as any).__tramme.running.value as boolean);
    if (isRunning) { seenRunning = true; idleSince = 0; } else if (!idleSince) idleSince = Date.now();
  }
  await sleep(3000);
  return capped;
}

async function main() {
  const companion = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.tramme', 'companion.json'), 'utf8')).token as string;
  const project = await call<{ id: string }>('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `bench ${brief!.id}`, width, height, duration: brief!.seconds }) });
  for (const f of brief!.files ?? []) {
    if (!fs.existsSync(path.join(here, f))) throw new Error(`${f} is missing: a local brief's footage stays on the machine that has it (bench/local/, never committed)`);
    const r = await fetch(`${base}/api/projects/${project.id}/files/assets/${encodeURIComponent(path.basename(f))}`, { method: 'PUT', body: fs.readFileSync(path.join(here, f)) });
    if (!r.ok) throw new Error(`file ${f}: HTTP ${r.status}`);
  }
  const dir = (() => { for (let n = 1; ; n++) { const d = path.join(outRoot, series, `${brief!.id}-${n}`); if (!fs.existsSync(d)) return d; } })();
  fs.mkdirSync(dir, { recursive: true });
  console.log(`${brief!.id}: project ${base}/p/${project.id}, cap $${cap}, ${model} at ${effort} → ${dir}`);

  const { browser, page } = await launch({ quiet: true });
  const settings = { model, prefer: 'companion', token: companion, apply: 'all', efforts: { [model]: effort }, notify: false };
  // the editor's own page only: the preview's sandboxed frames have no storage
  await page.evaluateOnNewDocument((s, p) => {
    try {
      localStorage.setItem('tramme.assistant', JSON.stringify(s)); localStorage.setItem('tramme.tours', JSON.stringify({ seen: {}, auto: false }));
      // nobody is there to answer: what a user away for long allows in advance (transcriptions), and the picture provider asked for
      localStorage.setItem('tramme.preferences', JSON.stringify({ ...JSON.parse(localStorage.getItem('tramme.preferences') ?? '{}'), assistantTranscribes: true, ...(p ? { pictureProvider: p } : {}) }));
    } catch { /* a sandboxed frame */ }
  }, settings, pictures);
  const start = Date.now();
  let capped = false, error: string | null = null, rhythm: unknown = null;
  try {
    await page.goto(`${base}/p/${project.id}`);
    await page.waitForFunction(() => !!(window as any).__tramme?.send, { timeout: 120000 });
    // the companion answers before the message leaves (no route: the words would wait in the box)
    await page.waitForFunction(() => (window as any).__tramme.aiRoute.value === 'companion', { timeout: 60000 })
      .catch(() => { throw new Error('the companion does not answer the editor: is `node packages/cli/src/main.ts agent --origin http://localhost:8790` running?'); });
    if (dry) console.log('dry run: the project opens and the companion answers; nothing sent');
    else {
      capped = await watch(page, start, companion);
      // the film's rhythm, measured as the critic measures it (the same gates, for every series)
      rhythm = await page.evaluate(() => (window as any).__tramme.rhythm()).catch((e) => { console.error(`rhythm: ${(e as Error).message}`); return null; });
    }
  } catch (e) { error = (e as Error).message; console.error(`\n${error}`); }
  finally { await browser.close(); }
  if (dry && !error) { fs.rmSync(dir, { recursive: true, force: true }); return; }

  // the conversations as the project keeps them, for bench/usage.ts
  const read = async (p: string) => { const r = await fetch(`${base}/api/projects/${project.id}/files/${p}`); return r.ok ? r.text() : null; };
  const index = await read(CHAT_INDEX);
  if (index) {
    fs.mkdirSync(path.join(dir, path.dirname(CHAT_INDEX)), { recursive: true });
    fs.writeFileSync(path.join(dir, CHAT_INDEX), index);
    for (const c of JSON.parse(index) as { id: string }[]) { const text = await read(chatPath(c.id)); if (text) fs.writeFileSync(path.join(dir, chatPath(c.id)), text); }
  }
  const live = transcriptsSince(start);
  fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
  for (const f of live.files) fs.copyFileSync(f, path.join(dir, 'transcripts', path.basename(f)));
  const result = { brief: brief!.id, series, model, effort, pictures: pictures || 'auto', cap, capped, error, dollars: +live.dollars.toFixed(2), requests: live.requests, minutes: +((Date.now() - start) / 60000).toFixed(1), project: `${base}/p/${project.id}`, at: new Date(start).toISOString(), rhythm };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`\n${JSON.stringify(result)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
