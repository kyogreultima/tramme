// What the conversations of a project cost, turn by turn: the usage line each
// turn ends with (tool calls, pictures seen, tokens, route, time), priced in
// dollars where the model has a price, and added up per conversation and in all.
//
//   node bench/usage.ts <project folder | project.tramme>
//   node bench/usage.ts --compare <before> <after>
//
// --compare takes two series of runs on the same briefs: each a project, or a
// folder holding one project per run (folders or .tramme files). It prints the
// cost, the share read from the cache, the tokens written and the time of
// each, and what changed.

import fs from 'node:fs';
import path from 'node:path';
import { CHAT_INDEX, chatPath, unpackProject } from '@tramme/project';
import type { TurnUsage } from '../apps/editor/src/api.ts';
import { cacheShare, compare, costOf, lowerBound, totalsOf, type Totals } from './cost.ts';

/** a project's text files by path, from a folder or an archive */
async function files(target: string): Promise<(p: string) => string | null> {
  if (fs.statSync(target).isDirectory()) return (p) => (fs.existsSync(path.join(target, p)) ? fs.readFileSync(path.join(target, p), 'utf8') : null);
  const all = await unpackProject(new Uint8Array(fs.readFileSync(target)));
  return (p) => { const f = all.get(p); return f ? new TextDecoder().decode(f) : null; };
}

/** the conversations of a project, each with the usage of its turns (the turn's number is its user message's) */
async function conversations(target: string): Promise<{ title: string; turns: { turn: number; usage: TurnUsage }[] }[]> {
  const read = await files(target);
  const index = JSON.parse(read(CHAT_INDEX) ?? '[]') as { id: string; title: string }[];
  return index.map((chat) => {
    const c = JSON.parse(read(chatPath(chat.id)) ?? '{"items":[]}') as { items: { usage?: TurnUsage; role: string }[] };
    let turn = 0;
    const turns: { turn: number; usage: TurnUsage }[] = [];
    for (const it of c.items) {
      if (it.role === 'user') turn++;
      if (it.usage) turns.push({ turn, usage: it.usage });
    }
    return { title: chat.title, turns };
  });
}

/** the projects of a series: the path itself when it is a project, otherwise the projects inside it */
function runs(series: string): string[] {
  if (!fs.existsSync(series)) throw new Error(`${series}: not found`);
  if (!fs.statSync(series).isDirectory()) return [series];
  if (fs.existsSync(path.join(series, CHAT_INDEX))) return [series];
  return fs.readdirSync(series).map((n) => path.join(series, n)).filter((p) => fs.statSync(p).isDirectory() ? fs.existsSync(path.join(p, CHAT_INDEX)) : p.endsWith('.tramme'));
}

const k = (n: number) => `${Math.round(n / 1000)} k`;
const money = (turns: TurnUsage[]) => { const d = totalsOf(turns).dollars; return d === null ? 'cost unknown' : `${lowerBound(turns) ? 'at least ' : ''}$${d.toFixed(2)}`; };
const pct = (x: number) => `${Math.round(x * 100)} %`;

function line(u: TurnUsage) {
  const c = costOf(u);
  const cost = c ? `${c.lowerBound ? 'at least ' : ''}$${c.dollars.toFixed(2)}` : 'cost unknown';
  return `${u.tools} tool calls, ${u.images} pictures, ${k(u.input + u.cacheRead + u.cacheWrite)} tokens read (${k(u.cacheRead)} from the cache, ${pct(cacheShare(u))}), ${k(u.output)} written, ${(u.ms / 60000).toFixed(1)} min, ${u.model}${u.route ? `, ${u.route}` : ''}, ${cost}`;
}

function summary(turns: TurnUsage[]) {
  const t = totalsOf(turns);
  const read = turns.reduce((n, u) => n + u.input + u.cacheRead + u.cacheWrite, 0);
  return `${turns.reduce((n, u) => n + u.tools, 0)} tool calls, ${turns.reduce((n, u) => n + u.images, 0)} pictures, ${k(read)} tokens read (${pct(t.cacheShare)} from the cache), ${k(t.output)} written, ${(t.ms / 60000).toFixed(1)} min, ${money(turns)}`;
}

async function report(target: string) {
  const all: TurnUsage[] = [];
  for (const chat of await conversations(target)) {
    console.log(`\n${chat.title}`);
    for (const { turn, usage } of chat.turns) console.log(`  turn ${turn}: ${line(usage)}`);
    if (chat.turns.length) console.log(`  conversation: ${summary(chat.turns.map((t) => t.usage))}`);
    all.push(...chat.turns.map((t) => t.usage));
  }
  console.log(`\nIn all: ${summary(all)}`);
}

async function turnsOfSeries(series: string): Promise<{ runs: number; turns: TurnUsage[] }> {
  const list = runs(series), turns: TurnUsage[] = [];
  for (const run of list) for (const chat of await conversations(run)) turns.push(...chat.turns.map((t) => t.usage));
  return { runs: list.length, turns };
}

const signed = (n: number, f: (x: number) => string) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${f(Math.abs(n))}`;
const dollars = (d: number | null) => (d === null ? 'unknown' : `$${d.toFixed(2)}`);
const row = (name: string, t: Totals, change?: boolean) => change
  ? `  ${name.padEnd(8)} ${t.dollars === null ? 'unknown' : signed(t.dollars, (x) => `$${x.toFixed(2)}`)}, cache share ${signed(t.cacheShare * 100, (x) => `${x.toFixed(1)} points`)}, ${signed(t.output, k)} written, ${signed(t.ms / 60000, (x) => `${x.toFixed(1)} min`)}`
  : `  ${name.padEnd(8)} ${dollars(t.dollars)}, cache share ${pct(t.cacheShare)}, ${k(t.output)} written, ${(t.ms / 60000).toFixed(1)} min`;

async function compareSeries(before: string, after: string) {
  const [a, b] = [await turnsOfSeries(before), await turnsOfSeries(after)];
  const r = compare(a.turns, b.turns);
  console.log(`before: ${before} (${a.runs} runs, ${a.turns.length} turns)${lowerBound(a.turns) ? ', some costs are lower bounds' : ''}`);
  console.log(`after:  ${after} (${b.runs} runs, ${b.turns.length} turns)${lowerBound(b.turns) ? ', some costs are lower bounds' : ''}\n`);
  console.log(row('before', r.before));
  console.log(row('after', r.after));
  console.log(row('change', r.change, true));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const help = 'usage: node bench/usage.ts <project folder | project.tramme>\n       node bench/usage.ts --compare <before> <after>';
  try {
    if (args[0] === '--compare') {
      if (args.length !== 3) { console.log(help); process.exit(1); }
      await compareSeries(args[1], args[2]);
    } else if (args.length === 1 && fs.existsSync(args[0])) await report(args[0]);
    else { console.log(help); process.exit(1); }
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
