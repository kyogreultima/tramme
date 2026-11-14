// The moments of a talking video worth an insert, read from what is said in
// the composition (the transcripts of the media it plays, in its own time):
// each with the words it turns on and the moment each is said, so every beat
// of an insert lands on its word. The assistant chooses among them; the
// check then measures the words that come late.

import { MOMENT_FORMS, speechMoments, spokenAssets, spokenOfDoc, type Moment, type ToolContext, type ToolType, type TranscriptWord } from '@tramme/core';
import { t } from './i18n/index.ts';

/** what the composition says, in its time: the transcripts of the media it plays (the edit's first), never asked for */
export async function spokenOf(ctx: ToolContext): Promise<TranscriptWord[]> {
  const loaded = new Map<string, unknown>();
  for (const id of spokenAssets(ctx.doc, ctx.compId)) loaded.set(id, await ctx.transcript(id, { ask: false }).catch(() => undefined));
  return spokenOfDoc(ctx.doc, ctx.compId, (id) => loaded.get(id));
}

/** a stretch this long with no moment is one for the speaker's framing (a push in, a cut closer) (s) */
const QUIET = 10;

const s2 = (x: number) => x.toFixed(2);

/** the moments as lines for the assistant, the stretches with none after them */
export function momentLines(moments: Moment[], words: TranscriptWord[]): string[] {
  const lines = moments.map((m) => `- ${s2(m.t)}–${s2(m.end)} s ${m.kind}: "${m.said.length > 110 ? `${m.said.slice(0, 107)}…` : m.said}"; beats ${m.beats.map((b) => `"${b.w}" ${s2(b.t)} s`).join(', ')}`);
  const quiet: string[] = [];
  let last = words[0]?.s ?? 0;
  for (const m of [...moments, { t: words.at(-1)?.e ?? 0, end: 0 }]) { if (m.t - last >= QUIET) quiet.push(`${s2(last)}–${s2(m.t)} s`); last = Math.max(last, m.end); }
  return [...lines, ...(quiet.length ? [`No moment from ${quiet.join(', ')}: change the speaker's framing there (a push in or a cut closer on the strong sentence) or show what is said.`] : [])];
}

const moments: ToolType<{ kinds?: string[] }> = {
  name: 'moments', title: 'Moments for inserts', description: 'reads what is said in the composition (its transcripts, in its time) and lists the moments worth an insert: figures, comparisons, causes, lists, names, questions and new parts, each with the words it turns on and the moment each is said',
  input: {
    type: 'object',
    properties: { kinds: { type: 'array', items: { enum: Object.keys(MOMENT_FORMS) }, title: 'Kinds', description: 'only these kinds (all by default)' } },
  },
  ai: {
    when: 'dressing a video where someone speaks, after the cuts and the charter: choose the inserts from it and land each beat on its word',
    avoid: 'putting an insert on every moment: about one every 5 to 10 s, the strongest',
  },
  async run(a, ctx) {
    const words = await spokenOf(ctx);
    if (!words.length) throw new Error('moments: nothing said in this composition has a transcript (transcribe the video first)');
    const found = speechMoments(words).filter((m) => !a.kinds?.length || a.kinds.includes(m.kind));
    const kinds = [...new Set(found.map((m) => m.kind))];
    return {
      label: t('moments.done', { n: found.length }), notice: t('moments.done', { n: found.length }),
      text: [
        `${found.length} moment(s) in ${s2(words.at(-1)!.e - words[0].s)} s of speech (composition time):`,
        ...momentLines(found, words),
        'What each kind asks for:',
        ...kinds.map((k) => `- ${k}: ${MOMENT_FORMS[k]}`),
        'Choose about one insert every 5 to 10 s, the strongest moments, alternating their forms; a full-frame insert replaces the face for 3 to 10 s, laid on the charter\'s backdrop. Each element of an insert enters on its beat (the word\'s time), and something new happens in it every 2 s. A section title: kinetic-title with spoken.',
      ].join('\n'),
    };
  },
};

export const MOMENT_TOOLS: ToolType[] = [moments];
