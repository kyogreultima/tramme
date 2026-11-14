// What is said in a composition, in its own time: the words of the
// transcripts of the media it plays, each layer mapping its part of the file
// to where it plays. A dressing turns on them: the moments worth an insert
// (a figure, a comparison, a list, a name, a question, a new part) with the
// time of each word they turn on, and where a text's words are said.

import { staticValue } from './props.ts';
import { isTranscript, transcriptIdOf, type Transcript, type TranscriptWord } from './transcript.ts';
import type { Layer, TrammeDoc } from './types.ts';

/** a word folded for matching: lower case, no accent, no punctuation */
export const foldWord = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** the media a layer plays (a sub-clip is its media's), or null */
export function mediaOfLayer(doc: TrammeDoc, l: Layer): string | null {
  if (l.type !== 'video' && l.type !== 'audio') return null;
  const id = staticValue(l.props?.[l.type]);
  if (typeof id !== 'string') return null;
  return doc.assets[id]?.of ?? id;
}

/**
 * The words of a media's transcript where a composition plays them. A
 * transcript of an edit (remapped, with its keeps) is in the composition's
 * time already; a transcript of the file is mapped through each layer playing
 * the media: its start in the file, its rate, its span.
 */
export function spokenWords(doc: TrammeDoc, compId: string, media: string, transcript: Transcript): TranscriptWord[] {
  if (transcript.keeps) return transcript.words.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e));
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const out: TranscriptWord[] = [];
  for (const id of comp.order) {
    const l = comp.layers[id];
    if (!l || l.visible === false || mediaOfLayer(doc, l) !== media) continue;
    const start = Number(staticValue(l.props?.start)) || 0, rate = Number(staticValue(l.props?.rate)) || 1, lin = l.in ?? 0, lout = l.out ?? comp.duration;
    const end = start + (lout - lin) * rate;
    for (const w of transcript.words) {
      const mid = (w.s + w.e) / 2;
      if (!(mid >= start && mid < end)) continue;
      out.push({ w: w.w, s: lin + Math.max(0, w.s - start) / rate, e: lin + Math.min(end - start, w.e - start) / rate });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/** the media a composition plays, each once */
const mediaIn = (doc: TrammeDoc, compId: string) => [...new Set(Object.values(doc.compositions[compId]?.layers ?? {}).map((l) => mediaOfLayer(doc, l)).filter((m): m is string => !!m))];

/** what a composition says, from the transcripts given by `data` (the edit's first, then the file's) */
export function spokenOfDoc(doc: TrammeDoc, compId: string, data: (id: string) => unknown): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const media of mediaIn(doc, compId)) {
    const id = transcriptIdOf(media), edit = data(`${id}-edit`.slice(0, 64)), file = data(id);
    const tr = isTranscript(edit) ? edit : isTranscript(file) ? file : null;
    if (tr) out.push(...spokenWords(doc, compId, media, tr));
  }
  return out.sort((a, b) => a.s - b.s);
}

/** the transcript assets a composition's speech is read from, the edit's first */
export function spokenAssets(doc: TrammeDoc, compId: string): string[] {
  return mediaIn(doc, compId).map((m) => transcriptIdOf(m)).flatMap((id) => [`${id}-edit`.slice(0, 64), id]).filter((id) => doc.assets[id]?.type === 'json');
}

/** a composition dressing someone who speaks: a video it plays has a transcript */
export const isTalking = (doc: TrammeDoc, compId: string) => mediaIn(doc, compId).some((m) => doc.assets[m]?.type === 'video' && !!doc.assets[transcriptIdOf(m)]);

// ── where a text is said ─────────────────────────────────────
/** small words that say nothing of what a text is about */
const STOP = new Set('le la les un une des de du et ou en au aux est sont pas que qui quoi pour par sur dans avec vous nous ils elles on ce ces cette son sa ses leur mon ma mes ton ta tes the a an and or of to in on at is are was for you we they it this that with as be by'.split(' '));

