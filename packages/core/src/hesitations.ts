// Hesitations (docs/editing-roadmap.md, step 11): the "uh"s and "um"s a
// transcript leaves out. Whisper does not write them, so speech heard where
// the transcript has no word is one: a voice activity detector marks the
// speech (Silero in the editor; the energy of the sound here, when the model
// cannot run), and what of it no word covers is cut like a silence.

import type { TranscriptWord } from './transcript.ts';

export interface Span { from: number; to: number }

/**
 * Speech found by the energy of the sound alone: 30 ms frames louder than
 * the floor by `margin` dB (and than -55 dBFS), short dips bridged, short
 * bursts dropped. Coarser than a model (a breath, a cough count as speech),
 * the editor's fallback when the model cannot load.
 */
export function energySpeech(x: Float32Array, rate: number, { margin = 12, bridge = 0.12, shortest = 0.08 } = {}): Span[] {
  const hop = Math.max(1, Math.round(rate * 0.03)), db: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += x[j] * x[j];
    db.push(10 * Math.log10(s / hop + 1e-20));
  }
  const heard = db.filter((v) => v > -90).sort((a, b) => a - b);
  if (!heard.length) return [];
  const floor = heard[Math.floor(heard.length * 0.1)], gate = Math.max(-55, floor + margin);
  const frames = db.map((v) => v > gate);
  return spansOf(frames, hop / rate, bridge, shortest);
}

/** spans from per-frame decisions: gaps under `bridge` closed, spans under `shortest` dropped */
export function spansOf(on: ArrayLike<boolean>, step: number, bridge = 0.1, shortest = 0.08): Span[] {
  const raw: Span[] = [];
  let start = -1;
  for (let i = 0; i <= on.length; i++) {
    const v = i < on.length && on[i];
    if (v && start < 0) start = i;
    if (!v && start >= 0) { raw.push({ from: start * step, to: i * step }); start = -1; }
  }
  const out: Span[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && s.from - last.to < bridge) last.to = s.to;
    else out.push({ ...s });
  }
  return out.filter((s) => s.to - s.from >= shortest).map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3) }));
}

/**
 * The hesitations: speech that no word of the transcript covers (each word
 * widened by `pad`), between `min` and `max` seconds long (longer is a part
 * the transcript missed, not an "uh"), inside [from, to].
 */
export function hesitationsOf(words: TranscriptWord[], speech: Span[], { pad = 0.06, min = 0.15, max = 1.2, from = 0, to = Infinity } = {}): Span[] {
  const covered = words.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e)).map((w) => ({ from: w.s - pad, to: w.e + pad })).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of speech) {
    let cursor = Math.max(s.from, from);
    const end = Math.min(s.to, to);
    for (const c of covered) {
      if (c.to <= cursor) continue;
      if (c.from >= end) break;
      if (c.from > cursor) out.push({ from: cursor, to: c.from });
      cursor = Math.max(cursor, c.to);
    }
    if (cursor < end) out.push({ from: cursor, to: end });
  }
  return out.filter((h) => h.to - h.from >= min && h.to - h.from <= max).map((h) => ({ from: +h.from.toFixed(3), to: +h.to.toFixed(3) }));
}

/** the parts of [from, to] kept around cuts (sorted, inside it), each cut kept `keep` short on both sides so the joins breathe */
export function keepsAround(from: number, to: number, cuts: Span[], keep = 0.02): Span[] {
  const out: Span[] = [];
  let cursor = from;
  for (const c of [...cuts].sort((a, b) => a.from - b.from)) {
    const a = Math.max(cursor, c.from + keep), b = Math.min(to, c.to - keep);
    if (b - a < 0.04) continue;
    if (a > cursor) out.push({ from: cursor, to: a });
    cursor = b;
  }
  if (to > cursor) out.push({ from: cursor, to });
  return out.map((k) => ({ from: +k.from.toFixed(4), to: +k.to.toFixed(4) }));
}

/** the parts of an edit (file spans, in order) with the ones on both sides of each cut put back joined into one */
export function joinAcross(parts: Span[], back: Span[]): Span[] {
  const out: Span[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && back.some((c) => last.to <= c.to + 1e-6 && p.from >= c.from - 1e-6 && p.from >= last.to)) last.to = p.to;
    else out.push({ from: p.from, to: p.to });
  }
  return out;
}
