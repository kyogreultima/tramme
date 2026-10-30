// Tagging with @: in a message box, @ opens the project's assets, and the word
// chosen stands for the asset. At send the tag is explained in the message
// itself ("@logo (the image asset "logo": Brand Logo)"), so every route reads
// it the same way, with no engine change.

import type { TrammeDoc } from '@tramme/core';

export interface Mentionable { token: string; label: string; kind: string }

/** the word being tagged at the caret: an @ at the start or after a space, and what follows it up to the caret */
export function mentionQuery(text: string, caret: number): { from: number; query: string } | null {
  const m = /(^|\s)@([\w.-]*)$/.exec(text.slice(0, caret));
  return m ? { from: caret - m[2].length - 1, query: m[2] } : null;
}

/** the text with the tag typed so far replaced by the chosen token and a space, and where the caret goes */
export function applyMention(text: string, q: { from: number; query: string }, token: string): { text: string; caret: number } {
  const insert = `@${token} `;
  return { text: text.slice(0, q.from) + insert + text.slice(q.from + 1 + q.query.length), caret: q.from + insert.length };
}

/** the assets of a document, as things to tag: by id (a word without spaces), named when they have a name */
export function assetMentions(doc: Pick<TrammeDoc, 'assets'> | null): Mentionable[] {
  return Object.entries(doc?.assets ?? {}).map(([id, a]) => ({ token: id, label: (a as { name?: string }).name ?? id, kind: a.type }));
}

/** the things whose token or label contains what was typed, case apart */
export function matchMentions(list: Mentionable[], query: string): Mentionable[] {
  const q = query.toLowerCase();
  return list.filter((m) => m.token.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
}

/** each tag `describe` knows gets its meaning in brackets after it; an e-mail address or an unknown tag is left as it is */
export function expandMentions(text: string, describe: (token: string) => string | null): string {
  return text.replace(/(^|\s)@([\w.-]*\w)/g, (all, space: string, token: string) => {
    const d = describe(token);
    return d ? `${space}@${token} (${d})` : all;
  });
}

/** what a tag of a project's asset says */
export const describeAsset = (doc: Pick<TrammeDoc, 'assets'> | null) => (token: string): string | null => {
  const a = doc?.assets?.[token] as { type: string; name?: string } | undefined;
  return a ? `the ${a.type} asset "${token}"${a.name && a.name !== token ? `: ${a.name}` : ''}` : null;
};
