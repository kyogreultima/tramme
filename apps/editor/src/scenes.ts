// The film as the studio shows it: its scenes, one after another, with what
// they are called. A composition says where its scenes are by its scene
// markers (a label each); a film built as one composition per scene plays
// them one after another; anything else is one scene, the whole composition.

import { staticValue, type TrammeDoc } from '@tramme/core';

export interface Scene {
  /** the marker's id, the layer's id, or the composition's */
  id: string;
  /** what it is called, without the number put first ("03 · Shaders") */
  name: string;
  from: number;
  to: number;
  /** the composition the scene plays, when it is one (opened in the atelier) */
  comp?: string;
}

/** "03 · Shaders" is called "Shaders": the storyboard numbers the scenes itself */
const bare = (name: string) => name.replace(/^\s*\d{1,3}\s*[·.:-]\s*/, '').trim() || name;

/** a span shorter than this is not a scene (two markers on one moment) */
const MIN = 1e-3;

export function scenesOf(doc: TrammeDoc, compId: string, opening = 'Opening'): Scene[] {
  const c = doc.compositions[compId];
  if (!c) return [];
  const end = c.duration;
  // the scenes the composition names: from each scene marker to the next
  const marks = (c.markers ?? []).filter((m) => m.kind === 'scene' && m.t < end - MIN).sort((a, b) => a.t - b.t);
  if (marks.length) {
    const out: Scene[] = marks[0].t > 0.25 ? [{ id: '~opening', name: opening, from: 0, to: marks[0].t }] : [];
    marks.forEach((m, i) => out.push({ id: m.id, name: bare(m.label || m.id), from: m.t, to: i + 1 < marks.length ? marks[i + 1].t : end }));
    return out.filter((s) => s.to - s.from > MIN);
  }
  // the compositions it plays one after another (a film); one under the whole film is its ground, not a scene
  const comps = c.order
    .map((id) => ({ id, l: c.layers[id] }))
    .filter(({ l }) => l?.type === 'comp' && l.visible !== false)
    .map(({ id, l }) => {
      const comp = String(staticValue(l.props?.comp) ?? '');
      return { id, name: bare(l.name || doc.compositions[comp]?.name || id), from: Math.max(0, l.in ?? 0), to: Math.min(end, l.out ?? end), comp: doc.compositions[comp] ? comp : undefined };
    })
    .filter((s) => s.to - s.from > MIN && s.to - s.from < end * 0.9)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (comps.length >= 2) return comps;
  return [{ id: compId, name: bare(c.name ?? compId), from: 0, to: end }];
}

/**
 * Where a moment of a scene's own composition falls in the film: the scene
 * starts at its layer's in point and runs its composition from `start` at
 * `speed`. Null when the composition has not reached that moment yet (it
 * starts later than the moment). A scene that is no composition is the film.
 */
export function filmTime(doc: TrammeDoc, compId: string, scene: Scene, inner: number): number | null {
  if (!scene.comp) return inner;
  const props = doc.compositions[compId]?.layers[scene.id]?.props;
  const start = Number(staticValue(props?.start) ?? 0) || 0, speed = Number(staticValue(props?.speed) ?? 1) || 1;
  return inner < start ? null : scene.from + (inner - start) / speed;
}

/** the scene playing at t (the last one starting before it, when scenes overlap in a pass) */
export function sceneAt(scenes: Scene[], t: number): Scene | null {
  let found: Scene | null = null;
  for (const s of scenes) if (t >= s.from - MIN && t < s.to) found = s;
  return found ?? (scenes.length && t >= scenes[scenes.length - 1].to ? scenes[scenes.length - 1] : null);
}
