// The checks of a video where someone speaks, dressed: what makes the edit
// look amateur though every frame is clean. A word on screen that comes
// after it is said; an insert that holds still while the voice goes on; two
// inserts in a row built the same way. Measured on the composition's samples
// and on what is said (the transcripts the checks are given).

import { s2 } from './check-report.ts';
import { overlapArea as area } from './math.ts';
import { findSpoken, spokenOfDoc, tokensOf } from './spoken.ts';
import type { CheckType, PlacedLayer, QualityIssue, Sample } from './checks.ts';
import type { Rect } from './registry.ts';
import type { Composition, TrammeDoc } from './types.ts';

export interface Speaker {
  media: string;
  /** a placed layer of the speaker's footage */
  is(p: PlacedLayer): boolean;
  /** a placed layer of the dressing: on screen, not the speaker, not sound or captions, not a container, not there all film long */
  dresses(p: PlacedLayer): boolean;
}

/**
 * The speaker of a talking video: the media that fills the frame in most of
 * the samples, however it was cut; null when no media does.
 */
export function speakerIn(samples: Sample[], doc: TrammeDoc, comp: Composition): Speaker | null {
  const frame = comp.width * comp.height, whole: Rect = { x: 0, y: 0, w: comp.width, h: comp.height };
  // the media of a layer as it plays (its props evaluated): a sub-clip is its media's
  const mediaOf = (p: PlacedLayer) => { if (p.node.type !== 'video') return null; const id = String(p.props.video); return doc.assets[id]?.of ?? id; };
  const filled = new Map<string, number>();
  for (const s of samples) {
    const here = new Set<string>();
    for (const p of s.layers) { const m = mediaOf(p); if (m && p.opacity > 0.3 && p.box && area(p.box, whole) >= 0.6 * frame) here.add(m); }
    for (const a of here) filled.set(a, (filled.get(a) ?? 0) + 1);
  }
  const [media, n] = [...filled.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (media === undefined || n < samples.length / 2) return null;
  // what is on screen all film long (a logo, a frame, a progress bar) dresses nothing
  const seen = new Map<string, number>();
  for (const s of samples) for (const p of s.layers) if (p.opacity > 0.3) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
  const is = (p: PlacedLayer) => mediaOf(p) === media;
  return {
    media, is,
    dresses: (p) => p.opacity > 0.3 && !is(p) && p.node.type !== 'audio' && p.node.type !== 'captions' && p.node.composes !== 'adjust' && !p.node.container && (seen.get(p.id) ?? 0) <= 0.8 * samples.length,
  };
}

// ── words on their voice ─────────────────────────────────────
/** a word on screen this long after it is said comes late (s) */
export const WORD_LATE = 0.5;
/** this long before it is said, it gives the line away (s) */
export const WORD_EARLY = 2;
/** a text of more words than this is a sentence on screen, not a keyword */
const KEYWORD_MOST = 8;

export const wordSync: CheckType = {
  name: 'word-sync', title: 'Words off their voice', description: 'a keyword or a title over a talking video appearing after its words are said, or long before',
  texts: ['"{name}" appears at {t} s, {late} s after "{word}" is said', '"{name}" appears at {t} s, {early} s before "{word}" is said'],
  run({ samples, doc, comp, compId, data }) {
    const speaker = speakerIn(samples, doc, comp);
    if (!speaker) return [];
    const words = spokenOfDoc(doc, compId, data);
    if (!words.length) return [];
    // when each text appears: its first sample on screen
    const first = new Map<string, { t: number; p: PlacedLayer }>();
    for (const s of samples) for (const p of s.layers) {
      if (first.has(p.id) || p.node.type === 'captions' || p.textSize === undefined || !p.text?.trim() || !speaker.dresses(p)) continue;
      if (p.text.trim().split(/\s+/).length <= KEYWORD_MOST) first.set(p.id, { t: s.t, p });
    }
    const out: QualityIssue[] = [];
    for (const [id, { t, p }] of first) {
      // two thirds of its words said: a heading that names an idea is not measured against one of its words said elsewhere
      const said = findSpoken(words, p.text!, t, 6, 2 / 3);
      if (!said) continue;
      const k = said.times.findIndex((x) => x !== undefined), at = said.times[k]!, word = p.text!.split(/\s+/).filter((w) => tokensOf(w).length)[k] ?? p.text!;
      const name = p.layer.name ?? id, late = s2(t - at), early = s2(at - t);
      if (t - at > WORD_LATE) out.push({
        check: 'word-sync', severity: 'warning', t: s2(t), layers: [id], rank: t - at,
        message: `"${name}" appears at ${s2(t)} s, ${late} s after "${word}" is said (${s2(at)} s): start it on the word, its entrance landing as it is said.`,
        say: { text: '"{name}" appears at {t} s, {late} s after "{word}" is said', params: { name, t: s2(t), late, word } },
      });
      else if (at - t > WORD_EARLY) out.push({
        check: 'word-sync', severity: 'info', t: s2(t), layers: [id], rank: at - t,
        message: `"${name}" appears at ${s2(t)} s, ${early} s before "${word}" is said (${s2(at)} s): it gives the line away; bring it in on the word.`,
        say: { text: '"{name}" appears at {t} s, {early} s before "{word}" is said', params: { name, t: s2(t), early, word } },
      });
    }
    return out;
  },
};

// ── inserts ──────────────────────────────────────────────────
/** the dressing covers at least this share of the frame (its layers' joint box): an insert, not a keyword */
const INSERT_SHARE = 0.25;
/** an insert shorter than this is a flash, not an insert (s) */
const INSERT_LEAST = 1;
/** inside an insert, this long with nothing new is a defect: its story needs its next beat (s) */
export const INSERT_HOLD = 2.5;
/** layers that drift by themselves: a texture or particles moving is no beat */
const AMBIENT = new Set(['shader', 'particles']);

export interface Insert {
  from: number;
  to: number;
  /** the samples it spans, with their dressing */
  samples: { t: number; layers: PlacedLayer[]; speaker: PlacedLayer | null }[];
}

/** the inserts over a talking video: spans where the dressing (words alone left out) covers a quarter of the frame or more */
export function insertsOf(samples: Sample[], comp: Composition, speaker: Speaker, step: number): Insert[] {
  const frame = comp.width * comp.height, whole: Rect = { x: 0, y: 0, w: comp.width, h: comp.height };
  const out: Insert[] = [];
  let cur: Insert | null = null;
  const close = () => { if (cur && cur.to - cur.from >= INSERT_LEAST) out.push(cur); cur = null; };
  for (const s of samples) {
    const layers = s.layers.filter((p) => speaker.dresses(p) && p.box);
    const boxes = layers.map((p) => p.box!);
    const joint = boxes.length ? boxes.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) })) : null;
    const covers = !!joint && area(joint, whole) >= INSERT_SHARE * frame && layers.some((p) => p.textSize === undefined);
    const roots = new Set(layers.map((p) => p.id.split('/')[0]));
    // a new insert when none of the layers of the last sample are there any more
    if (cur && covers && cur.samples.length && ![...new Set(cur.samples[cur.samples.length - 1].layers.map((p) => p.id.split('/')[0]))].some((r) => roots.has(r))) close();
    if (covers) {
      cur ??= { from: s.t, to: s.t, samples: [] };
      cur.to = s.t + step;
      cur.samples.push({ t: s.t, layers, speaker: s.layers.find((p) => speaker.is(p) && p.opacity > 0.3) ?? null });
    } else close();
  }
  close();
  return out;
}

