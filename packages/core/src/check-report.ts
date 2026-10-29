// The report of the quality checks as the assistant reads it: issues of one
// cause folded into a line (38 texts too small in one scene are one thing to
// fix, not 38), ranked, and capped so what reaches the model can be acted on.

import type { QualityIssue } from './checks.ts';
import type { TrammeDoc } from './types.ts';

/** a number to two decimals, as the messages say moments and sizes */
export const s2 = (n: number) => +n.toFixed(2);

/** how many warnings and notes in all (issues, not kinds) */
export function reportCounts(issues: QualityIssue[]): { warnings: number; notes: number } {
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return { warnings, notes: issues.length - warnings };
}

/** the first line of a report: the counts, or that nothing was found */
export function reportHead(issues: QualityIssue[]): string {
  const { warnings, notes } = reportCounts(issues);
  return issues.length ? `${warnings} warning(s), ${notes} note(s).` : 'No issue found by the checks.';
}

/** what makes two issues of one check the same problem: their template, else their words without the names and figures */
const kindOf = (i: QualityIssue) => i.say?.text ?? i.message.replace(/"[^"]*"/g, '"#"').replace(/\S*\d\S*/g, '#');

/** a kind of issue: the check that found it and its severity, with everything it found */
export interface IssueGroup {
  check: string;
  severity: 'warning' | 'info';
  count: number;
  /** the issue to show first: the highest rank, else the first found */
  worst: QualityIssue;
  /** the layers concerned, each once, in the order found */
  layers: string[];
  /** the first and the last moment found (s) */
  from?: number;
  to?: number;
  /** every moment found, in order found */
  times: number[];
}

/**
 * The composition a placed layer sits in. A checked layer's id carries the
 * composition layers it is played through as a prefix (`s2/title`, a
 * distribution adding its rank: `cards#3/title`); each hop reads the
 * composition that layer plays.
 */
export function compositionOf(doc: TrammeDoc, compId: string, layerId: string): string {
  let cur = compId;
  for (const hop of layerId.split('/').slice(0, -1)) {
    const next = doc.compositions[cur]?.layers[hop.replace(/#\d+$/, '')]?.props?.comp;
    if (typeof next !== 'string' || !doc.compositions[next]) return cur;
    cur = next;
  }
  return cur;
}

/** the issues folded by check, severity and kind of problem: warnings first, then the groups with the most issues */
export function groupIssues(issues: QualityIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const i of issues) {
    const key = `${i.severity}|${i.check}|${kindOf(i)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { check: i.check, severity: i.severity, count: 0, worst: i, layers: [], times: [] });
    g.count++;
    if ((i.rank ?? -Infinity) > (g.worst.rank ?? -Infinity)) g.worst = i;
    for (const id of i.layers ?? []) if (!g.layers.includes(id)) g.layers.push(id);
    if (i.t !== undefined) { g.from = Math.min(g.from ?? i.t, i.t); g.to = Math.max(g.to ?? i.t, i.t); g.times.push(i.t); }
  }
  const rank = (g: IssueGroup) => (g.severity === 'warning' ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

/** the groups a report lists before it counts the rest */
export const REPORT_MAX = 12;
const LAYERS_SHOWN = 5, COMPOSITIONS_SHOWN = 3;

/** the compositions a group's layers sit in, by name, in the order found */
function placesOf(g: IssueGroup, doc: TrammeDoc, compId: string): string {
  const ids = [...new Set(g.layers.map((l) => compositionOf(doc, compId, l)))];
  const names = ids.slice(0, COMPOSITIONS_SHOWN).map((id) => `"${doc.compositions[id]?.name ?? id}"`);
  return `${names.join(', ')}${ids.length > COMPOSITIONS_SHOWN ? `, +${ids.length - COMPOSITIONS_SHOWN} more` : ''}`;
}

/** a line per group (at most `max`, REPORT_MAX by default), then one line for what was left out */
export function reportLines(groups: IssueGroup[], opts: { doc: TrammeDoc; compId: string; max?: number }): { lines: string[]; hidden: number } {
  const max = opts.max ?? REPORT_MAX, shown = groups.slice(0, max), left = groups.slice(max);
  const lines = shown.map((g) => {
    // one issue prints as it was found
    if (g.count === 1) return `- [${g.severity}] ${g.worst.message}${g.worst.layers?.length ? ` (layers: ${g.worst.layers.join(', ')})` : ''}`;
    const where = g.layers.length ? ` in ${placesOf(g, opts.doc, opts.compId)}` : '';
    // layers say where an issue is; without them its moments do (every one, not the span between the first and the last)
    const span = g.layers.length ? (g.from !== undefined && g.to !== undefined && g.to > g.from ? ` (${s2(g.from)} s to ${s2(g.to)} s)` : '')
      : g.times.length ? ` at ${g.times.slice(0, 6).map((t) => `${s2(t)} s`).join(', ')}${g.times.length > 6 ? `, +${g.times.length - 6} more` : ''}` : '';
    const some = g.layers.slice(0, LAYERS_SHOWN).join(', ');
    const more = g.layers.length > LAYERS_SHOWN ? `, +${g.layers.length - LAYERS_SHOWN} more` : '';
    return `- [${g.severity}] ${g.check} x${g.count}${where}${span}, worst: ${g.worst.message}${g.layers.length ? ` (layers: ${some}${more})` : ''}`;
  });
  if (left.length) {
    const issues = left.reduce((n, g) => n + g.count, 0);
    lines.push(`- ${left.length} more kind(s) of issue, ${issues} issue(s) in all, not listed: ${left.map((g) => `${g.check} x${g.count}`).join(', ')}.`);
  }
  return { lines, hidden: left.length };
}
