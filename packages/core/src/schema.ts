// Structure of the document, checked with zod and exported as JSON Schema
// (schema/tramme-1.schema.json) for tools and for the AI. Property values
// are left open here: their types come from the node schemas in the
// registry and are checked by validate.ts.

import { z } from 'zod';
import { SCHEMA_VERSION } from './types.ts';

const finite = z.number().refine(Number.isFinite, 'finite number expected');
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, 'id: letters, digits, _ and - only');
const prop = z.unknown();

const token = z.strictObject({
  type: z.enum(['color', 'number', 'ease', 'string', 'vec2']),
  value: z.unknown(),
  description: z.string().optional(),
});

const asset = z.strictObject({
  type: z.enum(['image', 'font', 'audio', 'video', 'module', 'json', 'model', 'lut']),
  src: z.string().min(1),
  name: z.string().optional(),
  family: z.string().optional(),
  weight: z.string().optional(),
  style: z.string().optional(),
  box: z.tuple([finite, finite, finite, finite]).optional(),
  hash: z.string().optional(),
  madeBy: z.array(z.string()).optional(),
  proxy: z.string().optional(),
  clean: z.string().optional(),
  interpolated: z.string().optional(),
  bin: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const transform = z.strictObject({
  anchor: prop.optional(), position: prop.optional(), scale: prop.optional(),
  rotation: prop.optional(), opacity: prop.optional(), depth: prop.optional(),
});

const effect = z.strictObject({
  id,
  type: z.string().min(1),
  enabled: z.boolean().optional(),
  props: z.record(z.string(), prop).optional(),
});

const mask = z.strictObject({
  id,
  enabled: z.boolean().optional(),
  props: z.record(z.string(), prop).optional(),
});

const styleUse = z.strictObject({
  style: id,
  at: finite.optional(),
  map: z.record(z.string(), z.string()).optional(),
});

const style = z.strictObject({
  props: z.record(z.string(), prop),
  description: z.string().optional(),
});

const param = z.strictObject({
  type: z.string().min(1),
  targets: z.array(z.string().min(1)),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
});

const vec2 = z.tuple([finite, finite]);
const layout = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('grid'), columns: z.number().int().positive().optional(), spacing: vec2.optional() }),
  z.strictObject({ type: z.literal('list'), direction: z.enum(['horizontal', 'vertical']).optional(), spacing: finite.optional() }),
  z.strictObject({ type: z.literal('circle'), radius: finite.optional(), start: finite.optional(), sweep: finite.optional(), rotate: z.boolean().optional() }),
  z.strictObject({ type: z.literal('path'), path: z.strictObject({ v: z.array(vec2), i: z.array(vec2).optional(), o: z.array(vec2).optional(), closed: z.boolean().optional() }), rotate: z.boolean().optional() }),
  z.strictObject({ type: z.literal('points'), layer: id }),
]);

const distribution = z.strictObject({
  count: z.number().int().nonnegative().optional(),
  rows: id.optional(),
  layout,
  params: z.record(z.string(), z.unknown()).optional(),
  time: z.strictObject({
    mode: z.enum(['rank', 'angle', 'distance', 'noise']),
    amount: prop,
    from: z.enum(['first', 'last']).optional(),
    angle: finite.optional(),
    center: vec2.optional(),
    scale: finite.optional(),
    speed: finite.optional(),
    seed: prop.optional(),
    loop: z.boolean().optional(),
  }).optional(),
});

const layer = z.strictObject({
  type: z.string().min(1),
  track: id.optional(),
  link: id.optional(),
  name: z.string().optional(),
  in: finite.optional(),
  out: finite.optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  clip: id.optional(),
  blend: z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add']).optional(),
  transform: transform.optional(),
  props: z.record(z.string(), prop).optional(),
  effects: z.array(effect).optional(),
  masks: z.array(mask).optional(),
  children: z.array(id).optional(),
  params: z.record(z.string(), prop).optional(),
  overrides: z.record(z.string(), prop).optional(),
  styles: z.array(styleUse).optional(),
  distribute: distribution.optional(),
});

const marker = z.strictObject({
  id,
  t: finite,
  label: z.string().optional(),
  kind: z.string().optional(),
  duration: finite.optional(),
});

const sequenceTrack = z.strictObject({
  id,
  name: z.string().optional(),
  kind: z.enum(['video', 'audio']),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  muted: z.boolean().optional(),
  magnetic: z.boolean().optional(),
  height: finite.optional(),
});

const composition = z.strictObject({
  name: z.string(),
  kind: z.literal('sequence').optional(),
  tracks: z.array(sequenceTrack).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().positive(),
  background: prop.optional(),
  motionBlur: z.strictObject({ samples: prop, shutter: prop }).optional(),
  camera: z.strictObject({ pan: prop.optional(), zoom: prop.optional(), perspective: prop.optional(), focus: prop.optional(), blur: prop.optional() }).optional(),
  markers: z.array(marker).optional(),
  effects: z.array(effect).optional(),
  sound: z.strictObject({ loudness: prop.optional(), room: prop.optional() }).optional(),
  layers: z.record(id, layer),
  order: z.array(id),
  params: z.record(id, param).optional(),
});

export const DocSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal(SCHEMA_VERSION),
  meta: z.looseObject({ title: z.string(), description: z.string().optional() }),
  tokens: z.record(id, token),
  assets: z.record(id, asset),
  styles: z.record(id, style).optional(),
  compositions: z.record(id, composition),
  root: id,
  plugins: z.array(id).optional(),
});

export function documentJsonSchema() {
  return z.toJSONSchema(DocSchema, { target: 'draft-2020-12' });
}