/** the words of a text worth finding in what is said */
export const tokensOf = (text: string) => text.split(/\s+/).map(foldWord).filter((w) => w && (/\d/.test(w) || (w.length >= 2 && !STOP.has(w))));

/** two folded words that say the same: equal, or one the start of the other past 4 letters (plurals, endings) */
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** the most words said between two of a text's words still found in a row */
const GAP_MOST = 6;

export interface Said { s: number; e: number; matched: number; total: number; times: (number | undefined)[] }

/**
 * Where the words of a text are said: the run of the transcript that holds
 * most of them in order (up to six words said between two of them: a title
 * says it shorter than the voice), the one nearest to `near` among the best;
 * null when under `share` of them (half by default) are said within `window`
 * seconds of it.
 */
export function findSpoken(words: TranscriptWord[], text: string, near?: number, window = Infinity, share = 0.5): Said | null {
  const toks = tokensOf(text);
  if (!toks.length) return null;
  const folded = words.map((w) => foldWord(w.w));
  let best: Said | null = null;
  for (let i = 0; i < words.length; i++) {
    if (near !== undefined && Math.abs(words[i].s - near) > window) continue;
    for (let k0 = 0; k0 < toks.length; k0++) {
      if (!same(folded[i], toks[k0])) continue;
      const times: (number | undefined)[] = toks.map(() => undefined);
      let j = i, matched = 0, last = i;
      for (let k = k0; k < toks.length; k++) {
        const m = Array.from({ length: GAP_MOST + 1 }, (_, d) => j + d).find((x) => x < words.length && same(folded[x], toks[k]));
        if (m === undefined) continue;
        times[k] = words[m].s; matched++; last = m; j = m + 1;
      }
      const said: Said = { s: words[i].s, e: words[last].e, matched, total: toks.length, times };
      const closer = (a: Said, b: Said) => near === undefined || Math.abs(a.s - near) < Math.abs(b.s - near);
      if (!best || matched > best.matched || (matched === best.matched && closer(said, best))) best = said;
    }
  }
  return best && best.matched >= Math.max(1, Math.ceil(toks.length * share - 1e-9)) ? best : null;
}

/**
 * When each word of a text is said (the words of the text as split on spaces,
 * small words included): the words found take their time, the others the
 * time of the word before them plus `gap` (or of the next one, minus it, at
 * the start). Null when the text is not said near `near`.
 */
export function spokenTimes(words: TranscriptWord[], text: string, near?: number, window = Infinity, gap = 0.12): { said: Said; times: number[] } | null {
  const said = findSpoken(words, text, near, window);
  if (!said) return null;
  let k = 0;
  const raw = text.split(/\s+/).filter(Boolean).map((w) => (tokensOf(w).length ? said.times[k++] : undefined));
  const firstKnown = raw.find((x) => x !== undefined)!, at = raw.indexOf(firstKnown);
  const times: number[] = [];
  raw.forEach((x, i) => { times.push(x ?? (i < at ? firstKnown - (at - i) * gap : times[i - 1] + gap)); });
  // never before the word before
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1]);
  return { said, times };
}

// ── the moments a dressing turns on ──────────────────────────
export type MomentKind = 'figure' | 'comparison' | 'cause' | 'list' | 'name' | 'question' | 'part';

export interface Moment {
  kind: MomentKind;
  /** when the first word it turns on is said, and when its sentence ends (s) */
  t: number;
  end: number;
  /** the sentence, as said */
  said: string;
  /** the words it turns on, each with the moment it is said: an insert's beats land there */
  beats: { w: string; t: number }[];
}

/** what each kind of moment asks the dressing for (for the assistant) */
export const MOMENT_FORMS: Record<MomentKind, string> = {
  figure: 'the figure large, written as it is said, with what it compares to',
  comparison: 'A then B: the first shown, the second lands on its word, the difference marked (a check, a cross, a bar, a price struck)',
  cause: 'a small diagram: the cause shown, the effect arriving on its word, the arrow between them',
  list: 'one element per item, each landing on its word (a box ticked, a card, an icon, a row of a screen)',
  name: 'what is named, shown: its logo, its interface or a picture of it (from the sources, or asked for)',
  question: 'a section title written word by word with the voice (kinetic-title with spoken)',
  part: 'a new part: a section title written with the voice, or a full-frame insert opening it',
};

