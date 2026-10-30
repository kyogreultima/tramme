// The studio's state: the scene in focus, the note being pinned on the
// picture, the side panel shown; and how the studio reads the conversation:
// the notes the user wrote (each one at a moment of the film, maybe on a
// scene, maybe pinned on a point of the picture), the stages of the
// assistant's work, and the takes it proposed.

import { computed, signal } from '@preact/signals';
import type { ChatItem } from './api.ts';
import { chat } from './ai/index.ts';
import { decide, send, type Anchor } from './ai/conversation.ts';
import { flushQueue, held, queue, written } from './ai/queue.ts';
import { areaCandidates, needsConfirm, simplify, type NewPin, type Pin, type Placed, type Pt, type Retouch, type Under } from './retouch.ts';
import { prefs } from './settings.ts';
import { previewDoc, S } from './state.ts';
import { sceneAt, scenesOf, type Scene } from './scenes.ts';
import { m, t } from './i18n/index.ts';
import { timecode } from './model.ts';

export const studio = {
  /** the scene in focus (its id): the notes are about it, the suggestions act on it */
  scene: signal<string | null>(null),
  /** the next gestures on the picture pin the note there (several, until it is let go) */
  pinning: signal(false),
  /** what the gesture draws: a point, a path to follow, a group of layers to select */
  tool: signal<'point' | 'path' | 'area'>('point'),
  /** what the note being written is pinned on (fractions of the frame) */
  pins: signal<Pin[]>([]),
  /** the stroke being drawn right now (fractions of the frame) */
  drawing: signal<Pt[] | null>(null),
  /** an area drawn: the layers it proposes, for the user to confirm, drop from or add to */
  review: signal<Review | null>(null),
  /** the retouches written and waiting for "send all" */
  retouches: signal<Retouch[]>([]),
  /** the side panel: the notes, or the direction the assistant follows */
  panel: signal<'notes' | 'direction'>('notes'),
  /** a note to show in the thread (its id), lit for a moment */
  flash: signal<string | null>(null),
};

/** an area waiting for the user's word: the layers it proposes (each on or off), or that it is too wide */
export interface Review { stroke: Pt[]; candidates: (Under & { on: boolean })[]; tooMany: boolean; count: number }

/** the film the studio shows: the take previewed, or the document; never a drag's draft */
export const filmDoc = computed(() => (S.showProposal.value ? previewDoc.value : null) ?? S.doc.value);

export const scenes = computed<Scene[]>(() => scenesOf(filmDoc.value, S.compId.value, t('studio.opening')));
export const focused = computed<Scene | null>(() => scenes.value.find((s) => s.id === studio.scene.value) ?? null);
/** the scene playing now */
export const current = computed<Scene | null>(() => sceneAt(scenes.value, S.time.value));

/** a scene in focus, the playhead at its start; again: the whole film */
export function focusScene(s: Scene | null) {
  studio.scene.value = s && studio.scene.peek() !== s.id ? s.id : null;
  if (studio.scene.peek() && s && (S.time.peek() < s.from || S.time.peek() >= s.to)) S.time.value = s.from;
}

/** what the next note is about: the scene in focus and everything pinned on the picture */
export function anchor(): Anchor {
  const s = focused.peek(), pins = studio.pins.peek();
  return { ...(s ? { scene: { name: s.name, from: +s.from.toFixed(3), to: +s.to.toFixed(3) } } : {}), ...(pins.length ? { pins: [...pins] } : {}) };
}

let pinCount = 0;
/** a pin added to the note being written: a point, a path or an area; the others stay */
export function addPin(pin: NewPin) {
  studio.pins.value = [...studio.pins.peek(), { ...pin, id: `pin-${++pinCount}` } as Pin];
}

/** a pin taken away */
export function removePin(id: string) { studio.pins.value = studio.pins.peek().filter((p) => p.id !== id); }

/** a note left, or let go: its pins are used */
export function noteSent() { studio.pins.value = []; studio.pinning.value = false; studio.drawing.value = null; studio.review.value = null; }

/** everything of the retouching put back as it was before anything was drawn */
export function resetRetouch() { noteSent(); studio.retouches.value = []; studio.tool.value = 'point'; }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A stroke drawn on the picture (fractions of the frame), done. A path becomes
 * a pin at once, on the layer it starts on. An area proposes the layers it may
 * mean, and the setting says whether the user confirms them: always, only for
 * more than three, never (a stroke too wide, or one that meets nothing, still
 * waits for the user, who may use it as a hint).
 */
