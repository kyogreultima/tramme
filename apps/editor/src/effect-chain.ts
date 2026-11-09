import { AudioEffectSchema, audioEffectJsonSchema, type AudioEffect, type Composition, type ToolType } from '@tramme/core';
import { VOICE_EFFECTS } from '@tramme/render';
import { addTrackEffectOps, appendTrackEffectsOps, bypassTrackEffectOps, moveTrackEffectOps, removeTrackEffectOps, setTrackEffectOps } from './ui/timeline/mixer.ts';

export type EffectKind = AudioEffect['kind'];
export const EFFECT_KINDS: EffectKind[] = ['eq', 'compressor', 'reverb', 'lowCut', 'highCut', 'delay', 'distortion'];
export const startEffect = (kind: EffectKind): AudioEffect => ({
  eq: { kind: 'eq', low: 0, mid: 0, midFreq: 1000, midQ: 0.9, high: 0 },
  compressor: { kind: 'compressor', amount: 0 }, reverb: { kind: 'reverb', wet: 0 },
  lowCut: { kind: 'lowCut', frequency: 0 }, highCut: { kind: 'highCut', frequency: 0 },
  delay: { kind: 'delay', time: 280, feedback: 0, wet: 0 },
  distortion: { kind: 'distortion', drive: 1, tone: 0, wet: 0 },
} satisfies Record<EffectKind, AudioEffect>)[kind];

export const EFFECT_PRESETS: Record<string, readonly AudioEffect[]> = {
  'voice-cleanup': [{ kind: 'lowCut', frequency: 80 }, { kind: 'compressor', amount: 0.35 }, { kind: 'eq', low: 0, mid: -3, midFreq: 6500, midQ: 2, high: -1 }],
  'music-under-voice': [{ kind: 'eq', low: -2, mid: -4, midFreq: 1800, midQ: 0.7, high: -1 }, { kind: 'compressor', amount: 0.2 }],
  telephone: VOICE_EFFECTS.telephone,
  'big-room': [{ kind: 'reverb', wet: 0.65 }],
};

type JsonField = { minimum?: number; maximum?: number; anyOf?: JsonField[] };
type JsonBranch = { properties: Record<string, JsonField | { const?: string } > };
export function effectFields(kind: EffectKind): { key: string; min: number; max: number }[] {
  const schema = audioEffectJsonSchema() as { oneOf: JsonBranch[] };
  const branch = schema.oneOf.find((entry) => (entry.properties.kind as { const?: string }).const === kind)!;
  return Object.entries(branch.properties).flatMap(([key, value]) => {
    if (key === 'kind' || key === 'bypass') return [];
    const field = (value as JsonField).anyOf?.find((x) => x.minimum !== undefined) ?? value as JsonField;
    return field.minimum === undefined || field.maximum === undefined ? [] : [{ key, min: field.minimum, max: field.maximum }];
  });
}

export const chainText = (effects: readonly AudioEffect[], name: (kind: string) => string = (kind) => kind) => effects.length
  ? effects.map((effect, index) => `${index + 1}. ${name(effect.kind)}${effect.bypass ? ' (bypass)' : ''} (${Object.entries(effect).filter(([key]) => key !== 'kind' && key !== 'bypass').map(([key, value]) => `${key}=${value}`).join(', ')})`).join(' → ')
  : 'Empty chain';

