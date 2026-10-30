// The studio's state: the scene in focus, the note being pinned on the
// picture, the side panel shown; and how the studio reads the conversation:
// the notes the user wrote (each one at a moment of the film, maybe on a
// scene, maybe pinned on a point of the picture), the stages of the
// assistant's work, and the takes it proposed.

import { computed, signal } from '@preact/signals';
import type { ChatItem } from './api.ts';
import { chat } from './ai/index.ts';
import { decide, send, type Anchor } from './ai/conversation.ts';
import { previewDoc, S } from './state.ts';
import { sceneAt, scenesOf, type Scene } from './scenes.ts';
import { m, t } from './i18n/index.ts';

export const studio = {
  /** the scene in focus (its id): the notes are about it, the suggestions act on it */
  scene: signal<string | null>(null),
  /** the next press on the picture pins the note there */
  pinning: signal(false),
  /** where the note being written is pinned (fractions of the frame), and the layer under it */
  pin: signal<[number, number] | null>(null),
  under: signal<{ id: string; name: string; type: string } | null>(null),
  /** the side panel: the notes, or the direction the assistant follows */
  panel: signal<'notes' | 'direction'>('notes'),
  /** a note to show in the thread (its id), lit for a moment */
  flash: signal<string | null>(null),
};

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

/** what the next note is about: the scene in focus, the point pinned and the layer under it */
export function anchor(): Anchor {
  const s = focused.peek(), pin = studio.pin.peek(), under = studio.under.peek();
  return { ...(s ? { scene: { name: s.name, from: +s.from.toFixed(3), to: +s.to.toFixed(3) } } : {}), ...(pin ? { pin, ...(under ? { under } : {}) } : {}) };
}

/** a note pinned on the picture: where, and what is there */
export function pinAt(point: [number, number], under: { id: string; name: string; type: string } | null) {
  studio.pin.value = point;
  studio.under.value = under;
  studio.pinning.value = false;
}

/** a note left, or let go: the pin is used */
export function noteSent() { studio.pin.value = null; studio.under.value = null; studio.pinning.value = false; }

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
  const again: Anchor = { ...(last?.pin ? { pin: last.pin } : {}), ...(focused.peek() ? anchor() : {}) };
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
