import { describe, expect, it } from 'vitest';
import { applyOps, type ToolContext, type TrammeDoc, type TranscriptWord } from '@tramme/core';
import { newProject } from '@tramme/project';
import { chooseTakes, keptSpans, sentencesOf } from '../src/takes.ts';
import { editorRegistry } from '../src/vocabulary.ts';

/** words said one after another from `at`, each 0.3 s, 0.1 s apart */
function say(text: string, at: number): TranscriptWord[] {
  return text.split(' ').map((w, i) => ({ w, s: at + i * 0.4, e: at + i * 0.4 + 0.3 }));
}

// the creator says the first sentence twice (a false start, then a good take), wanders off the script, says the second once
const recording = [
  ...say('Bonjour à tous, aujourd\'hui on', 0),
  ...say('euh attendez', 3),
  ...say('Bonjour à tous, aujourd\'hui on parle de vélo.', 5),
  ...say('oups je recommence pas', 9),
  ...say('Le vélo électrique change la ville.', 12),
];
const SCRIPT = 'Bonjour à tous, aujourd\'hui on parle de vélo.\nLe vélo électrique change la ville. Abonnez-vous à la chaîne !';

describe('the takes chosen against the script', () => {
  it('cuts the script into its sentences', () => {
    expect(sentencesOf(SCRIPT)).toEqual(['Bonjour à tous, aujourd\'hui on parle de vélo.', 'Le vélo électrique change la ville.', 'Abonnez-vous à la chaîne !']);
  });

  it('keeps the last good take of each sentence, in order, and says which sentence was never said', () => {
    const chosen = chooseTakes(sentencesOf(SCRIPT), recording);
    expect(chosen[0].takes).toHaveLength(2);
    expect(recording[chosen[0].kept!.first].s).toBe(5);
    expect(chosen[0].kept!.score).toBe(1);
    expect(recording[chosen[1].kept!.first].s).toBe(12);
    expect(chosen[2].kept).toBeNull();
    const spans = keptSpans(chosen, recording);
    expect(spans).toHaveLength(2);
    expect(spans[0].from).toBeCloseTo(4.92, 2);
    expect(spans[0].to).toBeCloseTo(5 + 7 * 0.4 + 0.3 + 0.15, 2);
  });

  it('cuts the video layer to those takes and keeps the script with the project', async () => {
    const reg = editorRegistry();
    let doc: TrammeDoc = newProject({ name: 'Vélo', width: 1080, height: 1920, fps: 30, duration: 30 }).doc;
    doc = { ...doc, assets: { ...doc.assets, talk: { type: 'video', src: 'assets/talk.mp4' } } };
    doc = applyOps(doc, [
      { op: 'add', path: '/compositions/main/layers/talk', value: { type: 'video', in: 0, out: 20, props: { video: 'talk', start: 0 } } },
      { op: 'replace', path: '/compositions/main/order', value: ['talk'] },
    ]).doc;
    const ctx = { doc, compId: doc.root, time: 0, selection: [], registry: reg, transcript: async () => ({ version: 1, duration: 20, words: recording }) } as unknown as ToolContext;
    const out = (await reg.tool('takes').tool.run({ video: 'talk', script: SCRIPT }, ctx)) as { ops: never[]; text: string };
    doc = applyOps(doc, out.ops).doc;
    const c = doc.compositions.main, kept = c.order.filter((id) => c.layers[id].props?.video === 'talk');
    expect(kept).toHaveLength(2);
    expect((c.layers[kept[0]].props as { start: number }).start).toBeCloseTo(4.92, 2);
    expect((c.layers[kept[1]].props as { start: number }).start).toBeCloseTo(11.92, 2);
    expect(doc.meta.script).toBe(SCRIPT);
    expect(out.text).toContain('Abonnez-vous');
  });
});
