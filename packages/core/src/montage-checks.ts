// The quality check of a sequence: what the montage operations never produce
// but a hand-written or imported document can hold, and that would play
// wrong. Reported as warnings, never refused by the validation.

import { staticValue } from './props.ts';
import { trackClips } from './montage.ts';
import type { CheckType, QualityIssue } from './checks.ts';

export const sequenceCheck: CheckType = {
  name: 'sequence', title: 'Sequence', description: 'clips overlapping on a track, a sound on a picture track, a link joining a single clip',
  texts: [
    '{a} and {b} overlap on the track {track} by more than a transition: one hides the other',
    '{layer} is a sound on the picture track {track}',
    '{layer} is a picture on the sound track {track}',
    '{layer} is linked to no other clip',
  ],
  run({ comp }) {
    const out: QualityIssue[] = [];
    if (!comp.tracks) return out;
    const half = 0.5 / comp.fps;
    for (const track of comp.tracks) {
      const clips = trackClips(comp, track.id);
      for (const k of clips) {
        const sound = comp.layers[k.id].type === 'audio';
        if (track.kind === 'video' && sound) out.push({ check: 'sequence', severity: 'warning', layers: [k.id], t: k.in, message: `${k.id} is a sound on the picture track ${track.id}: move it to a sound track.`, say: { text: '{layer} is a sound on the picture track {track}', params: { layer: k.id, track: track.id } } });
        if (track.kind === 'audio' && !sound) out.push({ check: 'sequence', severity: 'warning', layers: [k.id], t: k.in, message: `${k.id} is a picture on the sound track ${track.id}: move it to a picture track.`, say: { text: '{layer} is a picture on the sound track {track}', params: { layer: k.id, track: track.id } } });
      }
      for (let i = 1; i < clips.length; i++) {
        const a = clips[i - 1], b = clips[i], overlap = a.out - b.in;
        if (overlap <= half) continue;
        const tr = (comp.layers[b.id].effects ?? []).find((e) => e.type === 'fx.transition'), allowed = Number(staticValue(tr?.props?.duration)) || 0;
        if (overlap > allowed + half) out.push({ check: 'sequence', severity: 'warning', layers: [a.id, b.id], t: b.in, message: `${a.id} and ${b.id} overlap on the track ${track.id} by more than a transition: one hides the other. Trim one, or put a transition on the cut.`, say: { text: '{a} and {b} overlap on the track {track} by more than a transition: one hides the other', params: { a: a.id, b: b.id, track: track.id } } });
      }
    }
    const members = new Map<string, string[]>();
    for (const [id, l] of Object.entries(comp.layers)) if (l.link) members.set(l.link, [...(members.get(l.link) ?? []), id]);
    for (const ids of members.values()) {
      if (ids.length === 1) out.push({ check: 'sequence', severity: 'info', layers: ids, message: `${ids[0]} is linked to no other clip: unlink it.`, say: { text: '{layer} is linked to no other clip', params: { layer: ids[0] } } });
    }
    return out;
  },
};
