// A fast first voice-over: a short list of voices chosen to differ (a warm
// one, a deep narrator, a lively one, a soft one, a clear one) for the
// provider that speaks, kept as data in the Sound settings and checked
// against what the provider offers now; a sample of each in the film's
// language, made once and kept in the sound library; and the first take laid
// on a new voice track at the playhead, the music ducked under it and the
// voice cleanup chain on it, in one step of the history.

import { addTrackOps, applyOps, type Op, type TrammeDoc } from '@tramme/core';
import type { Voice } from '@tramme/api';
import { EFFECT_PRESETS } from './effect-chain.ts';
import { appendTrackEffectsOps, duckTrackOps } from './ui/timeline/mixer.ts';
import { takeOps, type Take } from './voiceover.ts';

export type Tone = 'warm' | 'narrator' | 'lively' | 'soft' | 'clear';
export const TONES: Tone[] = ['warm', 'narrator', 'lively', 'soft', 'clear'];

/** a voice of the short list: what generate takes as voice, its name, the tone it is there for (none for one filling a gap) */
export interface ShortVoice { id: string; name: string; tone?: Tone }

/** the short list each provider starts with: voices of its fixed set or of every account's premade ones */
export const DEFAULT_SHORTLIST: Record<string, ShortVoice[]> = {
  elevenlabs: [
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', tone: 'warm' }, { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', tone: 'narrator' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', tone: 'lively' }, { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', tone: 'soft' }, { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', tone: 'clear' },
  ],
  openai: [
    { id: 'coral', name: 'Coral', tone: 'warm' }, { id: 'onyx', name: 'Onyx', tone: 'narrator' }, { id: 'nova', name: 'Nova', tone: 'lively' },
    { id: 'shimmer', name: 'Shimmer', tone: 'soft' }, { id: 'alloy', name: 'Alloy', tone: 'clear' },
  ],
  gemini: [
    { id: 'Sulafat', name: 'Sulafat', tone: 'warm' }, { id: 'Charon', name: 'Charon', tone: 'narrator' }, { id: 'Sadachbia', name: 'Sadachbia', tone: 'lively' },
    { id: 'Achernar', name: 'Achernar', tone: 'soft' }, { id: 'Iapetus', name: 'Iapetus', tone: 'clear' },
  ],
};

/** how many voices the list offers */
export const SHORT = 5;

/**
 * The short list for a provider: the one kept in the settings, else its
 * default; when the provider's voices are known, only those it still offers,
 * the gaps filled with others of its list. Never more than SHORT.
 */
export function shortlistFor(provider: string, kept: Record<string, ShortVoice[]> | undefined, available: Pick<Voice, 'id' | 'name'>[] | null): ShortVoice[] {
  const wanted = kept?.[provider]?.length ? kept[provider] : DEFAULT_SHORTLIST[provider] ?? [];
  if (!available) return wanted.slice(0, SHORT);
  const ids = new Set(available.map((v) => v.id));
  const out = wanted.filter((v) => ids.has(v.id)).slice(0, SHORT);
  for (const v of available) {
    if (out.length >= SHORT) break;
    if (!out.some((o) => o.id === v.id)) out.push({ id: v.id, name: v.name });
  }
  return out;
}

/** the list kept in the settings with a voice added (first, once: the last of a full list leaves) or removed */
export function withVoice(kept: Record<string, ShortVoice[]> | undefined, provider: string, voice: ShortVoice): Record<string, ShortVoice[]> {
  const list = kept?.[provider]?.length ? kept[provider] : DEFAULT_SHORTLIST[provider] ?? [];
  return { ...kept, [provider]: [voice, ...list.filter((v) => v.id !== voice.id)].slice(0, SHORT) };
}
export function withoutVoice(kept: Record<string, ShortVoice[]> | undefined, provider: string, id: string): Record<string, ShortVoice[]> {
  const list = kept?.[provider]?.length ? kept[provider] : DEFAULT_SHORTLIST[provider] ?? [];
  return { ...kept, [provider]: list.filter((v) => v.id !== id) };
}

/** the sample's file in the sound library: one per provider, voice and language */
export const sampleName = (provider: string, id: string, lang: string) => `voice-sample-${provider}-${id.replace(/[^A-Za-z0-9_-]+/g, '-')}-${lang}.mp3`.toLowerCase();

/** the tracks a voice-over should duck: the sound tracks that hold music (or any sound that is no voice), never a bus */
export function musicTracks(doc: TrammeDoc, compId: string): string[] {
  const c = doc.compositions[compId];
  return (c.tracks ?? []).filter((tr) => tr.kind === 'audio' && !tr.bus && Object.values(c.layers).some((l) => l.track === tr.id && (l.type === 'audio' || l.type === 'video') && (l.props?.role as string | undefined) !== 'voice')).map((tr) => tr.id);
}

/**
 * The first take on a new voice track at `at`: the asset, the track, the clip,
 * the voice cleanup chain on the track and every music track ducked under it.
 * Null when the take cannot be placed.
 */
export function firstTakeOps(doc: TrammeDoc, compId: string, assetId: string, take: Take, at: number): { ops: Op[]; layer: string; track: string } | null {
  const ducked = musicTracks(doc, compId);
  const track = addTrackOps(doc.compositions[compId], compId, 'audio');
  let d = applyOps(doc, track.ops).doc;
  const placed = takeOps(d, compId, assetId, take, at, track.id);
  if (!placed) return null;
  d = applyOps(d, placed.ops).doc;
  const chain = appendTrackEffectsOps(d.compositions[compId], compId, track.id, EFFECT_PRESETS['voice-cleanup']);
  d = applyOps(d, chain).doc;
  const ducks: Op[] = [];
  for (const id of ducked) {
    const ops = duckTrackOps(d.compositions[compId], compId, id, track.id);
    d = applyOps(d, ops).doc;
    ducks.push(...ops);
  }
  return { ops: [...track.ops, ...placed.ops, ...chain, ...ducks], layer: placed.id, track: track.id };
}
