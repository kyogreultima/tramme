// The takes chosen against the script: a creator says each sentence of their
// script, often several times, with false starts and words off the script in
// between. The recording's transcript is read against the script, sentence by
// sentence: each place a sentence was said is a take, scored by how many of
// its words were said in order; the last good take of each sentence is kept
// (one says it again because the earlier one was not right), in the order of
// the script, and the rest is cut. The script is kept with the project
// (meta.script), where the assistant reads it, and given again or changed by
// the tool's input.

import { pointer, type Op, type ToolContext, type ToolType, type TranscriptWord } from '@tramme/core';
import { spliceLayer } from './cuts.ts';
import { t } from './i18n/index.ts';

/** a word as it is compared: lower case, no accents, no punctuation */
export const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}']+/gu, '');

/** the script's sentences: cut at . ! ? … and at line ends, empty ones left out */
export function sentencesOf(script: string): string[] {
  return script.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).map(norm).filter(Boolean).length > 0);
}

/** the length of the longest run of words two lists share in order */
function common(a: string[], b: string[]): number {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = up;
    }
  }
  return row[b.length];
}

/** one place a sentence was said: its first and last word in the transcript, and how much of it was said (0..1) */
export interface Take { first: number; last: number; score: number }
export interface Chosen { sentence: string; takes: Take[]; kept: Take | null }

/**
 * Each sentence's takes in the words, and the one kept: the last whose score
 * reaches `good` (else the best, if it reaches `found`), never before the take
 * kept for the sentence before it when one after it exists.
 */
export function chooseTakes(sentences: string[], words: TranscriptWord[], { good = 0.8, found = 0.5 } = {}): Chosen[] {
  const said = words.map((w) => norm(w.w));
  const out: Chosen[] = [];
  let after = -1;
  for (const sentence of sentences) {
    const want = sentence.split(/\s+/).map(norm).filter(Boolean), n = want.length;
    // every window that starts on one of the sentence's words, a little shorter or longer than it
    const raw: Take[] = [];
    for (let i = 0; i < said.length; i++) {
      if (!want.includes(said[i])) continue;
      let best: Take | null = null;
      for (let len = Math.max(1, Math.floor(n * 0.7)); len <= Math.ceil(n * 1.3) && i + len <= said.length; len++) {
        // the share of the sentence said, against the length of the window: a window over two takes scores low
        const score = common(want, said.slice(i, i + len)) / Math.max(n, len);
        if (!best || score > best.score + 1e-9) best = { first: i, last: i + len - 1, score };
      }
      if (best && best.score >= found) raw.push(best);
    }
    // the takes: the best windows first, each one that overlaps a better one left out; then in the order said
    const takes: Take[] = [];
    for (const k of raw.sort((a, b) => b.score - a.score || a.first - b.first)) if (!takes.some((x) => k.first <= x.last && x.first <= k.last)) takes.push(k);
    takes.sort((a, b) => a.first - b.first);
    // trim each take to the words of the sentence it holds (a window may run onto the next sentence's first words)
    for (const k of takes) {
      while (k.last > k.first && !want.includes(said[k.last])) k.last--;
      while (k.first < k.last && !want.includes(said[k.first])) k.first++;
    }
    const later = takes.filter((k) => k.first > after);
    const pool = later.length ? later : takes;
    const kept = [...pool].reverse().find((k) => k.score >= good) ?? (pool.length ? pool.reduce((a, b) => (b.score > a.score ? b : a)) : null);
    if (kept) after = kept.last;
    out.push({ sentence, takes, kept });
  }
  return out;
}

/** the spans of the file to keep, in the order of the script: each kept take with a breath around it */
export function keptSpans(chosen: Chosen[], words: TranscriptWord[], { before = 0.08, after = 0.15 } = {}): { from: number; to: number }[] {
  return chosen.filter((c) => c.kept).map((c) => ({ from: Math.max(0, words[c.kept!.first].s - before), to: words[c.kept!.last].e + after }));
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export const TAKES_TOOLS: ToolType[] = [
  {
    name: 'takes',
    title: 'Keep the takes of the script',
    description: 'reads a talking video against the script: for each sentence, the last good take is kept, in the order of the script; the repeats, false starts and words off the script are cut. The script is kept with the project.',
    input: {
      type: 'object',
      properties: {
        video: { type: 'string', format: 'asset', assetType: 'video', title: 'Video' },
        script: { type: 'string', title: 'Script', description: 'what was meant to be said; kept with the project (meta.script), which is used when it is not given' },
      },
    },
    ai: { when: 'a recording of someone reading or saying a script, with retakes; transcribe it first', avoid: 'an interview or a free talk with no script: there is nothing to read it against' },
    async run({ video: wanted, script: given }: { video?: string; script?: string }, ctx: ToolContext) {
      const script = (given ?? (typeof ctx.doc.meta.script === 'string' ? ctx.doc.meta.script : '')).trim();
      if (!script) throw new Error('no script: give it (script), it is then kept with the project');
      const vids = Object.entries(ctx.doc.assets).filter(([, a]) => a.type === 'video');
      const asset = wanted ?? vids.find(([aid]) => ctx.selection.includes(aid))?.[0] ?? vids.at(-1)?.[0];
      if (!asset) throw new Error('the project has no video: bring one in first');
      const comp = ctx.doc.compositions[ctx.compId];
      const lid = comp.order.find((id) => comp.layers[id]?.type === 'video' && comp.layers[id]?.props?.video === asset);
      if (!lid) throw new Error(`${asset} is not placed in this composition: place it first`);
      if ((Number(comp.layers[lid].props?.rate) || 1) !== 1) throw new Error(`"${lid}" plays at another speed: set it back to normal speed first`);
      const words = (await ctx.transcript(asset)).words.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e)).sort((a, b) => a.s - b.s);
      if (words.length < 3) throw new Error(`${asset}: its transcript has too few words (transcribe it first)`);
      const sentences = sentencesOf(script);
      const chosen = chooseTakes(sentences, words);
      const spans = keptSpans(chosen, words);
      if (!spans.length) throw new Error(`${asset}: none of the script's sentences was found in what is said`);
      const missing = chosen.filter((c) => !c.kept).map((c) => c.sentence);
      const { ops, end } = spliceLayer(ctx, lid, spans);
      const meta: Op[] = given ? [{ op: ctx.doc.meta.script === undefined ? 'add' : 'replace', path: pointer('meta', 'script'), value: given }] : [];
      const before = (Number(comp.layers[lid].out ?? comp.duration) - (comp.layers[lid].in ?? 0));
      const repeats = chosen.reduce((n, c) => n + Math.max(0, c.takes.length - 1), 0);
      const label = t('takes.done', { kept: spans.length, total: sentences.length });
      return {
        ops: [...meta, ...ops], label, notice: label,
        text: [
          `${spans.length} of the script's ${sentences.length} sentences kept, each its last good take, in the order of the script (${repeats} other take(s) cut). The piece went from ${r2(before)} s to ${r2(end - (comp.layers[lid].in ?? 0))} s.`,
          ...chosen.filter((c) => c.kept).map((c, i) => `${i + 1}. "${c.sentence}": take ${c.takes.indexOf(c.kept!) + 1} of ${c.takes.length}, ${Math.round(c.kept!.score * 100)} % of its words said`),
          ...(missing.length ? [`Not found in what is said: ${missing.map((s) => `"${s}"`).join(', ')}. Say whether to keep a take of them by hand.`] : []),
          'Words said off the script were cut with the rest; look at the joins (motion) and tell the user what was left out.',
        ].join('\n'),
      };
    },
  },
];
