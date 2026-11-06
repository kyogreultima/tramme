// Move into apps/editor/test/ after iteration 5's frozen gate.
import { expect, it } from 'vitest';
import { applyOps, History, toolInputIssues, validate, type ToolContext, type ToolOutput } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { chainTool, EFFECT_PRESETS, effectFields, startEffect } from '../src/effect-chain.ts';
import { addTrackEffectOps, bypassTrackEffectOps, moveTrackEffectOps, removeTrackEffectOps, setTrackEffectOps } from '../src/ui/timeline/mixer.ts';
import { describeOp } from '../src/model.ts';

const context = () => {
  const { doc } = newProject({ name: 'Insert chain', width: 640, height: 360, fps: 30, duration: 2 });
  doc.compositions.main.kind = 'sequence';
  doc.compositions.main.tracks = [{ id: 'A1', kind: 'audio', name: 'Narration' }, { id: 'A2', kind: 'audio' }, { id: 'B1', kind: 'audio', bus: true }];
  return { doc, compId: 'main', time: 0, selection: [], registry: builtinRegistry(), signal: new AbortController().signal } as unknown as ToolContext;
};
const run = (ctx: ToolContext, input: object) => chainTool.run(input as Parameters<typeof chainTool.run>[0], ctx) as ToolOutput;

it('previews a named preset without mutating the document, then applies it as one undoable edit', () => {
  for (const track of ['A1', 'B1']) {
    const ctx = context(), before = structuredClone(ctx.doc);
    const result = run(ctx, { action: 'preset', track, preset: 'voice-cleanup' });
    expect(ctx.doc).toEqual(before);
    expect(result.ops).toHaveLength(1);
    expect(result.text).toContain('lowCut');
    expect(result.text).toContain('compressor');
    expect(result.text).toContain('eq');
    const history = new History(ctx.doc);
    history.apply({ label: result.label!, ops: result.ops! });
    const changed = history.doc.compositions.main.tracks!.find((t) => t.id === track)!;
    expect(changed.effects).toEqual(EFFECT_PRESETS['voice-cleanup']);
    expect(validate(history.doc, ctx.registry)).toEqual([]);
    expect(history.undo()).toEqual(before);
  }
});

it('reaches the exact same add, set, move, bypass and remove operations as the mixer', () => {
  const ctx = context(), c = ctx.doc.compositions.main, effect = { kind: 'compressor' as const, amount: 0.5 };
  expect(run(ctx, { action: 'add', track: 'A1', effect }).ops).toEqual(addTrackEffectOps(c, 'main', 'A1', effect));
  expect(run(ctx, { action: 'add', track: 'A1', effect: JSON.stringify(effect) }).ops).toEqual(addTrackEffectOps(c, 'main', 'A1', effect));
  c.tracks![0].effects = [effect, { kind: 'lowCut', frequency: 80 }];
  const next = { kind: 'compressor' as const, amount: 0.8 };
  expect(toolInputIssues(chainTool.input, { action: 'set', track: 'A1', index: 0, effect: next })).toEqual([]);
  expect(run(ctx, { action: 'set', track: 'A1', index: 0, effect: next }).ops).toEqual(setTrackEffectOps(c, 'main', 'A1', 0, next));
  expect(run(ctx, { action: 'move', track: 'A1', index: 0, to: 1 }).ops).toEqual(moveTrackEffectOps(c, 'main', 'A1', 0, 1));
  expect(run(ctx, { action: 'bypass', track: 'A1', index: 0, bypass: true }).ops).toEqual(bypassTrackEffectOps(c, 'main', 'A1', 0, true));
  expect(run(ctx, { action: 'remove', track: 'A1', index: 0 }).ops).toEqual(removeTrackEffectOps(c, 'main', 'A1', 0));
});

it('shows every proposed processor and setting on the proposal card', () => {
  const ctx = context();
  const result = run(ctx, { action: 'preset', track: 'A1', preset: 'voice-cleanup' });
  const line = describeOp(ctx.doc, result.ops![0]);
  expect(line).toContain('Narration');
  for (const detail of ['80', '0.35', '6500', '-3']) expect(line).toContain(detail);
  expect(line.length).toBeGreaterThan(48);
});

it('appends presets to an existing chain, keeps returned preset data independent and leaves no-op edits empty', () => {
  const ctx = context(), c = ctx.doc.compositions.main;
  c.tracks![0].effects = [{ kind: 'compressor', amount: 0.5 }];
  const result = run(ctx, { action: 'preset', track: 'A1', preset: 'telephone' });
  expect(applyOps(ctx.doc, result.ops!).doc.compositions.main.tracks![0].effects).toEqual([{ kind: 'compressor', amount: 0.5 }, ...EFFECT_PRESETS.telephone]);
  expect(run(ctx, { action: 'set', track: 'A1', index: 0, effect: { kind: 'compressor', amount: 0.5 } }).ops).toEqual([]);
  (result.ops![0] as { value: unknown[] }).value.pop();
  expect(EFFECT_PRESETS.telephone).toHaveLength(4);
});

it('derives editable numeric bounds from the strict document schema', () => {
  for (const kind of ['eq', 'compressor', 'reverb', 'lowCut', 'highCut', 'delay', 'distortion'] as const) {
    const effect = startEffect(kind);
    const fields = effectFields(kind);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => typeof field.min === 'number' && typeof field.max === 'number')).toBe(true);
    expect(validate(applyOps(context().doc, addTrackEffectOps(context().doc.compositions.main, 'main', 'A1', effect)).doc, builtinRegistry())).toEqual([]);
  }
  expect(effectFields('delay').find((field) => field.key === 'feedback')).toMatchObject({ min: 0, max: 0.95 });
  expect(effectFields('distortion').find((field) => field.key === 'drive')).toMatchObject({ min: 0.1, max: 20 });
});

it('refuses locked or unknown targets, invalid indices/settings, ambiguous tracks and untempered note delays', () => {
  const ctx = context();
  for (const input of [
    { action: 'add', kind: 'eq' },
    { action: 'add', track: 'gone', kind: 'eq' },
    { action: 'remove', track: 'A1', index: -1 },
    { action: 'add', track: 'A1', effect: { kind: 'compressor', amount: 2 } },
    { action: 'add', track: 'A1', effect: '{broken' },
    { action: 'add', track: 'A1', effect: { kind: 'delay', time: '1/4', feedback: 0.3, wet: 0.5 } },
  ]) expect(() => run(ctx, input)).toThrow();
  ctx.doc.compositions.main.tracks![0].locked = true;
  expect(() => run(ctx, { action: 'preset', track: 'A1', preset: 'voice-cleanup' })).toThrow();
  expect(run(ctx, { action: 'list', track: 'A1' }).text).toContain('A1');
});

it('resolves a selected clip or the only audio track and preserves bypassed notes without choosing a tempo', () => {
  const ctx = context(), c = ctx.doc.compositions.main;
  c.layers.voice = { type: 'audio', track: 'A1', props: {} }; c.order = ['voice']; ctx.selection = ['voice'];
  const effect = { kind: 'delay', time: '1/4', feedback: 0.3, wet: 0.5, bypass: true };
  expect(run(ctx, { action: 'add', effect }).ops).toEqual(addTrackEffectOps(c, 'main', 'A1', effect as any));
  expect(c.sound?.tempo).toBeUndefined();
  c.tracks![0].effects = [effect as any];
  expect(() => run(ctx, { action: 'bypass', track: 'A1', index: 0, bypass: false })).toThrow(/tempo/);
});
