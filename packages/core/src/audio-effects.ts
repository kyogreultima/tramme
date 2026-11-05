import { z } from 'zod';

const bypass = z.boolean().optional();
const gain = z.number().min(-24).max(12);
const frequency = z.number().min(0).max(24000);

/** Fixed Web Audio processors, with every parameter explicit in the document. */
export const AudioEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('eq'), bypass, low: gain, mid: gain, midFreq: z.number().min(200).max(8000), midQ: z.number().min(0.1).max(20), high: gain }),
  z.strictObject({ kind: z.literal('compressor'), bypass, amount: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('reverb'), bypass, wet: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('lowCut'), bypass, frequency }),
  z.strictObject({ kind: z.literal('highCut'), bypass, frequency }),
]);

export type AudioEffect = z.infer<typeof AudioEffectSchema>;
