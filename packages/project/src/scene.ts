// A web scene is one project folder with a seekable HTML entry and typed
// parameters. The manifest is data only; its scripts are never run here.
import { z } from 'zod';

const parameter = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('number'), default: z.number().finite() }),
  z.strictObject({ type: z.literal('string'), default: z.string().max(4096) }),
  z.strictObject({ type: z.literal('boolean'), default: z.boolean() }),
  z.strictObject({ type: z.literal('color'), default: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
]);

export const SceneSchema = z.strictObject({
  duration: z.number().positive().finite().max(24 * 60 * 60),
  size: z.tuple([z.number().int().min(1).max(8192), z.number().int().min(1).max(8192)]),
  entry: z.string().min(1).max(200),
  parameters: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/), parameter),
});
export type Scene = z.infer<typeof SceneSchema>;
export const sceneJsonSchema = () => z.toJSONSchema(SceneSchema, { target: 'draft-2020-12' });
