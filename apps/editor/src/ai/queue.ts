// The messages written while a turn runs. They wait here, each with the
// context of the moment it was written (the time, the selection, the scene,
// the pin), and leave together as one turn of the agent once the turn is over
// and no proposal waits for the user's decision. After a stop or a failed turn
// they stay: the user sends them now, or with their next message.

import { computed, signal } from '@preact/signals';
import { pending, type Attachment } from '../attachments.ts';
import { S } from '../state.ts';
import { t } from '../i18n/index.ts';
import { saveChat } from './index.ts';
import { uid } from './calls.ts';
import { contextLine, running, startTurn, type Anchor } from './conversation.ts';

/** a message written, waiting or about to leave; `context` is the line shown and `data` what the agent receives, both taken when it was written */
export interface Queued {
  id: string;
  text: string;
  context: string;
  data: Record<string, unknown>;
  at: number;
  anchor?: Anchor;
  attachments: Attachment[];
}

export const queue = signal<Queued[]>([]);
/** the turn ended by a stop or a failure, or the queue was read back from the file: it does not leave by itself */
export const held = signal(false);

/** why the queue has not left: the turn runs, a proposal waits for a decision, or it was held; null when nothing holds it */
export const queueWaits = computed<'turn' | 'decision' | 'stopped' | null>(() => {
  if (!queue.value.length) return null;
  if (running.value) return 'turn';
  if (held.value) return 'stopped';
  return S.proposal.value?.status === 'pending' ? 'decision' : null;
});

/** the message being written, with the files joined to it and the context of now (the box is emptied by the caller) */
export function written(text: string, anchor?: Anchor): Queued {
  const atts = pending.peek();
  pending.value = [];
  const ctx = contextLine();
  return {
    id: uid(), text: text.trim() ? text : atts.length > 1 ? t('assistant.hereAreSomeFiles') : t('assistant.hereIsAFile'),
    context: ctx.text, data: ctx.data, at: ctx.data.time as number, anchor, attachments: atts,
  };
}

const keep = () => { saveChat().catch(() => {}); };

/** a message to wait for the end of the turn */
export function enqueue(text: string, anchor?: Anchor) {
  queue.value = [...queue.peek(), written(text, anchor)];
  keep();
}

/** a message withdrawn before it leaves */
export function dequeue(id: string) {
  queue.value = queue.peek().filter((q) => q.id !== id);
  keep();
}

/** the queue leaves as one turn, with the message just written (when there is one) after it */
export async function flushQueue(extra?: { text: string; anchor?: Anchor }) {
  if (running.peek()) return;
  const messages = [...queue.peek(), ...(extra ? [written(extra.text, extra.anchor)] : [])];
  if (!messages.length) return;
  queue.value = [];
  held.value = false;
  await startTurn(messages);
}