/** a move or a change of size this large (a share of the frame's width) is something new */
const BEAT_MOVE = 0.015;
/** a fade this deep is something new */
const BEAT_FADE = 0.15;
/** a layer this small (a share of the frame) changing its look is no beat: an arrow's tip, a cursor's blink */
const BEAT_SHARE = 0.01;

/**
 * Whether something new happened in an insert between two of its samples: an
 * element entering or leaving, a clear fade, a move or a change of size, new
 * words, a change of look of a layer of some size, footage playing. A drift
 * too slow to see between two samples adds up, since a stretch is measured
 * against its start.
 */
function somethingNew(a: Insert['samples'][number], b: Insert['samples'][number], comp: Composition): boolean {
  const live = (x: Insert['samples'][number]) => new Map(x.layers.filter((p) => !AMBIENT.has(p.node.type)).map((p) => [p.id, p]));
  const la = live(a), lb = live(b), frame = comp.width * comp.height, move = BEAT_MOVE * comp.width;
  if (la.size !== lb.size || [...lb.keys()].some((id) => !la.has(id))) return true;
  for (const [id, q] of lb) {
    const p = la.get(id)!;
    if (q.node.type === 'video' || Math.abs(q.opacity - p.opacity) >= BEAT_FADE || (q.text ?? '') !== (p.text ?? '')) return true;
    if (p.box && q.box && [q.box.x - p.box.x, q.box.y - p.box.y, q.box.w - p.box.w, q.box.h - p.box.h].some((d) => Math.abs(d) >= move)) return true;
    if (q.box && (q.box.w * q.box.h) / frame >= BEAT_SHARE && JSON.stringify(q.props) !== JSON.stringify(p.props)) return true;
  }
  return false;
}

