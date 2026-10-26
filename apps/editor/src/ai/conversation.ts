// The turns of the conversation, whatever shows them (the assistant panel of
// the atelier, the notes of the studio): a message goes with what it is about
// (the composition, the time, the selection; in the studio the scene and the
// point of the picture a note is pinned on), the events of the turn show as
// they come, the proposal is applied or refused (undoable like any edit), and
// the user is told when a long turn is over.

import { signal } from '@preact/signals';
import type { AiEvent, ChatItem } from '../api.ts';
import { aiSettings, ask, chat, decided, runTool, saveChat, stop as stopAi } from './index.ts';
import { inputLine, type Command } from './commands.ts';
import { paused, uid } from './calls.ts';
import { opLine } from './tools.ts';
import { attaching, pending } from '../attachments.ts';
import { acceptProposal, comp, propose, rejectProposal, S, toast, uiTime } from '../state.ts';
import { clip, layerName, timecode } from '../model.ts';
import { away, notify } from '../notify.ts';
import { turnBegins, turnEnds } from '../confirm.ts';
import { preview } from '../preview.ts';
import { t } from '../i18n/index.ts';

/** a turn is under way */
export const running = signal(false);
/** the text item receiving words right now (no activity line under it meanwhile) */
export const streaming = signal<string | null>(null);
/** when the current turn started, for the activity line */
export const turnStart = signal(0);
/** a picture of the conversation shown large */
export const lightbox = signal<string | null>(null);
let controller: AbortController | null = null;
/** decisions on proposals not yet reported to the agent */
const decisions = new Map<string, string>();

/** what a studio note is about besides the time: the scene, the point of the picture and the layer under it */
export interface Anchor { scene?: { name: string; from: number; to: number }; pin?: [number, number]; under?: { id: string; name: string; type: string } }

/** what the message is about; reactive when called during render */
export function contextLine(live = false): { text: string; data: Record<string, unknown> } {
  const c = live ? comp.value : comp.peek(), now = live ? uiTime.value : S.time.peek();
  const ids = (live ? S.selection.value : S.selection.peek()).filter((id) => c.layers[id]);
  const names = ids.map((id) => layerName(id, c.layers[id]));
  const text = `${names.length ? names.join(', ') : t('common.composition')} · ${timecode(now, c.fps)}`;
  return {
    text,
    data: {
      compId: S.compId.peek(), time: +now.toFixed(4), frame: Math.round(now * c.fps), fps: c.fps,
      selection: ids.map((id) => ({ id, name: c.layers[id].name ?? id, type: c.layers[id].type })),
    },
  };
}

function update(id: string, fn: (it: ChatItem) => ChatItem) {
  chat.value = chat.value.map((it) => (it.id === id ? fn(it) : it));
}

// The words of a turn arrive by the hundred each second: they are gathered and
// written to the conversation a few times a second, not one render per word.
const STREAM_FLUSH = 50;
const words = new Map<string, { text: string; thinking: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** the words gathered so far, written to their items at once */
function flushWords() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!words.size) return;
  const batch = new Map(words);
  words.clear();
  chat.value = chat.value.map((it) => {
    const w = batch.get(it.id);
    if (!w) return it;
    return {
      ...it,
      ...(w.text ? { text: (it.text ?? '') + w.text } : {}),
      ...(w.thinking && it.thinking ? { thinking: { ...it.thinking, text: it.thinking.text + w.thinking } } : {}),
    };
  });
}

function gather(id: string, kind: 'text' | 'thinking', delta: string) {
  const w = words.get(id) ?? { text: '', thinking: '' };
  w[kind] += delta;
  words.set(id, w);
  flushTimer ??= setTimeout(flushWords, STREAM_FLUSH);
}