export function strokeDone(kind: 'path' | 'area', points: Pt[], placed: Placed[], frame: { w: number; h: number }, under: Under | null) {
  const stroke = simplify(points.map((p): Pt => [+clamp01(p[0]).toFixed(4), +clamp01(p[1]).toFixed(4)]));
  if (kind === 'path') { addPin({ kind: 'path', points: stroke, ...(under ? { under } : {}) }); return; }
  const found = areaCandidates(placed, stroke.map((p): Pt => [p[0] * frame.w, p[1] * frame.h]), frame);
  const mode = prefs.peek().areaConfirm;
  if (found.tooMany) { studio.review.value = { stroke, candidates: [], tooMany: true, count: found.count }; return; }
  if (!found.layers.length && mode === 'never') { addPin({ kind: 'area', points: stroke, layers: [] }); return; }
  if (!found.layers.length || needsConfirm(mode, found.layers.length)) {
    studio.review.value = { stroke, candidates: found.layers.map((l) => ({ ...l, on: true })), tooMany: false, count: found.count };
    return;
  }
  addPin({ kind: 'area', points: stroke, layers: found.layers });
}

/** a layer of the proposal turned off, or on; one that was not proposed is added */
export function toggleReview(layer: Under) {
  const r = studio.review.peek();
  if (!r) return;
  const had = r.candidates.some((c) => c.id === layer.id);
  studio.review.value = { ...r, tooMany: false, candidates: had ? r.candidates.map((c) => (c.id === layer.id ? { ...c, on: !c.on } : c)) : [...r.candidates, { ...layer, on: true }] };
}

/** the area kept: with the layers still on, or as a hint with none chosen */
export function confirmReview(use: 'layers' | 'hint') {
  const r = studio.review.peek();
  if (!r) return;
  addPin({ kind: 'area', points: r.stroke, layers: use === 'layers' ? r.candidates.filter((c) => c.on).map(({ id, name, type }) => ({ id, name, type })) : [] });
  studio.review.value = null;
}

/** the area set aside */
export function cancelReview() { studio.review.value = null; }

// ── the list of retouches ──────────────────────────────────────
let retouchCount = 0;

/** the words and the pins so far become an item of the list, at this moment of this scene; false when there is nothing in them */
export function addRetouch(text: string, voice = false): boolean {
  const words = text.trim(), pins = studio.pins.peek();
  if (!words && !pins.length) return false;
  const f = focused.peek();
  const item: Retouch = { id: `retouch-${++retouchCount}`, text: words, pins: [...pins], time: +S.time.peek().toFixed(3), ...(f ? { scene: { name: f.name, from: +f.from.toFixed(3), to: +f.to.toFixed(3) } } : {}), ...(voice ? { voice } : {}) };
  studio.retouches.value = [...studio.retouches.peek(), item];
  studio.pins.value = [];
  studio.drawing.value = null; studio.review.value = null;
  return true;
}

export function removeRetouch(id: string) { studio.retouches.value = studio.retouches.peek().filter((r) => r.id !== id); }

