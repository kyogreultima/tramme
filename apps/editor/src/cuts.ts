// Cutting the silences of a talking video: the quiet gaps where nothing is
// said (hesitations, breaths) are shortened in place. Where someone speaks is
// heard in the sound by the voice detector the fillers use (Silero VAD, the
// sound's energy without it): a transcript's word timings stretch a word over
// the pause after it, so they alone miss most silences; they are the fallback.
// The video layer is split into the spans where something is said, laid back
// to back — the piece tightens, and the rest of the timeline is left alone.

import { pointer, type Op, type Span, type ToolContext, type ToolType } from '@tramme/core';
import { speechOf } from './fillers.ts';
import { freshId } from './model.ts';
import { t } from './i18n/index.ts';

const r = (x: number) => Math.round(x * 1000) / 1000;

export const CUTS_TOOLS: ToolType[] = [
  {
    name: 'silences',
    title: 'Cut the silences',
    description: 'shortens the quiet gaps of a talking video (hesitations, breaths): the layer is split into the spans where something is said, laid back to back',
    input: {
      type: 'object',
      properties: {
        video: { type: 'string', format: 'asset', assetType: 'video', title: 'Video' },
        min: { type: 'number', minimum: 0.2, title: 'Gaps longer than (s)', description: 'a quiet stretch longer than this is shortened' },
        keep: { type: 'number', minimum: 0, title: 'Pause kept (s)', description: 'what remains around each cut, so it breathes' },
      },
    },
    ai: { when: 'a talking head or a voice-over full of hesitations; gaps over 0.5 s shortened with 0.12 s kept read naturally', avoid: 'music-led edits, or a take already tight: the cuts would eat the rhythm' },
    async run({ video: wanted, min = 0.5, keep = 0.12 }, ctx: ToolContext) {
      const vids = Object.entries(ctx.doc.assets).filter(([, a]) => a.type === 'video');
      const asset = wanted ?? vids.find(([aid]) => ctx.selection.includes(aid))?.[0] ?? vids.at(-1)?.[0];
      if (!asset) throw new Error('the project has no video: bring one in first');
      const comp = ctx.doc.compositions[ctx.compId];
      const lid = comp.order.find((id) => comp.layers[id]?.type === 'video' && comp.layers[id]?.props?.video === asset);
      if (!lid) throw new Error(`${asset} is not placed in this composition: place it first`);
      const layer = comp.layers[lid];
      // the layer shows the file from props.start at the layer's in, at its rate
      const start = Number(layer.props?.start) || 0, rate = Number(layer.props?.rate) || 1;
      const lin = layer.in ?? 0, lout = Math.min(layer.out ?? comp.duration, comp.duration);
      const fileT = (c: number) => start + (c - lin) * rate;
      const usedFrom = fileT(lin), usedTo = fileT(lout);
      // where something is said: heard in the sound, else the transcript's words
      const heard = await speechOf(ctx, asset).catch(() => null);
      let said: Span[], by: string;
      if (heard?.spans.length) ({ spans: said, by } = heard);
      else {
        const tr = await ctx.transcript(asset);
        const words = tr.words.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e)).sort((a, b) => a.s - b.s);
        if (words.length < 2) throw new Error(`${asset}: its transcript has too few words to find the silences (transcribe it first)`);
        said = words.map((w) => ({ from: w.s, to: w.e }));
        by = 'the transcript';
      }
      // only the part of the file the layer shows: the file is heard, or transcribed, past it on both sides
      said = said.filter((w) => w.to > usedFrom && w.from < usedTo).sort((a, b) => a.from - b.from);
      if (!said.length) throw new Error(`${asset}: nothing is said in the part of the file "${lid}" shows`);
      // the quiet gaps between what is said, inside the span the layer shows
      const gaps: { from: number; to: number }[] = [];
      if (said[0].from - usedFrom > min) gaps.push({ from: usedFrom, to: said[0].from });
      for (let i = 1; i < said.length; i++) if (said[i].from - said[i - 1].to > min) gaps.push({ from: said[i - 1].to, to: said[i].from });
      if (usedTo - said[said.length - 1].to > min) gaps.push({ from: said[said.length - 1].to, to: usedTo });
      // the spans to keep: each gap is taken out but for `keep` on both sides, the breath around the words
      const spans: { from: number; to: number }[] = [];
      let cursor = usedFrom, cutCount = 0;
      for (const g of gaps) {
        const cut = g.to - g.from - keep * 2;
        if (cut <= 0.04) continue;
        spans.push({ from: cursor, to: g.from + keep });
        cursor = g.to - keep;
        cutCount++;
      }
      spans.push({ from: cursor, to: usedTo });
      const removed = usedTo - usedFrom - spans.reduce((d, s) => d + (s.to - s.from), 0);
      if (removed < 0.2) throw new Error(`${asset}: no silence worth cutting (its gaps are all under ${min} s)`);
      // the first span keeps the layer (its transform, its effects, its links); the next ones are new layers right after it
      const ops: Op[] = [];
      const taken: Record<string, unknown> = { ...comp.layers };
      const name = layer.name ?? asset;
      const added: string[] = [];
      let cursorC = lin;
      spans.forEach((s, i) => {
        const outC = r(cursorC + (s.to - s.from) / rate);
        if (i === 0) {
          ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', lid, 'out'), value: outC });
          if (s.from !== usedFrom) ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', lid, 'props', 'start'), value: r(s.from) });
        } else {
          const id = freshId(taken, `${lid}-${i + 1}`);
          taken[id] = 1;
          added.push(id);
          ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { ...structuredClone(layer), name: `${name} · ${i + 1}`, in: r(cursorC), out: outC, props: { ...layer.props, start: r(s.from) } } });
        }
        cursorC = outC;
      });
      const idx = comp.order.indexOf(lid);
      const order = [...comp.order];
      order.splice(idx + 1, 0, ...added);
      if (added.length) ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'order'), value: order });
      const saved = `${removed.toFixed(2)} s`;
      return {
        ops, label: t('cuts.done', { name, saved }), notice: t('cuts.done', { name, saved }),
        text: [
          `${cutCount} silence(s) cut from "${asset}": ${saved} saved, ${keep} s kept around each cut so it breathes.`,
          `The layer "${lid}" is now ${spans.length} span(s) laid back to back, ending at ${cursorC.toFixed(2)} s. The layers after it stay where they are: a gap may remain at the end, close it by hand (or ask me to close the ranks).`,
          `The silences were found in ${by}. Check the result (check) and look at the joins with the motion tool.`,
        ].join('\n'),
      };
    },
  },
];