/** a message for the assistant; command: the tool or workflow it was written with (/name); anchor: the scene and point of a studio note */
export async function send(text: string, opts: { command?: { cmd: Command; input?: Record<string, unknown> }; anchor?: Anchor } = {}) {
  const atts = pending.peek();
  if ((!text.trim() && !atts.length) || running.peek() || attaching.peek()) return;
  if (!text.trim()) text = atts.length > 1 ? t('assistant.hereAreSomeFiles') : t('assistant.hereIsAFile');
  pending.value = [];
  const ctx = contextLine(), { command, anchor } = opts;
  const at = ctx.data.time as number;
  chat.value = [...chat.value, {
    id: uid(), role: 'user', text, context: ctx.text, at,
    ...(anchor?.scene ? { scene: anchor.scene.name } : {}),
    ...(anchor?.pin ? { pin: anchor.pin } : {}),
    ...(atts.length ? { attachments: atts.map(({ path, name, kind, asset }) => ({ path, name, kind, asset })) } : {}),
  }];
  const ds = [...decisions].map(([id, status]) => ({ id, status }));
  decisions.clear();
  // changes applied without the user: the turn works on its own, nothing is asked
  const auto = aiSettings.peek().apply !== 'off';
  const context = { ...ctx.data, autonomous: auto, ...(anchor?.scene ? { scene: anchor.scene } : {}), ...(anchor?.pin ? { point: anchor.pin, ...(anchor.under ? { under: anchor.under } : {}) } : {}) };
  await consume((signal) => ask({ text, context, doc: S.doc.peek(), decisions: ds, attachments: atts, command: command?.cmd, commandInput: command?.input }, signal), auto);
}

/** a tool of the / menu run at once, without the assistant */
export async function runCommand(cmd: Command, input: Record<string, unknown>) {
  if (running.peek()) return;
  const line = inputLine(input);
  chat.value = [...chat.value, { id: uid(), role: 'user', text: `/${cmd.name}${line ? ` · ${line}` : ''}`, context: contextLine().text, at: S.time.peek() }];
  await consume((signal) => runTool(cmd.name, input, signal), false);
}