const COMPARE = ['contre', 'plutot que', 'au lieu de', 'alors que', 'par rapport', 'compare', 'comparee', 'versus', 'vs', 'instead of', 'rather than', 'compared', 'whereas', 'than'];
/** a word that opposes what comes after it to what came before, inside a sentence */
const BUT = new Set(['mais', 'but', 'pourtant', 'however', 'sauf', 'except']);
/** words said as opposites (their starts): two of a pair in one sentence are a comparison */
const OPPOSITES: [string, string][] = [['gagn', 'perd'], ['win', 'los'], ['gain', 'loss'], ['avant', 'apres'], ['before', 'after'], ['plus', 'moins'], ['more', 'less'], ['riche', 'pauvre'], ['rich', 'poor'], ['expensive', 'cheap'], ['rapide', 'lent'], ['fast', 'slow'], ['facile', 'difficile'], ['easy', 'hard'], ['ancien', 'nouveau'], ['vrai', 'faux'], ['true', 'false'], ['toujours', 'jamais'], ['always', 'never'], ['everything', 'nothing']];
/** the two halves of a cause and its effect */
const CAUSE: [string, string][] = [['si', 'alors'], ['if', 'then'], ['quand', 'alors'], ['when', 'then']];
const BECAUSE = ['parce que', 'because', 'grace a', 'thanks to', 'ce qui fait que', 'which means'];
/** a word that asks, near the start of a sentence: a question the transcript did not punctuate */
const ASK = /^(comment|pourquoi|combien|questce|how|why|what|which|quel|quelle|quels|quelles)$/;
const PART_START = new Set(['alors', 'maintenant', 'ensuite', 'premierement', 'deuxiemement', 'troisiemement', 'enfin', 'bref', 'so', 'now', 'next', 'finally', 'first', 'firstly', 'secondly']);
const ORDINAL = /^(premier|premiere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|sixieme|septieme|first|second|third|fourth|fifth|sixth|seventh|etape|step|principe|regle|rule|lecon|lesson)$/;
const UNIT = /^(€|\$|%|euros?|dollars?|pourcent|percent|fois|times|ans?|mois|jours?|heures?|minutes?|secondes?|years?|months?|days?|hours?|millions?|milliards?|billions?|k|m)$/;
/** a pause this long between two words ends a sentence (s) */
const SENTENCE_PAUSE = 0.7;

interface Sentence { words: TranscriptWord[]; gapBefore: number }

function sentencesOf(words: TranscriptWord[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: TranscriptWord[] = [], gap = 0;
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.!?…]["»)]*$/.test(w.w) || next.s - w.e > SENTENCE_PAUSE) { out.push({ words: cur, gapBefore: gap }); cur = []; gap = next ? next.s - w.e : 0; }
  });
  return out;
}