type ChainInput = { action: 'list' | 'add' | 'preset' | 'set' | 'move' | 'bypass' | 'remove'; track?: string; kind?: EffectKind; preset?: string; effect?: AudioEffect | string; index?: number; to?: number; bypass?: boolean };
export const chainTool: ToolType<ChainInput> = {
  name: 'chain', title: 'Track effect chain', description: 'lists or edits an ordered track or bus effect chain, including presets',
  input: { type: 'object', properties: {
    action: { enum: ['list', 'add', 'preset', 'set', 'move', 'bypass', 'remove'], title: 'Chain action' },
    track: { type: 'string', title: 'Sound track', description: 'audio track or bus id; inferred from a selected clip or the only audio track' },
    kind: { enum: EFFECT_KINDS, title: 'Effect kind', description: 'for add without effect settings: insert a neutral effect' },
    preset: { enum: Object.keys(EFFECT_PRESETS), title: 'Chain preset' },
    effect: { title: 'Effect settings', description: 'complete effect object as JSON; the assistant may also pass an object' },
    index: { type: 'integer', minimum: 0, title: 'Effect index', description: 'zero-based position in the chain' },
    to: { type: 'integer', minimum: 0, title: 'Move to index' },
    bypass: { type: 'boolean', title: 'Bypass effect' },
  }, required: ['action'] },
  ai: { when: 'list a sound track chain, then add/set/move/bypass/remove an insert or append a preset; show the proposed chain before applying', avoid: 'using a note-valued delay without explicitly setting the composition sound.tempo to 20–300 BPM; never replace existing inserts by accident', example: { action: 'preset', track: 'A1', preset: 'voice-cleanup' } },
  run(input, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const selected = ctx.selection.map((id) => c.layers[id]?.track).find((id) => c.tracks?.some((t) => t.id === id && t.kind === 'audio'));
    const audio = (c.tracks ?? []).filter((t) => t.kind === 'audio');
    const id = input.track ?? selected ?? (audio.length === 1 ? audio[0].id : undefined);
    const track = audio.find((t) => t.id === id);
    if (!track) throw new Error('choose a sound track or bus');
    const before = track.effects ?? [];
    if (input.action === 'list') return { text: `${track.name ?? id} (${id}): ${chainText(before)}` };
    if (track.locked) throw new Error('the sound track is locked');
    const index = input.index;
    if (['set', 'move', 'bypass', 'remove'].includes(input.action) && (!Number.isInteger(index) || index! < 0 || index! >= before.length)) throw new Error('choose an effect index in the chain');
    if (input.action === 'move' && (!Number.isInteger(input.to) || input.to! < 0 || input.to! >= before.length)) throw new Error('choose a destination index in the chain');
    if (input.action === 'bypass' && typeof input.bypass !== 'boolean') throw new Error('choose true or false for bypass');
    const raw = typeof input.effect === 'string' ? JSON.parse(input.effect) : input.effect;
    const parsed = raw === undefined ? null : AudioEffectSchema.safeParse(raw);
    if (parsed && !parsed.success) throw new Error('invalid effect settings');
    if (input.action === 'preset' && (!input.preset || !Object.hasOwn(EFFECT_PRESETS, input.preset))) throw new Error('choose a chain preset');
    const effect = parsed?.data ?? (input.kind && EFFECT_KINDS.includes(input.kind) ? startEffect(input.kind) : null);
    if ((input.action === 'add' || input.action === 'set') && !effect) throw new Error('choose an effect kind or complete settings');
    if (effect?.kind === 'delay' && typeof effect.time === 'string' && !effect.bypass && c.sound?.tempo == null) throw new Error('set a composition tempo before using a note delay');
    const currentEffect = before[index!];
    if (input.action === 'bypass' && input.bypass === false && currentEffect?.kind === 'delay' && typeof currentEffect.time === 'string' && c.sound?.tempo == null) throw new Error('set a composition tempo before using a note delay');
    const ops = input.action === 'add' ? addTrackEffectOps(c, ctx.compId, id!, effect!, index)
      : input.action === 'preset' ? appendTrackEffectsOps(c, ctx.compId, id!, EFFECT_PRESETS[input.preset!]!)
      : input.action === 'set' ? setTrackEffectOps(c, ctx.compId, id!, index!, effect!)
      : input.action === 'move' ? moveTrackEffectOps(c, ctx.compId, id!, index!, input.to!)
      : input.action === 'bypass' ? bypassTrackEffectOps(c, ctx.compId, id!, index!, input.bypass!)
      : removeTrackEffectOps(c, ctx.compId, id!, index!);
    if (!ops.length && input.action !== 'set' && input.action !== 'bypass' && input.action !== 'move') throw new Error('the chain could not be changed');
    const after = ops.length && 'value' in ops[0] ? ops[0].value as AudioEffect[] : ops.length ? [] : before;
    return { label: 'Track effect chain', ops, text: `${track.name ?? id} (${id}): ${chainText(after)}` };
  },
};