/** shows the events of a turn (the assistant's, or a tool run alone) as they come, then saves the conversation */
async function consume(start: (signal: AbortSignal) => AsyncGenerator<AiEvent>, auto: boolean) {
  running.value = true;
  turnBegins(auto);
  turnStart.value = Date.now();
  streaming.value = null;
  controller = new AbortController();
  const from = chat.peek().length, signal = controller.signal;
  let error = '';
  try {
    for await (const ev of start(controller.signal)) {
      if (ev.type === 'text') { gather(ev.id, 'text', ev.delta); streaming.value = ev.id; continue; }
      if (ev.type === 'thinking') { gather(ev.id, 'thinking', ev.delta); continue; }
      // any other event comes after the words gathered before it
      flushWords();
      if (ev.type === 'item') { chat.value = [...chat.value, ev.item]; streaming.value = ev.item.text !== undefined ? ev.item.id : null; }
      else if (ev.type === 'thinking-done') update(ev.id, (it) => ({ ...it, thinking: it.thinking && { ...it.thinking, done: true, ms: Date.now() - (it.thinking.start ?? Date.now()) } }));
      else if (ev.type === 'tool-done') update(ev.id, (it) => ({ ...it, tool: it.tool && { ...it.tool, done: true, error: ev.error, detail: ev.detail, progress: undefined, ms: Date.now() - (it.tool.start ?? Date.now()) } }));
      else if (ev.type === 'tool-progress') update(ev.id, (it) => ({ ...it, tool: it.tool && { ...it.tool, progress: ev.progress } }));
      else if (ev.type === 'proposal') {
        propose({ id: ev.id, label: ev.label, ops: ev.ops });
        const card = { id: ev.id, label: ev.label, count: ev.ops.length, status: 'pending' as const, lines: ev.ops.slice(0, 40).map(opLine) };
        // the agent refines its proposal: the card updates in place
        if (chat.value.some((it) => it.proposal?.id === ev.id)) chat.value = chat.value.map((it) => (it.proposal?.id === ev.id ? { ...it, proposal: card } : it));
        else chat.value = [...chat.value, { id: uid(), role: 'assistant', proposal: card }];
        // apply everything, as it comes: the document moves while the assistant works
        if (aiSettings.peek().apply === 'all') decide(true);
      } else if (ev.type === 'proposal-clear') {
        if (S.proposal.peek()?.id === ev.id) S.proposal.value = null;
        chat.value = chat.value.filter((it) => it.proposal?.id !== ev.id);
      } else if (ev.type === 'reload') {
        preview.reload(ev.assets).catch((e) => toast(t('assistant.pluginError', { error: (e as Error).message }), 'error'));
      } else if (ev.type === 'error') { error = ev.message; chat.value = [...chat.value, { id: uid(), role: 'assistant', text: t('assistant.errorError', { error }) }]; }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') { error = (e as Error).message; chat.value = [...chat.value, { id: uid(), role: 'assistant', text: t('assistant.errorError', { error }) }]; }
  } finally {
    flushWords();
    turnEnds();
    running.value = false;
    streaming.value = null;
    controller = null;
    paused.value = false;
    chat.value = chat.value.map((it) => (it.tool && !it.tool.done ? { ...it, tool: { ...it.tool, done: true, ms: Date.now() - (it.tool.start ?? Date.now()) } }
      : it.thinking && !it.thinking.done ? { ...it, thinking: { ...it.thinking, done: true, ms: Date.now() - (it.thinking.start ?? Date.now()) } } : it));
    // stopped by the user: nothing applied, nothing to tell
    if (!signal.aborted) finished(from, error, Date.now() - turnStart.peek());
    saveChat(chat.value).catch(() => {});
  }
}

/** a turn longer than this is told even when the user stayed in the editor */
const LONG_TURN = 15_000;

/**
 * The turn is over: its proposal applied when the user chose so, then the
 * user told (a notification in the background, a message after a long turn,
 * always when something was applied without them).
 */
function finished(from: number, error: string, ms: number) {
  const { notify: tell, apply } = aiSettings.peek();
  const turn = chat.peek().slice(from);
  const p = S.proposal.peek();
  const proposal = p?.status === 'pending' && turn.some((it) => it.proposal?.id === p.id) ? p : null;
  const applied = !error && !!proposal && apply === 'turn' && decide(true);
  const said = turn.filter((it) => it.role === 'assistant' && it.text).at(-1)?.text?.replace(/\s+/g, ' ').trim();
  const body = error ? t('assistant.doneError', { error })
    : applied ? t('assistant.doneApplied', { label: proposal!.label })
    : proposal ? t('assistant.doneProposal', { label: proposal.label })
    : said ? clip(said, 140) : t('assistant.doneReply');
  if (tell && (away() || ms >= LONG_TURN)) notify(t('assistant.doneTitle', { name: S.project.peek().name }), body, error ? 'error' : 'info');
  else if (applied) toast(body);
}

/** stops the turn under way */
export function stop() {
  paused.value = false;
  stopAi();
  controller?.abort();
}

/** pauses the turn under way before its next tool, or lets it go on */
export function togglePause() {
  if (running.peek()) paused.value = !paused.peek();
}

/**
 * The user (or the automatic application) applies or refuses the proposal:
 * the cards follow, the decision is told to the agent. False when it could
 * not be applied.
 */
export function decide(accept: boolean): boolean {
  const p = S.proposal.peek();
  if (!p) return false;
  const ok = accept ? acceptProposal() : (rejectProposal(), true);
  if (!ok) return false;
  const status = accept ? 'accepted' : 'rejected';
  decisions.set(p.id, status);
  decided(p.id);
  chat.value = chat.value.map((it) => (it.proposal?.id === p.id ? { ...it, proposal: { ...it.proposal, status } } : it));
  saveChat(chat.value).catch(() => {});
  return true;
}

