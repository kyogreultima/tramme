import { pointer, type ToolType } from '@tramme/core';
import { freshId } from './model.ts';
import { loadImage } from './perception.ts';
import { EDITOR_PRESETS } from './presets.ts';
import { countsToImage, gradeReadings, type ScopeRegion, VECTOR_SIZE, vectorscope, WAVE_ROWS, waveform } from './scopes.ts';

function neutralRegion(value: string | number[] | undefined): ScopeRegion | undefined {
  if (value === undefined) return;
  const values = typeof value === 'string' ? value.trim().split(/[\s,]+/).map(Number) : value;
  const [x, y, width, height] = values;
  if (values.length !== 4 || !values.every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) {
    throw new Error('neutral must be x, y, width, height in percent, inside the frame');
  }
  return [x, y, width, height];
}

const scopes: ToolType<{ at?: number; compId?: string; neutral?: string | number[] }> = {
  name: 'grade-scopes', title: 'Read colour scopes',
  description: 'measures a rendered frame with the pending proposal included: luma percentiles, near-black and near-white proportions, RGB clipping, an optional neutral patch, waveform and vectorscope',
  input: { type: 'object', properties: {
    at: { type: 'number', minimum: 0, title: 'Time (s)' },
    compId: { type: 'string', title: 'Composition' },
    neutral: { type: ['string', 'array'], title: 'Neutral patch', description: 'a known white or grey surface, x, y, width, height in percent of the rendered frame' },
  } },
  async run({ at, compId, neutral }, ctx) {
    const id = compId ?? ctx.compId, time = at ?? ctx.time, comp = ctx.doc.compositions[id];
    if (!comp) throw new Error(`unknown composition: ${id}`);
    if (!Number.isFinite(time) || time < 0 || time >= comp.duration) throw new Error('choose a time inside the composition');
    const region = neutralRegion(neutral);
    const frame = await loadImage(await ctx.renderStill(time, id, 'image/png'));
    const w = frame.naturalWidth, h = frame.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(frame, 0, 0);
    const rgba = g.getImageData(0, 0, w, h).data;
    const scopeImage = (counts: Uint32Array, width: number, height: number, caption: string) => {
      const scope = document.createElement('canvas');
      scope.width = width; scope.height = height;
      const draw = scope.getContext('2d')!;
      draw.putImageData(new ImageData(countsToImage(counts, width, height), width, height), 0, 0);
      draw.globalCompositeOperation = 'destination-over';
      draw.fillStyle = '#101517';
      draw.fillRect(0, 0, width, height);
      return { url: scope.toDataURL('image/png'), caption };
    };
    return {
      text: [
        `Display-referred levels (0..255) at ${time.toFixed(3)} s in ${id}, from the rendered ${w} × ${h} frame. Near black = luma 0–2, near white = 253–255. RGB endpoint percentages are measured per channel. Transparent pixels are omitted.`,
        JSON.stringify(gradeReadings(rgba, w, h, region)),
        region ? 'A positive magentaMinusGreen means the patch has less green than the mean of red and blue. A positive redMinusBlue indicates a red–blue imbalance. Interpret these only where the surface and light should be neutral.' : 'For a neutral reading, sample a known grey or white patch with the neutral input.',
      ].join('\n'),
      images: [
        scopeImage(waveform(rgba, w, h), w, WAVE_ROWS, 'Luma waveform'),
        scopeImage(vectorscope(rgba, w, h), VECTOR_SIZE, VECTOR_SIZE, 'Vectorscope (Cb/Cr)'),
      ],
    };
  },
};

const looks = EDITOR_PRESETS.filter((preset) => preset.name.startsWith('look-'));
const look: ToolType<{ look?: string; layer?: string; amount?: number }> = {
  name: 'grade-look', title: 'Colour looks',
  description: 'lists the editor’s colour looks or adds a dose of one to a corrected video or image layer, as editable effects in the pending proposal',
  input: { type: 'object', properties: {
    look: { type: 'string', enum: looks.map((preset) => preset.name), title: 'Look' },
    layer: { type: 'string', format: 'layer', title: 'Layer' },
    amount: { type: 'number', minimum: 0, maximum: 1, title: 'Amount', description: '0 has no effect, 1 is the full preset, 0.25 by default' },
  } },
  run(input, ctx) {
    if (!input.look) return { text: looks.map((preset) => `${preset.name} — ${preset.title}. ${preset.description}.`).join('\n') };
    const preset = looks.find((entry) => entry.name === input.look);
    if (!preset?.effects) throw new Error(`unknown colour look: ${input.look}`);
    const amount = input.amount ?? 0.25;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error('amount must be between 0 and 1');
    if (amount === 0) return { text: `${preset.title}: 0%, no effects added.` };
    const comp = ctx.doc.compositions[ctx.compId], id = input.layer ?? (ctx.selection.length === 1 ? ctx.selection[0] : '');
    const layer = comp?.layers[id];
    if (layer?.type !== 'video' && layer?.type !== 'image') throw new Error('choose one video or image layer for the look');
    const effects = layer.effects ?? [];
    const taken = Object.fromEntries(effects.map((effect) => [effect.id, true]));
    const stack = preset.effects.map((effect) => {
      const props = { ...effect.props };
      if (effect.type === 'fx.grade') props.strength = amount;
      if (effect.type === 'fx.film') {
        for (const key of ['halation', 'bloom', 'grain']) props[key] = Number(props[key] ?? ctx.registry.effect(effect.type).props[key].default) * amount;
      }
      if (effect.type === 'fx.vignette') props.amount = Number(props.amount ?? ctx.registry.effect(effect.type).props.amount.default) * amount;
      const effectId = freshId(taken, `${preset.name}-${effect.type.slice(3)}`);
      taken[effectId] = true;
      return { id: effectId, type: effect.type, props };
    });
    const path = pointer('compositions', ctx.compId, 'layers', id, 'effects');
    return {
      label: preset.title ?? preset.name,
      ops: layer.effects ? stack.map((effect) => ({ op: 'add', path: `${path}/-`, value: effect })) : [{ op: 'add', path, value: stack }],
      text: `${preset.title} at ${Math.round(amount * 100)}% after the existing effects on ${id}. Measure the same frame again with grade-scopes.`,
    };
  },
};

export const GRADE_TOOLS = [scopes, look];
