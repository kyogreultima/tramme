// A project opened for the first time after it was made from words, a video
// or sources. From words (the home's direction box): the assistant starts on
// them at once, making the film they describe. From a video: the video is
// joined to the next message, and with words the assistant starts on them;
// without, it asks what the user wants (format, cuts, captions, emphasis)
// before doing anything. From sources: the assistant reads everything to
// propose what the video should be (/analyze), at once with words, after the
// user's go otherwise. Nothing is transcribed on its own: the user starts it
// (the Transcribe button), or says yes when the assistant asks.

import { aiRoute, chat, refreshStatus } from './ai/index.ts';
import { send } from './ai/conversation.ts';
import { listCommands, parseCommand } from './ai/commands.ts';
import { draft, pending } from './attachments.ts';
import { startKey, type Start } from './importer.ts';
import { S } from './state.ts';
import { t } from './i18n/index.ts';

const VIDEO_GREETING = () => [
  t('start.yourVideoIsOn'),
  '',
  t('start.theFinalFormatLandscape'),
  t('start.whatToCutSilences'),
  t('start.theStyleOfCaptions'),
  t('start.theOverallToneUnderstated'),
  '',
  t('start.iWillShowYou'),
].join('\n');

const SOURCES_GREETING = (n: number, kit: boolean) => [
  t('start.sourcesAreIn', { n }),
  ...(kit ? ['', t('start.kitApplied')] : []),
  '',
  t('start.sourcesReadAll'),
  t('start.sourcesBrief'),
  t('start.sourcesDirections'),
  '',
  t('start.sourcesSend'),
].join('\n');

function greet(text: string) {
  chat.value = [...chat.peek(), { id: `start-${Date.now().toString(36)}`, role: 'assistant', text }];
  // on a phone, the conversation in front
  S.mobileTab.value = 'ai';
}

/**
 * The words the project was made with, sent at once with the workflow that
 * fits, or with the command they name (/name), as the message box sends it;
 * a tool named alone waits in the box with its form. No model to send them
 * to: they wait in the box.
 */
async function begin(words: string, workflow?: string) {
  const commands = listCommands(S.registry.peek()), typed = parseCommand(words, commands), named = typed?.cmd;
  if (named?.kind === 'tool' && !typed!.rest) { draft.value = words; return; }
  if (!aiRoute.peek()) await refreshStatus();
  const cmd = named ?? (workflow ? commands.find((c) => c.name === workflow && c.kind === 'prompt') : undefined);
  if (!aiRoute.peek()) { draft.value = cmd && !named ? `/${cmd.name} ${words}` : words; return; }
  send(words, cmd ? { command: { cmd } } : {});
}

export function startProject() {
  const id = S.project.peek().id;
  let start: Start | null = null;
  try {
    start = JSON.parse(sessionStorage.getItem(startKey(id)) ?? 'null');
    sessionStorage.removeItem(startKey(id));
  } catch { return; }
  if (!start) return;
  const doc = S.doc.peek(), words = start.prompt?.trim();
  if (start.sources) {
    if (words) { begin(words, 'analyze'); return; }
    draft.value = '/analyze ';
    greet(SOURCES_GREETING(start.sources, !!start.kit));
    return;
  }
  const asset = start.asset;
  if (asset && doc.assets[asset]) {
    pending.value = [{ path: start.path ?? doc.assets[asset].src, name: start.name ?? asset, kind: 'video', size: start.size ?? 0, asset }];
    if (words) { begin(words); return; }
    greet(VIDEO_GREETING());
    return;
  }
  if (words) begin(words, 'film');
}