/** the moments of what is said worth an insert, in order, each with the words it turns on */
export function speechMoments(words: TranscriptWord[]): Moment[] {
  const out: Moment[] = [];
  for (const { words: ws, gapBefore } of sentencesOf(words)) {
    const said = ws.map((w) => w.w).join(' ').replace(/\s+([,.;:!?…])/g, '$1'), end = ws[ws.length - 1].e;
    const f = ws.map((w) => foldWord(w.w));
    const push = (kind: MomentKind, beats: { w: string; t: number }[]) => { if (beats.length) out.push({ kind, t: beats[0].t, end, said, beats }); };
    // a question, or a new part (a word that opens one, an ordinal near the start, a long pause before)
    const asks = ws.length >= 5 && f.slice(0, 4).some((x) => ASK.test(x));
    if (/\?["»)]*$/.test(ws[ws.length - 1].w) || asks) push('question', [{ w: ws[0].w, t: ws[0].s }]);
    else if (PART_START.has(f[0]) || f.slice(0, 4).some((x) => ORDINAL.test(x)) || gapBefore >= 1.2) push('part', [{ w: ws[0].w, t: ws[0].s }]);
    // figures, with their unit; two in a sentence are a comparison
    const figures = ws.flatMap((w, i) => (/\d/.test(w.w) ? [{ w: UNIT.test(f[i + 1] ?? '') ? `${w.w} ${ws[i + 1].w}` : w.w, t: w.s }] : []));
    const joined = ` ${f.join(' ')} `, marker = COMPARE.find((m) => joined.includes(` ${m} `));
    if (marker) {
      const at = f.findIndex((x, i) => ` ${f.slice(i, i + marker.split(' ').length).join(' ')} ` === ` ${marker} `);
      push('comparison', [...(figures.length ? [figures[0]] : [{ w: ws[0].w, t: ws[0].s }]), { w: ws[at].w, t: ws[at].s }, ...figures.slice(1)].sort((a, b) => a.t - b.t));
    } else if (figures.length >= 2) push('comparison', figures);
    else {
      // two opposites said in one sentence, or a "but" inside it: A then B
      const pair = OPPOSITES.map(([a, b]) => [f.findIndex((x) => x.startsWith(a)), f.findIndex((x) => x.startsWith(b))]).find(([i, j]) => i >= 0 && j >= 0 && i !== j);
      const but = f.findIndex((x, i) => i >= 3 && BUT.has(x));
      if (pair) push('comparison', pair.sort((x, y) => x - y).map((i) => ({ w: ws[i].w.replace(/[,.;:!?…]+$/, ''), t: ws[i].s })));
      else if (but >= 0) push('comparison', [{ w: ws[0].w, t: ws[0].s }, { w: ws[but].w, t: ws[but].s }]);
      if (figures.length === 1) push('figure', figures);
    }
    // a cause and its effect
    const cause = CAUSE.map(([a, b]) => [f.indexOf(a), f.lastIndexOf(b)]).find(([i, j]) => i >= 0 && j > i + 1);
    const because = BECAUSE.find((m) => joined.includes(` ${m} `));
    const becauseAt = because ? f.findIndex((_, i) => f.slice(i, i + because.split(' ').length).join(' ') === because) : -1;
    if (cause) push('cause', cause.map((i) => ({ w: ws[i].w, t: ws[i].s })));
    else if (becauseAt > 0) push('cause', [{ w: ws[0].w, t: ws[0].s }, { w: ws[becauseAt].w, t: ws[becauseAt].s }]);
    // a list: three items or more between commas, each short
    const items: TranscriptWord[][] = [[]];
    for (const w of ws) { items[items.length - 1].push(w); if (/,$/.test(w.w)) items.push([]); }
    const filled = items.filter((x) => x.length);
    // the first item is the end of what opens the sentence: its last words
    if (filled.length >= 3 && filled.slice(1).every((x) => x.length <= 5)) push('list', [filled[0].slice(-Math.min(filled[0].length, 3)), ...filled.slice(1)].map((x) => ({ w: x.map((w) => w.w.replace(/,$/, '')).join(' '), t: x[0].s })));
    // names (a brand, a product, a person): the capitals inside the sentence, in one moment; at its start, one joined to another by "and"
    const capital = (i: number) => i < ws.length && /^\p{Lu}/u.test(ws[i].w.replace(/^["«(]+/, '')) && f[i].length >= 2;
    const names = ws.map((_, i) => i).filter((i) => capital(i) && (i > 0 ? !/[.!?:]$/.test(ws[i - 1].w) : ['et', 'and', 'ou', 'or'].includes(f[1] ?? '') && capital(2)));
    if (names.length) push('name', names.map((i) => ({ w: ws[i].w.replace(/^["«(]+|[,.;:!?…"»)]+$/g, ''), t: ws[i].s })));
  }
  return out;
}
