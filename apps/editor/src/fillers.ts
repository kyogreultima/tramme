// The fillers tool (docs/editing-roadmap.md, step 11): the "uh"s and "um"s
// a transcript leaves out, found where a voice activity detector hears
// speech and no word is written (Silero VAD in the browser; the energy of the
// sound when the model cannot load), and the ones a transcription model that
// writes them did write. They are cut as the silences are: the layer split,
// the parts laid back to back, the transcript of the edit remapped and the
// captions reconnected to it. Each cut is listed with its moment, and put
// back by its number (restore).

import { energySpeech, hesitationsOf, joinAcross, keepsAround, pointer, remapTranscript, spansOf, transcriptIdOf, type Layer, type Op, type Span, type ToolContext, type ToolType, type Transcript } from '@tramme/core';
import { hubFile } from './cutout.ts';
import { chosenModel } from './settings.ts';
import { madeBy } from './models.ts';
import { freshId } from './model.ts';
import { t } from './i18n/index.ts';

/** the words a transcription model writes for a hesitation (when it writes them) */
export const FILLER_WORD = /^[("'«]*(u+h+m*|u+m+|e+u+h+|h+u+m+|e+r+m*|a+h+|e+h+|h+m+|m+h*m+|bah|ben)[.,!?…)"'»]*$/i;

/** the voice detector, once per page */
let silero: Promise<(x: Float32Array) => Promise<Float32Array>> | null = null;

/**
 * Silero VAD on a sound at 16 kHz: the probability of speech of each window
 * of 512 samples. Its two versions are read: v5 (a state of 2×1×128, the
 * 64 samples before each window given with it) and v4 (h and c).
 */
function sileroVad(): Promise<(x: Float32Array) => Promise<Float32Array>> {
  silero ??= (async () => {
    const entry = chosenModel('vad');
    if (entry.adapter.kind !== 'vad') throw new Error(`${entry.name} is not a voice detector`);
    const { rate, window: W } = entry.adapter;
    // transformers.js sets onnxruntime up (where its wasm files are): load it first
    await import('@huggingface/transformers');
    const ort = await import('onnxruntime-web/webgpu');
    const session = await ort.InferenceSession.create(await hubFile(entry.source), { executionProviders: ['wasm'] });
    const v5 = session.inputNames.includes('state'), ctxN = v5 ? (rate === 16000 ? 64 : 32) : 0;
    return async (x: Float32Array) => {
      const n = Math.floor(x.length / W), probs = new Float32Array(n);
      let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
      let h = new ort.Tensor('float32', new Float32Array(2 * 64), [2, 1, 64]), c = new ort.Tensor('float32', new Float32Array(2 * 64), [2, 1, 64]);
      const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(rate)]), []);
      for (let i = 0; i < n; i++) {
        const win = new Float32Array(ctxN + W);
        win.set(x.subarray(Math.max(0, i * W - ctxN), i * W), ctxN - Math.min(ctxN, i * W));
        win.set(x.subarray(i * W, (i + 1) * W), ctxN);
        const input = new ort.Tensor('float32', win, [1, ctxN + W]);
        const out = await session.run(v5 ? { input, state, sr } : { input, h, c, sr });
        probs[i] = (out.output.data as Float32Array)[0];
        if (v5) state = out.stateN as typeof state;
        else { h = out.hn as typeof h; c = out.cn as typeof c; }
      }
      return probs;
    };
  })();
  silero.catch(() => { silero = null; });
  return silero;
}

/** where someone speaks in a file (file seconds), and what found it */
async function speechOf(ctx: ToolContext, asset: string): Promise<{ spans: Span[]; by: string }> {
  const bytes = await (await fetch(ctx.assetUrl(asset))).arrayBuffer();
  const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
  const x = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < x.length; i++) x[i] += d[i] / buf.numberOfChannels; }
  try {
    ctx.progress?.(0, 1, t('fillers.listening'));
    const probs = await (await sileroVad())(x);
    // a window is speech over 0.5, and stays speech down to 0.35 (Silero's own hysteresis)
    const on: boolean[] = [];
    let speaking = false;
    for (const p of probs) { speaking = speaking ? p > 0.35 : p > 0.5; on.push(speaking); }
    return { spans: spansOf(on, 512 / 16000, 0.1, 0.08), by: madeBy(chosenModel('vad')) };
  } catch {
    return { spans: energySpeech(x, 16000), by: 'the energy of the sound (the voice detector could not load)' };
  }
}

/** a layer playing a file, and where in the file it plays */
const fileSpan = (l: Layer, compDuration: number) => {
  const start = Number(l.props?.start) || 0, rate = Number(l.props?.rate) || 1, lin = l.in ?? 0, lout = l.out ?? compDuration;
  return { from: start, to: start + (lout - lin) * rate, rate, lin };
};

/**
 * The operations that lay the parts `keeps` of a file back to back from the
 * layer `lid`'s in point: it plays the first, copies of it the others, right
 * after it in the stack; `drop` are the layers of an earlier edit replaced.
 */
