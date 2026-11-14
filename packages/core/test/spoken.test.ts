import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { findSpoken, foldWord, isTalking, runChecks, speechMoments, spokenOfDoc, spokenTimes, spokenWords, type Layer, type Transcript, type TrammeDoc } from '../src/index.ts';

/** words said one after the other from `at`, each `step` long */
const said = (text: string, at = 0, step = 0.4) => text.split(' ').map((w, i) => ({ w, s: +(at + i * step).toFixed(2), e: +(at + i * step + step * 0.9).toFixed(2) }));
const transcript = (words: Transcript['words'], extra: Partial<Transcript> = {}): Transcript => ({ version: 1, duration: 60, words, ...extra });

/** a 1920 x 1080 composition of `duration` s playing the video `talk` full frame, and the given layers over it */
function talking(layers: Record<string, Partial<Layer>>, duration = 20): TrammeDoc {
  const all = { talk: { type: 'video', transform: { position: [960, 540] }, props: { video: 'talk', size: [1920, 1080] } }, ...layers } as Record<string, Layer>;
  return {
    schema: 'tramme/1', meta: { title: 'Talk' }, tokens: {}, root: 'main',
    assets: { talk: { type: 'video', src: 'talk.mp4' }, 'transcription-talk': { type: 'json', src: 't.json' } },
    compositions: { main: { name: 'Main', width: 1920, height: 1080, fps: 30, duration, layers: all, order: Object.keys(all) } },
  };
}
const word = (text: string, from: number, to: number, y = 900): Partial<Layer> => ({ type: 'text', in: from, out: to, transform: { position: [960, y] }, props: { text, size: 80, align: 'center', baseline: 'middle' } });
const card = (from: number, to: number, x = 960, extra: Partial<Layer> = {}): Partial<Layer> => ({ type: 'shape.rect', in: from, out: to, transform: { position: [x, 540] }, props: { size: [800, 700], fill: '#222222' }, ...extra });

describe('what is said, in the composition\'s time', () => {
  it('folds words for matching', () => {
    expect(foldWord('Récompense,')).toBe('recompense');
    expect(foldWord('« 120€ »')).toBe('120');
  });

  it('maps a file\'s words through each layer playing it: its start in the file, its rate, its span', () => {
    const d = talking({});
    d.compositions.main.layers.talk = { ...d.compositions.main.layers.talk, in: 2, out: 6, props: { video: 'talk', size: [1920, 1080], start: 10 } } as Layer;
    const words = spokenWords(d, 'main', 'talk', transcript([{ w: 'avant', s: 9, e: 9.5 }, { w: 'dedans', s: 11, e: 11.5 }, { w: 'après', s: 15, e: 15.5 }]));
    expect(words).toEqual([{ w: 'dedans', s: 3, e: 3.5 }]);
    // an edit's transcript is in the composition's time already
    expect(spokenWords(d, 'main', 'talk', transcript([{ w: 'x', s: 1, e: 2 }], { keeps: [{ from: 0, to: 4 }] }))).toEqual([{ w: 'x', s: 1, e: 2 }]);
  });

  it('reads the edit\'s transcript first', () => {
    const d = talking({});
    const data = (id: string) => (id === 'transcription-talk-edit' ? transcript(said('le montage'), { keeps: [] }) : id === 'transcription-talk' ? transcript(said('le fichier')) : undefined);
    expect(spokenOfDoc(d, 'main', data).map((w) => w.w)).toEqual(['le', 'montage']);
    expect(isTalking(d, 'main')).toBe(true);
  });

  it('finds where a text is said, the nearest when it is said twice', () => {
    const words = [...said('le plaisir arrive vite', 0), ...said('encore le plaisir', 10)];
    expect(findSpoken(words, 'PLAISIR', 9)?.s).toBe(10.8);
    expect(findSpoken(words, 'Le plaisir arrive', 0)).toMatchObject({ s: 0.4, matched: 2, total: 2 });
    expect(findSpoken(words, 'rien de tout ça', 0)).toBeNull();
  });

  it('gives each word of a title the moment it is said, the small words between their neighbours', () => {
    const words = said('comment utiliser le principe', 4);
    expect(spokenTimes(words, 'Comment utiliser le principe ?', 4)?.times.map((x) => +x.toFixed(2))).toEqual([4, 4.4, 4.52, 5.2, 5.32]);
  });

  it('lists the moments worth an insert, with the words they turn on', () => {
    const words = [
      ...said('Un abonnement coûte 10 €, soit 120 € par an.', 0),
      ...said('Une animation, un son, une récompense, un chiffre qui monte.', 3.8),
      ...said('Regardez Duolingo par exemple.', 8),
      ...said('Comment utiliser ce principe ?', 9.8),
    ];
    const kinds = speechMoments(words).map((m) => `${m.kind}@${m.t}`);
    expect(kinds).toEqual(['comparison@1.2', 'list@3.8', 'name@8.4', 'question@9.8']);
    const list = speechMoments(words).find((m) => m.kind === 'list')!;
    expect(list.beats.map((b) => b.w)).toEqual(['Une animation', 'un son', 'une récompense', 'un chiffre qui monte.']);
  });
});

describe('the checks of a dressed talking video', () => {
  const run = async (d: TrammeDoc, words = said('les gens vont perdre leur argent et la récompense arrive', 1, 0.5)) =>
    (await runChecks(d, builtinRegistry(), 'main', { data: (id) => (id === 'transcription-talk' ? transcript(words) : undefined), only: ['word-sync', 'insert-still', 'insert-form'] }))
      .map((i) => `${i.check}:${i.severity}@${i.t}`);

  it('flags a keyword appearing well after its word is said, never one on it', async () => {
    // "perdre" is said at 2.5 s
    expect(await run(talking({ kw: word('PERDRE', 3.5, 5) }))).toEqual(['word-sync:warning@3.5']);
    expect(await run(talking({ kw: word('PERDRE', 2.5, 4) }))).toEqual([]);
    // long before: a note
    expect(await run(talking({ kw: word('PERDRE', 1, 4) }))).toEqual([]);
    expect(await run(talking({ kw: word('récompense', 0.5, 6) }))).toEqual(['word-sync:info@0.5']);
  });

  it('says nothing of a video nobody speaks in', async () => {
    expect(await run(talking({ kw: word('PERDRE', 5, 6) }), [])).toEqual([]);
  });

  it('flags an insert that holds still while the voice goes on, not one that moves', async () => {
    expect(await run(talking({ a: card(2, 7) }))).toEqual(['insert-still:warning@2']);
    const moving = card(2, 7, 960, { transform: { position: { $k: [{ t: 2, v: [900, 540] }, { t: 7, v: [1020, 540] }] } } as never });
    expect(await run(talking({ a: moving }))).toEqual([]);
  });

  it('flags two inserts in a row built the same way in the same place', async () => {
    const beat = (from: number, to: number, x: number) => card(from, to, x, { transform: { position: { $k: [{ t: from, v: [x - 40, 540] }, { t: to, v: [x + 40, 540] }] } } as never });
    expect(await run(talking({ a: beat(2, 5, 960), b: beat(8, 11, 960) }))).toEqual(['insert-form:warning@8']);
    expect(await run(talking({ a: beat(2, 5, 500), b: beat(8, 11, 1400) }))).toEqual([]);
  });
});