/** an item moved one place up (-1) or down (1) */
export function moveRetouch(id: string, by: -1 | 1) {
  const list = [...studio.retouches.peek()], i = list.findIndex((r) => r.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  studio.retouches.value = list;
}

/** an item taken back out of the list to be changed: its pins return to the picture, its words are given back */
export function editRetouch(id: string): string {
  const r = studio.retouches.peek().find((x) => x.id === id);
  if (!r) return '';
  removeRetouch(id);
  studio.pins.value = [...studio.pins.peek(), ...r.pins];
  return r.text;
}

/** the whole list leaves as one turn (after the one running, when there is one), each item with its own pins, moment and scene */
export async function sendRetouches() {
  const list = studio.retouches.peek();
  if (!list.length) return;
  const fps = S.doc.peek().compositions[S.compId.peek()]?.fps ?? 30;
  const items = list.map((r) => {
    const q = written(r.text || t('studio.retouchPinsOnly'), { ...(r.scene ? { scene: r.scene } : {}), ...(r.pins.length ? { pins: r.pins } : {}) });
    return { ...q, at: r.time, data: { ...q.data, time: r.time, frame: Math.round(r.time * fps) }, context: `${t('common.composition')} · ${timecode(r.time, fps)}` };
  });
  studio.retouches.value = [];
  queue.value = [...queue.peek(), ...items];
  held.value = false;
  await flushQueue();
}

/** a direction the studio suggests, sent as a note about the scene in focus */
export function direct(text: string) { send(text, { anchor: anchor() }); noteSent(); }

// ── the conversation, read as notes and work ───────────────────
export interface Turn {
  /** the user's note (none: the assistant spoke first, a greeting) */
  note: ChatItem | null;
  /** its number among the notes */
  n: number;
  /** what the assistant did and said after it */
  work: ChatItem[];
}

// While a turn streams, the conversation changes many times a second but only
// its last turn does: what did not change keeps its object, so the views of
// the earlier turns, the notes and the takes are not drawn again.
const sameTurn = (a: Turn, b: Turn) => a.note === b.note && a.n === b.n && a.work.length === b.work.length && a.work.every((it, i) => it === b.work[i]);
let lastTurns: Turn[] = [];
export const turns = computed<Turn[]>(() => {
  const out: Turn[] = [];
  let n = 0;
  for (const it of chat.value) {
    if (it.role === 'user') out.push({ note: it, n: ++n, work: [] });
    else if (out.length) out[out.length - 1].work.push(it);
    else out.push({ note: null, n: 0, work: [it] });
  }
  return (lastTurns = out.map((x, i) => (lastTurns[i] && sameTurn(lastTurns[i], x) ? lastTurns[i] : x)));
});

/** the notes written at a moment of the film, with their number */
let lastNotes: { n: number; note: ChatItem }[] = [];
export const notes = computed(() => {
  const next = turns.value.filter((x) => x.note && x.note.at !== undefined).map((x) => ({ n: x.n, note: x.note! }));
  if (next.length === lastNotes.length && next.every((x, i) => x.n === lastNotes[i].n && x.note === lastNotes[i].note)) return lastNotes;
  return (lastNotes = next);
});

/** the takes the assistant proposed in this conversation, numbered: id → number */
let lastTakes = new Map<string, number>();
export const takes = computed(() => {
  const out = new Map<string, number>();
  for (const it of chat.value) if (it.proposal && !out.has(it.proposal.id)) out.set(it.proposal.id, out.size + 1);
  if (out.size === lastTakes.size && [...out].every(([id, n]) => lastTakes.get(id) === n)) return lastTakes;
  return (lastTakes = out);
});

/** the same note again, for another direction: the take on screen set aside */
export function anotherTake() {
  const p = S.proposal.peek();
  if (!p || p.status !== 'pending') return;
  const last = turns.peek().filter((x) => x.note).at(-1)?.note;
  decide(false);
  const again: Anchor = { ...(last?.pins?.length ? { pins: last.pins } : {}), ...(focused.peek() ? anchor() : {}) };
  send(t('studio.anotherTakePrompt', { label: p.label }), { anchor: again });
}

// ── the stages of the assistant's work ─────────────────────────
export type Stage = 'think' | 'read' | 'direct' | 'build' | 'sound' | 'review';
export const STAGES: Stage[] = ['think', 'read', 'direct', 'build', 'sound', 'review'];
export const STAGE_LABEL: Record<Stage, string> = {
  think: m('studio.stages.think'), read: m('studio.stages.read'), direct: m('studio.stages.direct'),
  build: m('studio.stages.build'), sound: m('studio.stages.sound'), review: m('studio.stages.review'),
};

const READING = new Set(['get_document', 'list_nodes', 'read_file', 'list_files', 'get_transcript', 'media_frame', 'evaluate']);
const DIRECTING = new Set(['brief', 'palette', 'film-plan', 'style-frames']);
const REVIEWING = new Set(['check', 'motion', 'subjects', 'critique']);
const SOUND = /^(sfx|synth|generate-sound|duck|mix|cues|credits|voices|sound-)/;

/** the stage of the work an item of the conversation belongs to */
export function stageOf(it: ChatItem): Stage | null {
  if (it.thinking) return 'think';
  if (it.proposal) return 'build';
  const tool = it.tool;
  if (!tool) return null;
  if (tool.name === 'use_tool') {
    const use = tool.use ?? '';
    if (DIRECTING.has(use)) return 'direct';
    if (REVIEWING.has(use)) return 'review';
    if (use === 'sources') return 'read';
    if (SOUND.test(use)) return 'sound';
    return 'build';
  }
  if (READING.has(tool.name)) return 'read';
  if (tool.name === 'render_still') return 'review';
  return 'build';
}

/** the stages a turn went through, in the order they came first */
export function stagesOf(work: ChatItem[]): Stage[] {
  const out: Stage[] = [];
  for (const it of work) { const s = stageOf(it); if (s && s !== 'think' && !out.includes(s)) out.push(s); }
  return out;
}

/** the scene being built apart right now (its name), or null: its items carry `building` until its usage line closes it */
export function liveScene(work: ChatItem[]): string | null {
  for (let i = work.length - 1; i >= 0; i--) if (work[i].building) return work[i].usage ? null : work[i].building!;
  return null;
}

/** the stage the assistant is at: its last item still running, or the last stage seen */
export function liveStage(work: ChatItem[]): Stage | null {
  for (let i = work.length - 1; i >= 0; i--) {
    const it = work[i], s = stageOf(it);
    if (s && ((it.tool && !it.tool.done) || (it.thinking && !it.thinking.done))) return s;
  }
  return stagesOf(work).at(-1) ?? null;
}