function layChain(ctx: ToolContext, lid: string, keeps: Span[], drop: string[] = []): { ops: Op[]; ids: string[]; end: number } {
  const comp = ctx.doc.compositions[ctx.compId], layer = comp.layers[lid], { rate, lin } = fileSpan(layer, comp.duration);
  const ops: Op[] = drop.map((id) => ({ op: 'remove' as const, path: pointer('compositions', ctx.compId, 'layers', id) }));
  const taken: Record<string, unknown> = Object.fromEntries(Object.keys(comp.layers).filter((id) => !drop.includes(id)).map((id) => [id, 1]));
  const ids: string[] = [];
  let cursor = lin;
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  keeps.forEach((k, i) => {
    const out = r(cursor + (k.to - k.from) / rate);
    if (i === 0) {
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid, 'out'), value: out });
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid, 'props', 'start'), value: r(k.from) });
    } else {
      const id = freshId(taken, `${lid}-${i + 1}`);
      taken[id] = 1;
      ids.push(id);
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { ...structuredClone(layer), name: `${layer.name ?? lid} · ${i + 1}`, in: r(cursor), out, props: { ...layer.props, start: r(k.from) } } });
    }
    cursor = out;
  });
  const order = comp.order.filter((id) => !drop.includes(id));
  order.splice(order.indexOf(lid) + 1, 0, ...ids);
  ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'order'), value: order });
  return { ops, ids: [lid, ...ids], end: cursor };
}

/** the transcript of the edit (composition time from `at`), the captions reconnected to it */
async function editTranscript(ctx: ToolContext, asset: string, tr: Transcript, keeps: Span[], at: number): Promise<Op[]> {
  const remapped = remapTranscript(tr, keeps, at);
  const srcId = transcriptIdOf(asset), editId = `${srcId}-edit`.slice(0, 64);
  const path = await ctx.writeFile(`assets/transcripts/${asset}-edit.json`, JSON.stringify(remapped));
  const ops: Op[] = [{ op: ctx.doc.assets[editId] ? 'replace' : 'add', path: pointer('assets', editId), value: { type: 'json', src: path, name: `Transcript · ${ctx.doc.assets[asset]?.name ?? asset} · edit` } }];
  for (const [id, l] of Object.entries(ctx.doc.compositions[ctx.compId].layers)) {
    if (l.type !== 'captions' || (l.props?.transcript !== srcId && l.props?.transcript !== editId)) continue;
    ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', id, 'props', 'transcript'), value: editId });
    ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id, 'props', 'start'), value: 0 });
  }
  return ops;
}

/** a list of cuts kept beside the file, so each can be put back */
interface FillerCuts { version: 1; kind: 'fillers'; asset: string; layer: string; cuts: { n: number; from: number; to: number; word?: string }[] }

interface FillersArgs { video?: string; restore?: number[] | string; min?: number; max?: number }