export const insertStill: CheckType = {
  name: 'insert-still', title: 'Insert holding still', description: 'an insert over a talking video where nothing new happens for 2.5 s while the voice goes on',
  texts: ['the insert from {from} s holds still from {a} to {b} s ({len} s)'],
  run({ samples, doc, comp, step }) {
    const speaker = speakerIn(samples, doc, comp);
    if (!speaker) return [];
    const out: QualityIssue[] = [];
    for (const ins of insertsOf(samples, comp, speaker, step)) {
      // the stretches where nothing new happens, each measured against its start; the film's closing hold left out
      const runs: { a: number; b: number }[] = [];
      let start = 0;
      for (let i = 1; i <= ins.samples.length; i++) {
        if (i < ins.samples.length && !somethingNew(ins.samples[start], ins.samples[i], comp)) continue;
        runs.push({ a: ins.samples[start].t, b: i < ins.samples.length ? ins.samples[i].t : ins.to });
        start = i;
      }
      const worst = runs.filter((r) => r.b <= comp.duration - 1).sort((x, y) => (y.b - y.a) - (x.b - x.a))[0];
      const len = worst ? s2(worst.b - worst.a) : 0;
      if (!worst || len < INSERT_HOLD) continue;
      out.push({
        check: 'insert-still', severity: 'warning', t: s2(worst.a), rank: len,
        message: `The insert from ${s2(ins.from)} s holds still from ${s2(worst.a)} to ${s2(worst.b)} s (${len} s) while the voice goes on: give it its next beat on the words said there (a box ticked, a figure written, a push in on the detail, the rest dimmed), something new every 2 s.`,
        say: { text: 'the insert from {from} s holds still from {a} to {b} s ({len} s)', params: { from: s2(ins.from), a: s2(worst.a), b: s2(worst.b), len } },
      });
    }
    return out;
  },
};

/** the kind of picture a node type draws by itself, when it is one: the film plan's kinds (the scene forms read it too) */
export function pictureKindOfType(type: string): 'interface' | 'data' | 'diagram' | '3d' | 'map' | null {
  if (type.startsWith('ui.') || type.startsWith('chat.') || type.startsWith('codeview.')) return 'interface';
  if (type.startsWith('chart.') || type === 'text.counter') return 'data';
  if (type.startsWith('diagram.') || type === 'math.formula') return 'diagram';
  if (type.startsWith('map.')) return 'map';
  if (type === 'model.3d' || type === 'solid.3d') return '3d';
  return null;
}

const KIND_WORDS = { interface: 'an interface', data: 'a chart or figure', diagram: 'a diagram', map: 'a map', '3d': 'a 3D object' } as const;

/** the kind of picture a node draws, in words, for telling two inserts apart */
function kindOf(type: string): string {
  const kind = pictureKindOfType(type);
  if (kind) return KIND_WORDS[kind];
  if (type === 'image') return 'a picture';
  if (type === 'video' || type === 'sequence') return 'footage';
  if (type === 'text' || type.startsWith('text.')) return 'type';
  return 'shapes';
}

/** what an insert is built as, at its middle: the kind of its largest layer (a backdrop left out) and where it sits, beside the speaker or not */
export function formOfInsert(ins: Insert, comp: Composition): string {
  const mid = ins.samples[Math.floor(ins.samples.length / 2)], frame = comp.width * comp.height;
  const share = (p: PlacedLayer) => (p.box ? (p.box.w * p.box.h) / frame : 0);
  const content = mid.layers.filter((p) => share(p) < 0.9 || p.node.type === 'image' || p.node.type === 'video');
  const top = [...(content.length ? content : mid.layers)].sort((a, b) => share(b) - share(a))[0];
  if (!top?.box) return 'shapes';
  const cx = (top.box.x + top.box.w / 2) / comp.width, side = share(top) >= 0.6 ? 'full frame' : cx < 0.4 ? 'on the left' : cx > 0.6 ? 'on the right' : 'in the centre';
  const beside = mid.speaker?.box && area(mid.speaker.box, { x: 0, y: 0, w: comp.width, h: comp.height }) < 0.8 * frame ? ', beside the speaker' : '';
  return `${kindOf(top.node.type)} ${side}${beside}`;
}

export const insertForm: CheckType = {
  name: 'insert-form', title: 'Inserts built alike', description: 'two inserts in a row over a talking video built the same way (the same kind of picture in the same place)',
  texts: ['the inserts at {a} s and {b} s are both {form}'],
  run({ samples, doc, comp, step }) {
    const speaker = speakerIn(samples, doc, comp);
    if (!speaker) return [];
    const inserts = insertsOf(samples, comp, speaker, step), forms = inserts.map((x) => formOfInsert(x, comp));
    const out: QualityIssue[] = [];
    for (let i = 1; i < inserts.length; i++) {
      if (forms[i] !== forms[i - 1]) continue;
      out.push({
        check: 'insert-form', severity: 'warning', t: s2(inserts[i].from), rank: 1,
        message: `The inserts at ${s2(inserts[i - 1].from)} s and ${s2(inserts[i].from)} s are both ${forms[i]}: build the second in another form (a figure written large, A then B, an object, a diagram, footage, a section title) or in another place.`,
        say: { text: 'the inserts at {a} s and {b} s are both {form}', params: { a: s2(inserts[i - 1].from), b: s2(inserts[i].from), form: forms[i] } },
      });
    }
    return out;
  },
};

export const TALKING_CHECKS: CheckType[] = [wordSync, insertStill, insertForm];
