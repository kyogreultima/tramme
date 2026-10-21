// The figures of `tramme load`: per load case, the time per frame and its
// parts, what holds it back, and the change against an earlier run (a file
// saved with --json), so a change is compared before and after.

import { CAUSE, PARTS, type FrameParts } from '@tramme/render/src/timing.ts';

export interface LoadResult {
  id: string;
  title: string;
  frames: number;
  /** wall time per frame, ms */
  ms: number;
  /** its parts per frame, ms */
  parts: FrameParts;
}

/** what holds the case back: the cause whose parts add up to the most time */
export function holdsBack(parts: FrameParts): string {
  const by = new Map<string, number>();
  for (const k of PARTS) by.set(CAUSE[k], (by.get(CAUSE[k]) ?? 0) + parts[k]);
  return [...by].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

const ms = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0));
/** "-12 %" against the earlier figure; empty when there is none */
const delta = (now: number, was?: number) => (was === undefined || was <= 0 ? '' : `${now >= was ? '+' : ''}${Math.round(((now - was) / was) * 100)} %`);

/** a table: one line per case, its parts per frame, what holds it back, and the change against `before` */
export function loadTable(results: LoadResult[], before: LoadResult[] = []): string {
  const was = new Map(before.map((r) => [r.id, r]));
  const head = ['case', 'ms/frame', ...PARTS, 'held back by'];
  const rows = results.map((r) => {
    const b = was.get(r.id);
    const cell = (now: number, then?: number) => { const d = delta(now, then); return d ? `${ms(now)} (${d})` : ms(now); };
    return [r.id, cell(r.ms, b?.ms), ...PARTS.map((k) => cell(r.parts[k], b?.parts[k])), holdsBack(r.parts)];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 || i === cells.length - 1 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
}