const fillers: ToolType<FillersArgs> = {
  name: 'fillers', title: 'Cut the hesitations', description: 'cuts the "uh"s and "um"s of a voice (a sound or a video): the speech heard where the transcript has no word, and the hesitations a transcription model wrote; the layer split, the parts laid back to back, the transcript of the edit remapped, the captions reconnected. Each cut is listed with its moment; restore puts some back by their number',
  input: {
    type: 'object',
    properties: {
      video: { type: 'string', format: 'asset', assetType: ['video', 'audio'], title: 'Voice', description: 'the file; the selected or the last video by default' },
      restore: { type: ['array', 'string'], items: { type: 'integer' }, title: 'Put back', description: 'the numbers of cuts made before to put back (a word cut by mistake)' },
      min: { type: 'number', minimum: 0.05, title: 'Shortest (s)', description: 'a hesitation shorter than this stays (0.15 by default)' },
      max: { type: 'number', minimum: 0.3, title: 'Longest (s)', description: 'speech without words longer than this is a passage the transcript missed, not a hesitation (1.2 by default)' },
    },
  },
  ai: {
    when: 'a talking head or a voice-over with "uh"s and "um"s, after the transcript and before the captions; listen to the cuts it lists (their moments) and put back a word cut by mistake',
    avoid: 'a voice whose transcript is missing or poor (transcribe it first), a performance where the hesitations are the point',
  },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const files = Object.entries(ctx.doc.assets).filter(([, x]) => x.type === 'video' || x.type === 'audio');
    const asset = a.video ?? files.find(([id]) => ctx.selection.some((s) => comp.layers[s]?.props?.[comp.layers[s].type] === id))?.[0] ?? files.filter(([, x]) => x.type === 'video').at(-1)?.[0];
    if (!asset || !ctx.doc.assets[asset]) throw new Error('fillers: a sound or a video of the project is expected');
    const type = ctx.doc.assets[asset].type;
    // the layers playing it, in time (an edit made before is one chain)
    const chain = comp.order.filter((id) => comp.layers[id]?.type === type && comp.layers[id].props?.[type] === asset).sort((x, y) => (comp.layers[x].in ?? 0) - (comp.layers[y].in ?? 0));
    if (!chain.length) throw new Error(`${asset} is not placed in this composition: place it first`);
    const lid = chain[0], listId = `fillers-${asset}`.slice(0, 64);
    const tr = await ctx.transcript(asset);

    if (a.restore !== undefined) {
      const wanted = (typeof a.restore === 'string' ? a.restore.split(/[\s,]+/).map(Number) : a.restore).filter(Number.isFinite);
      const list = ctx.doc.assets[listId] ? JSON.parse((await ctx.readText(ctx.doc.assets[listId].src)) ?? 'null') as FillerCuts | null : null;
      if (!list?.cuts) throw new Error(`fillers: no cut of ${asset} to put back`);
      const back = list.cuts.filter((c) => wanted.includes(c.n));
      if (!back.length) throw new Error(`fillers: no cut numbered ${wanted.join(', ')} (${list.cuts.map((c) => c.n).join(', ')})`);
      // the chain's parts, two joined wherever a cut put back lay between them
      const parts = chain.map((id) => fileSpan(comp.layers[id], comp.duration));
      const keeps = joinAcross(parts, back);
      const laid = layChain(ctx, lid, keeps, chain.slice(1));
      const ops = [...laid.ops, ...(parts[0].rate === 1 ? await editTranscript(ctx, asset, tr, keeps, parts[0].lin) : [])];
      const left: FillerCuts = { ...list, cuts: list.cuts.filter((c) => !wanted.includes(c.n)) };
      const path = await ctx.writeFile(`assets/fillers/${asset}.json`, JSON.stringify(left));
      ops.push({ op: 'replace', path: pointer('assets', listId), value: { ...ctx.doc.assets[listId], src: path } });
      return { ops, label: t('fillers.restored', { n: back.length }), notice: t('fillers.restored', { n: back.length }), text: `Put back: ${back.map((c) => `#${c.n}`).join(', ')}; ${asset} now plays in ${keeps.length} part(s), ending at ${laid.end.toFixed(2)} s.` };
    }

    if (chain.length > 1) throw new Error(`${asset} is already cut into ${chain.length} layers: run fillers on the whole take first, or put cuts back with restore`);
    const span = fileSpan(comp.layers[lid], comp.duration);
    const words = tr.words.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e));
    if (words.length < 2) throw new Error(`${asset}: its transcript has too few words (transcribe it first)`);
    const written = words.filter((w) => FILLER_WORD.test(w.w.trim()));
    const speech = await speechOf(ctx, asset);
    const heard = hesitationsOf(words.filter((w) => !written.includes(w)), speech.spans, { min: a.min ?? 0.15, max: a.max ?? 1.2, from: span.from, to: span.to });
    const cuts = [...heard.map((h) => ({ ...h })), ...written.filter((w) => w.s >= span.from && w.e <= span.to).map((w) => ({ from: w.s, to: w.e, word: w.w }))]
      .sort((x, y) => x.from - y.from)
      .reduce<{ from: number; to: number; word?: string }[]>((acc, c) => { const last = acc[acc.length - 1]; if (last && c.from <= last.to) last.to = Math.max(last.to, c.to); else acc.push({ ...c }); return acc; }, []);
    if (!cuts.length) return { text: `No hesitation found in ${asset} (speech found by ${speech.by}).`, notice: t('fillers.none') };
    const keeps = keepsAround(span.from, span.to, cuts);
    const laid = layChain(ctx, lid, keeps);
    const ops = [...laid.ops, ...(span.rate === 1 ? await editTranscript(ctx, asset, tr, keeps, span.lin) : [])];
    // the list of cuts, each with where it now sits in the composition (the join)
    const numbered = cuts.map((c, i) => ({ n: i + 1, from: +c.from.toFixed(3), to: +c.to.toFixed(3), ...(c.word ? { word: c.word } : {}) }));
    const saved: FillerCuts = { version: 1, kind: 'fillers', asset, layer: lid, cuts: numbered };
    const path = await ctx.writeFile(`assets/fillers/${asset}.json`, JSON.stringify(saved));
    ops.push({ op: ctx.doc.assets[listId] ? 'replace' : 'add', path: pointer('assets', listId), value: { type: 'json', src: path, name: `${t('fillers.listName')} · ${ctx.doc.assets[asset].name ?? asset}` } });
    const joinAt = (c: Span) => { let at = span.lin; for (const k of keeps) { if (k.to <= c.from + 0.03) at += (k.to - k.from) / span.rate; else break; } return at; };
    const removed = span.to - span.from - keeps.reduce((s, k) => s + k.to - k.from, 0);
    return {
      ops, label: t('fillers.done', { n: cuts.length }), notice: t('fillers.done', { n: cuts.length }),
      text: [
        `${cuts.length} hesitation(s) cut from ${asset} (${removed.toFixed(2)} s; speech found by ${speech.by}${written.length ? `, ${written.length} written by the transcript` : ''}). Listen to each join; put one back with fillers restore [its number]:`,
        ...numbered.map((c) => `#${c.n} at ${joinAt(c).toFixed(2)} s (the file's ${c.from.toFixed(2)}–${c.to.toFixed(2)} s${c.word ? `, "${c.word}"` : ''})`),
      ].join('\n'),
    };
  },
};

export const FILLERS_TOOLS: ToolType[] = [fillers];
