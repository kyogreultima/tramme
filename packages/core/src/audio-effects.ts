import { z } from 'zod';

const bypass = z.boolean().optional();
const gain = z.number().min(-24).max(12);
const frequency = z.number().min(0).max(24000);
export const DELAY_NOTES = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'] as const;
// Three milliseconds clear Web Audio's 128-frame feedback minimum at the mixer rate.
export const DelayTimeSchema = z.union([z.number().min(3).max(16000), z.enum(DELAY_NOTES)]);
export type DelayTime = z.infer<typeof DelayTimeSchema>;

/** Fixed Web Audio processors, with every parameter explicit in the document. */
export const AudioEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('eq'), bypass, low: gain, mid: gain, midFreq: z.number().min(200).max(8000), midQ: z.number().min(0.1).max(20), high: gain }),
  z.strictObject({ kind: z.literal('compressor'), bypass, amount: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('reverb'), bypass, wet: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('lowCut'), bypass, frequency }),
  z.strictObject({ kind: z.literal('highCut'), bypass, frequency }),
  z.strictObject({ kind: z.literal('delay'), bypass, time: DelayTimeSchema, feedback: z.number().min(0).max(0.95), wet: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('distortion'), bypass, drive: z.number().min(0.1).max(20), tone: frequency, wet: z.number().min(0).max(1) }),
]);

export type AudioEffect = z.infer<typeof AudioEffectSchema>;

/** Quarter notes are one beat; a note delay never chooses a tempo for a film. */
export function delayTimeSeconds(time: DelayTime, tempo?: number | null): number {
  const value = DelayTimeSchema.parse(time);
  if (typeof value === 'number') return value / 1000;
  if (typeof tempo !== 'number' || !Number.isFinite(tempo) || tempo < 20 || tempo > 300) throw new Error('set a composition tempo between 20 and 300 BPM for a note delay');
  return 240 / (tempo * Number(value.slice(2)));
}
