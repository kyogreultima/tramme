// node bench/series.ts <series> [<other series>]   (folders under out/bench, or paths)
//
// The runs of bench/run.ts side by side: per brief, what each cost (read from
// Claude Code's transcripts, so a turn stopped at its cap is counted whole),
// its requests, its time, and whether the cap stopped it. With a second
// series, the change brief by brief and in all, on the briefs both ran.

import fs from 'node:fs';
import path from 'node:path';

interface Run { brief: string; dollars: number; requests: number; minutes: number; capped: boolean; error: string | null; effort?: string }

const dirOf = (s: string) => (fs.existsSync(s) ? s : path.join('out', 'bench', s));

/** the runs of a series by brief (the last run of a brief when it ran twice) */
function series(name: string): Map<string, Run> {
  const dir = dirOf(name), out = new Map<string, Run>();
  if (!fs.existsSync(dir)) throw new Error(`no series at ${dir}`);
  for (const d of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, d, 'run.json');
    if (fs.existsSync(file)) { const r = JSON.parse(fs.readFileSync(file, 'utf8')) as Run; out.set(r.brief, r); }
  }
  return out;
}

const money = (x: number) => `$${x.toFixed(2)}`;
const pct = (a: number, b: number) => (a ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)} %` : '');
const line = (r: Run) => `${money(r.dollars)}, ${r.requests} requests, ${r.minutes} min${r.capped ? ', stopped at the cap' : ''}${r.error ? `, failed: ${r.error}` : ''}`;

const [a, b] = process.argv.slice(2);
if (!a) { console.error('usage: node bench/series.ts <series> [<other series>]'); process.exit(1); }
const first = series(a);
if (!b) {
  for (const r of first.values()) console.log(`${r.brief.padEnd(18)} ${line(r)}`);
  const all = [...first.values()];
  console.log(`${'in all'.padEnd(18)} ${money(all.reduce((n, r) => n + r.dollars, 0))}, ${all.length} runs, ${all.filter((r) => r.capped).length} stopped at the cap`);
} else {
  const second = series(b), both = [...first.keys()].filter((k) => second.has(k));
  let x = 0, y = 0;
  for (const k of both) {
    const r = first.get(k)!, s = second.get(k)!;
    x += r.dollars; y += s.dollars;
    console.log(`${k.padEnd(18)} ${money(r.dollars)} → ${money(s.dollars)} (${pct(r.dollars, s.dollars)}), requests ${r.requests} → ${s.requests}, ${r.minutes} → ${s.minutes} min${r.capped || s.capped ? `  [cap: ${r.capped ? 'before' : ''}${r.capped && s.capped ? ' and ' : ''}${s.capped ? 'after' : ''}]` : ''}`);
  }
  console.log(`${'in all'.padEnd(18)} ${money(x)} → ${money(y)} (${pct(x, y)}) on ${both.length} briefs; a run stopped at its cap costs at least what it shows`);
}
