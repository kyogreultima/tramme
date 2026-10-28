// Pure helpers over the document for the editor: tree order, parents,
// keyframes, time formatting, and the ops of common edits.

import { animatedProps, carriedStart, getAt, keysOf, parentOf, pointer, propPath, rawProp, setKeyframe, setProp, shiftLayerOps, snap, splitLayerOps, staticValue, subtree, trimInOps, type Composition, type TrammeDoc, type Keyframe, type Layer, type Op, type Prop } from '@tramme/core';
import { locale, t } from './i18n/index.ts';

// the time helpers live in core (packages/core/src/timing.ts); the editor keeps importing them from here
export { animatedProps, carriedStart, keysOf, parentOf, propPath, rawProp, shiftLayerOps, shiftProp, snap, splitLayerOps, subtree, trimInOps } from '@tramme/core';

export interface TreeItem { id: string; layer: Layer; depth: number; parent: string | null }

/** layers top first (the order of a layer list), with their depth */
export function flatTree(comp: Composition, collapsed: Set<string> = new Set()): TreeItem[] {
  const out: TreeItem[] = [];
  const walk = (ids: string[], depth: number, parent: string | null) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i], layer = comp.layers[id];
      if (!layer) continue;
      out.push({ id, layer, depth, parent });
      if (layer.children && !collapsed.has(id)) walk(layer.children, depth + 1, id);
    }
  };
  walk(comp.order, 0, null);
  return out;
}

/** the list that holds a layer (the composition's order or a group's children) and its path in the composition */
export function siblingsOf(comp: Composition, id: string): { path: string[]; list: string[] } {
  if (comp.order.includes(id)) return { path: ['order'], list: comp.order };
  const p = parentOf(comp, id);
  if (!p) throw new Error(`${id} is not in the composition's tree`);
  return { path: ['layers', p, 'children'], list: comp.layers[p].children! };
}

/** where the last layer of the composition ends: its duration when a layer runs to the end (no out point) */
export function contentEnd(comp: Composition): number {
  let end = 0;
  for (const id of comp.order) {
    const l = comp.layers[id];
    if (!l) continue;
    if (l.out === undefined) return comp.duration;
    end = Math.max(end, l.out);
  }
  return Math.min(end, comp.duration);
}

/** the composition lengthened to `end` when it is shorter: what is added or stretched past its end is seen and played whole */
export function fitCompOps(doc: TrammeDoc, compId: string, end: number): Op[] {
  if (!(Number.isFinite(end) && end > doc.compositions[compId].duration)) return [];
  return [{ op: 'replace', path: pointer('compositions', compId, 'duration'), value: +end.toFixed(4) }];
}

/** a media layer as long as its file from where it starts, and the composition lengthened to hold it; a file of unknown length leaves both as they are */
export function wholeFile(doc: TrammeDoc, compId: string, layer: Layer, fileDuration: number): { layer: Layer; ops: Op[] } {
  if (!(fileDuration > 0)) return { layer, ops: [] };
  const at = layer.in ?? 0, out = +(at + fileDuration).toFixed(4);
  return { layer: { ...layer, in: at, out }, ops: fitCompOps(doc, compId, out) };
}

/**
 * A media layer's end moved to `at` seconds of its file (the right handle of
 * its cut): at least a frame, at most the file's end; stretched past the
 * composition's end, the composition lengthens with it.
 */
export function cutEndOps(doc: TrammeDoc, compId: string, id: string, at: number, fileDuration: number, fps: number): Op[] {
  const c = doc.compositions[compId], l = c.layers[id];
  const li = l.in ?? 0, lo = l.out ?? c.duration;
  const start = Math.max(0, Number(staticValue(l.props?.start) ?? 0) || 0);
  const out = +(li + Math.max(start + 1 / fps, Math.min(fileDuration, at)) - start).toFixed(4);
  return out === lo ? [] : [{ op: 'add', path: `${pointer('compositions', compId, 'layers', id)}/out`, value: out }, ...fitCompOps(doc, compId, out)];
}

/** the name of the group the sounds are kept in */
export const SOUND_GROUP = 'Sound';

/** the group the sounds are kept in, at the root: named Sound, or holding sounds only */
export const soundGroupOf = (comp: Composition): string | undefined => comp.order.find((id) => {
  const l = comp.layers[id];
  return l?.type === 'group' && (l.name === SOUND_GROUP || (!!l.children?.length && l.children.every((k) => comp.layers[k]?.type === 'audio')));
});

/** the layers of a set not inside another one of the set: those that carry the others along */
export const topLayers = (comp: Composition, ids: string[]) => ids.filter((id) => comp.layers[id] && !ids.some((o) => o !== id && subtree(comp, o).includes(id)));

export const layerName = (id: string, l: Layer) => l.name || id;

/** a text cut to at most max characters, an ellipsis marking the cut */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** a name fit for ids and paths: ascii letters without accents, digits, _ and dashes */
export const slug = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

// ── time ─────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, '0');
/** MM:SS:FF, minutes, seconds and frames */
export function timecode(t: number, fps: number): string {
  const f = Math.round(t * fps), total = Math.floor(f / fps), ff = f - total * fps;
  return `${p2(Math.floor(total / 60))}:${p2(total % 60)}:${p2(ff)}`;
}
/** short label for rulers: '2 s' on whole seconds, '2:15' (seconds:frames) otherwise */
export function rulerLabel(t: number, fps: number): string {
  const f = Math.round(t * fps), s = Math.floor(f / fps), ff = f - s * fps;
  return ff ? `${s}:${p2(ff)}` : `${s} s`;
}

/** parse '8.5' (seconds), '255f' (frames), '08:15' (seconds:frames) or '00:08:15' (minutes:seconds:frames) */
export function parseTime(text: string, fps: number): number | null {
  const s = text.trim().replace(',', '.');
  if (/^\d+f$/i.test(s)) return parseInt(s, 10) / fps;
  if (/^\d+(\.\d+)?s?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] + parts[1] / fps;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / fps;
  return null;
}

export const fmtSeconds = (s: number) => `${locale === 'fr' ? s.toFixed(2).replace('.', ',') : s.toFixed(2)} s`;

/** edit a property at time t: a key at t when it is animated, the static value otherwise */
export function editPropOps(doc: TrammeDoc, compId: string, id: string, name: string, value: unknown, t: number): Op[] {
  const fps = doc.compositions[compId].fps;
  const cur = rawProp(doc, compId, id, name);
  if (keysOf(cur)) return setKeyframe(doc, compId, id, name, snap(t, fps), value);
  return setProp(doc, compId, id, name, value as Prop);
}

const r4 = (x: number) => +x.toFixed(4);

/**
 * A cross-fade between a layer and the closest one under it: opacity keys on
 * both, over the time they share (half of it at most, `d` seconds around its
 * centre). Null when nothing to fade into (no other layer, one that holds the
 * other in time, or an opacity already animated — it is never touched).
 */
export function crossfadeOps(doc: TrammeDoc, compId: string, id: string, d: number): { ops: Op[]; under: string } | null {
  const c = doc.compositions[compId], l = c.layers[id];
  if (!l || l.children) return null;
  const i = c.order.indexOf(id);
  if (i < 0) return null;
  const tin = l.in ?? 0, tout = l.out ?? c.duration;
  // the under layer: the closest later one in order, by shared time (a plain neighbour when none overlaps)
  let under: string | null = null, best = -Infinity;
  for (let j = i + 1; j < c.order.length; j++) {
    const o = c.layers[c.order[j]];
    if (!o || o.children) continue;
    const oin = o.in ?? 0, oout = o.out ?? c.duration;
    const shared = Math.min(tout, oout) - Math.max(tin, oin);
    const score = shared > 0 ? shared : -1 / (1 + Math.min(Math.abs(oout - tin), Math.abs(tout - oin)));
    if (score > best) { best = score; under = c.order[j]; }
  }
  if (!under) return null;
  const o = c.layers[under], oin = o.in ?? 0, oout = o.out ?? c.duration;
  // a static opacity only: an animated one, an expression or a link are never touched
  const topRaw = l.transform?.opacity, underRaw = o.transform?.opacity;
  const topV = staticValue(topRaw), underV = staticValue(underRaw);
  if ((topRaw !== undefined && typeof topV !== 'number') || (underRaw !== undefined && typeof underV !== 'number')) return null;
  const overlap = Math.min(tout, oout) - Math.max(tin, oin);
  const half = 0.5 / c.fps;
  if (overlap <= half) return null;
  const w = Math.min(d * 2, overlap) / 2, m = (Math.max(tin, oin) + Math.min(tout, oout)) / 2;
  const a0 = r4(snap(m - w, c.fps)), a1 = r4(snap(m + w, c.fps));
  const top = typeof topV === 'number' ? topV : 1, low = typeof underV === 'number' ? underV : 1;
  // the one that starts and ends first gives way: it fades out while the other fades in; when one holds the
  // other, either would vanish for the part it plays alone (hidden before the fade in, or after the fade out)
  const topLeaves = tin <= oin && tout <= oout, underLeaves = oin <= tin && oout <= tout;
  if (!topLeaves && !underLeaves) return null;
  const ops: Op[] = [
    transformOp(compId, id, l, 'opacity', { $k: topLeaves ? [{ t: a0, v: top }, { t: a1, v: 0 }] : [{ t: a0, v: 0 }, { t: a1, v: top }] }),
    transformOp(compId, under, o, 'opacity', { $k: topLeaves ? [{ t: a0, v: 0 }, { t: a1, v: low }] : [{ t: a0, v: low }, { t: a1, v: 0 }] }),
  ];
  return { ops, under };
}

/** a transform that follows another layer's, property by property (its depth too when it has one): a map or a cut-out stays exactly over its source */
export function linkedTransform(source: string, l: Layer): Record<string, { $link: string }> {
  return Object.fromEntries(['anchor', 'position', 'scale', 'rotation', 'opacity', ...(l.transform?.depth !== undefined ? ['depth'] : [])].map((k) => [k, { $link: `${source}.transform.${k}` }]));
}

/** sets one transform property of a layer: the transform written whole when the layer has none yet (an add under it would find no path) */
export function transformOp(compId: string, id: string, l: Layer, key: string, value: unknown): Op {
  return l.transform === undefined
    ? { op: 'add', path: pointer('compositions', compId, 'layers', id, 'transform'), value: { [key]: value } }
    : { op: 'add', path: pointer('compositions', compId, 'layers', id, 'transform', key), value };
}

/** an asset a tool made beside a media (a depth map, a cut-out mask or picture): never a default pick; its file says so even when its id was cut to 64 characters */
export const isToolAsset = (id: string, a?: { src?: string }): boolean =>
  /^(depth|cutout)-/.test(id) || /-cut$/.test(id) || /^assets\/(depth|cutout)\//.test(a?.src ?? '');

/** the prop that holds a media layer's own asset */
const MEDIA_PROP: Record<string, string> = { video: 'video', audio: 'audio', image: 'image', 'model.3d': 'source' };

/** the transcript asset the tools read: the edit's one when there is one */
export function transcriptOfDoc(doc: TrammeDoc): string | undefined {
  const ids = Object.keys(doc.assets).filter((id) => doc.assets[id].type === 'json' && id.startsWith('transcription-'));
  return ids.find((id) => id.endsWith('-edit')) ?? ids[0];
}

/** the media assets of the selected layers (the layer's own picture, video, sound or model): a selection is a choice, a tool's own file included */
export function mediaAssetsOf(doc: TrammeDoc, compId: string, selection: readonly string[], kinds: readonly string[]): string[] {
  const c = doc.compositions[compId], out: string[] = [];
  for (const id of selection) {
    const l = c.layers[id], prop = l && MEDIA_PROP[l.type];
    if (!prop) continue;
    const a = staticValue(l.props?.[prop]);
    if (typeof a === 'string' && doc.assets[a] && kinds.includes(doc.assets[a].type) && !out.includes(a)) out.push(a);
  }
  return out;
}

/** a fresh id: base, base2, base3... */
export function freshId(taken: Record<string, unknown>, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, '') || 'layer';
  if (!taken[clean]) return clean;
  for (let i = 2; ; i++) if (!taken[`${clean}${i}`]) return `${clean}${i}`;
}

/** a short description of an op, for proposal cards */
export function describeOp(doc: TrammeDoc, op: Op): string {
  const parts = op.path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const short = (v: unknown) => { const s = JSON.stringify(v); return s.length > 48 ? s.slice(0, 46) + '…' : s; };
  if (parts[0] === 'compositions' && parts[2] === 'layers' && parts[3]) {
    const l = doc.compositions[parts[1]]?.layers[parts[3]];
    const name = l?.name || parts[3];
    const rest = parts.slice(4).join('.');
    if (op.op === 'add' && parts.length === 4) return t('editor.newLayerNameType', { name: (op.value as Layer)?.name || parts[3], type: (op.value as Layer)?.type });
    if (op.op === 'remove' && parts.length === 4) return t('editor.deleteName', { name });
    const v = 'value' in op ? ` = ${short(op.value)}` : '';
    return `${name} · ${rest || t('editor.layer')}${v}`;
  }
  if (parts[0] === 'compositions' && parts[2] === 'order') return t('editor.layerOrder');
  // the files and plugins of the project: named, their JSON is no use to the reader
  if (parts[0] === 'assets' && parts[1]) {
    const name = (parts.length === 2 && op.op === 'add' ? (op.value as { name?: string })?.name : doc.assets[parts[1]]?.name) || parts[1];
    return parts.length > 2 || op.op === 'replace' ? t('editor.fileChanged', { name }) : op.op === 'add' ? t('editor.fileAdded', { name }) : t('editor.fileRemoved', { name });
  }
  if (parts[0] === 'plugins') {
    // the list once the op is applied: the whole list set, or one id added or removed
    const cur = doc.plugins ?? [], i = parts[1] === '-' ? cur.length : Number(parts[1]), value = 'value' in op ? op.value : undefined;
    const ids = parts.length === 1 ? (op.op === 'remove' ? [] : (value as string[]) ?? [])
      : op.op === 'remove' ? cur.filter((_, j) => j !== i)
      : op.op === 'add' ? [...cur.slice(0, i), String(value), ...cur.slice(i)]
      : cur.map((id, j) => (j === i ? String(value) : id));
    return ids.length ? t('editor.pluginsOn', { names: ids.map((id) => doc.assets[id]?.name || id).join(', ') }) : t('editor.noPlugin');
  }
  const v = 'value' in op ? ` = ${short(op.value)}` : '';
  return `${parts.join('.')}${v}`;
}

// ── generic edits by JSON Pointer (layer props, composition settings, effects) ──
/** set a value at path, creating the missing parent objects */
export function setAtOps(doc: TrammeDoc, path: string, value: unknown): Op[] {
  const parts = path.split('/').slice(1);
  for (let i = 1; i < parts.length; i++) {
    const parent = '/' + parts.slice(0, i).join('/');
    if (getAt(doc, parent) === undefined) {
      // build the missing branch in one op
      let v: unknown = value;
      for (let j = parts.length - 1; j >= i; j--) v = { [parts[j].replace(/~1/g, '/').replace(/~0/g, '~')]: v };
      return [{ op: 'add', path: parent, value: v }];
    }
  }
  return [{ op: 'add', path, value }];
}

const isWrapped = (p: unknown): p is { $v: unknown; $mod?: unknown[] } => !!p && typeof p === 'object' && !Array.isArray(p) && '$v' in p;
const modsKept = (p: unknown) => (p && typeof p === 'object' && Array.isArray((p as { $mod?: unknown[] }).$mod) ? { $mod: (p as { $mod: unknown[] }).$mod } : {});

/** a key at time t (replacing the one within half a frame), making the property animated if it was not */
export function keyAtOps(doc: TrammeDoc, path: string, t: number, v: unknown, fps: number): Op[] {
  const cur = getAt(doc, path) as Prop | undefined;
  const keys = keysOf(cur);
  if (!keys) return setAtOps(doc, path, { $k: [{ t, v }], ...modsKept(cur) });
  const half = 0.5 / fps;
  const same = keys.findIndex((k) => Math.abs(k.t - t) < half);
  if (same >= 0) return [{ op: 'replace', path: `${path}/$k/${same}`, value: { ...keys[same], v } }];
  const at = keys.findIndex((k) => k.t > t);
  return [{ op: 'add', path: `${path}/$k/${at < 0 ? '-' : at}`, value: { t, v } }];
}

/** edit at time t: a key when animated, the static value otherwise (expressions and links are replaced) */
export function editAtOps(doc: TrammeDoc, path: string, v: unknown, t: number, fps: number): Op[] {
  const cur = getAt(doc, path) as Prop | undefined;
  if (keysOf(cur)) return keyAtOps(doc, path, snap(t, fps), v, fps);
  if (isWrapped(cur)) return [{ op: 'replace', path: `${path}/$v`, value: v }];
  return setAtOps(doc, path, v);
}

/** a static value, keeping the modifier stack */
export function fixedOps(doc: TrammeDoc, path: string, v: unknown): Op[] {
  const kept = modsKept(getAt(doc, path));
  return setAtOps(doc, path, '$mod' in kept ? { $v: v, ...kept } : v);
}

/** add a modifier at the end of the property's stack */
export function addModifierOps(doc: TrammeDoc, path: string, mod: Record<string, unknown>, current: unknown): Op[] {
  const cur = getAt(doc, path);
  if (cur === undefined || cur === null || typeof cur !== 'object' || Array.isArray(cur)) return setAtOps(doc, path, { $v: cur ?? current, $mod: [mod] });
  if (Array.isArray((cur as { $mod?: unknown }).$mod)) return [{ op: 'add', path: `${path}/$mod/-`, value: mod }];
  return [{ op: 'add', path: `${path}/$mod`, value: [mod] }];
}

/** remove modifier i; a { $v } left without modifiers goes back to the raw value */
export function removeModifierOps(doc: TrammeDoc, path: string, i: number): Op[] {
  const cur = getAt(doc, path) as { $v?: unknown; $mod: unknown[] };
  if (cur.$mod.length > 1) return [{ op: 'remove', path: `${path}/$mod/${i}` }];
  if (isWrapped(cur)) return [{ op: 'replace', path, value: cur.$v }];
  return [{ op: 'remove', path: `${path}/$mod` }];
}

/** remove one key; the last key leaves its value as a static property */
export function removeKeyOps(doc: TrammeDoc, path: string, index: number): Op[] {
  const keys = keysOf(getAt(doc, path))!;
  if (keys.length <= 1) return [{ op: 'replace', path, value: keys[0].v }];
  return [{ op: 'remove', path: `${path}/$k/${index}` }];
}

export function keyIndexAt(keys: Keyframe[] | null, t: number, fps: number): number {
  if (!keys) return -1;
  const half = 0.5 / fps;
  return keys.findIndex((k) => Math.abs(k.t - t) < half);
}

// ── relative dates ───────────────────────────────────────────
const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
export function ago(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s > -45) return t('editor.justNow');
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (s > -7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ── drawings ─────────────────────────────────────────────────
const natural = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
/** folder of an asset src ('assets/oeil/01.png' gives 'assets/oeil') */
export const folderOf = (src: string) => (src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '');
/** image assets of a folder, in natural name order (2 before 10) */
export function imagesIn(doc: TrammeDoc, folder: string): string[] {
  return Object.entries(doc.assets).filter(([, a]) => a.type === 'image' && folderOf(a.src) === folder)
    .sort((a, b) => natural.compare(a[1].src, b[1].src)).map(([id]) => id);
}
/** the shared name of numbered files ('oeil_01.png', 'oeil_02.png' give 'oeil'), or null */
export function commonStem(names: string[]): string | null {
  const stems = names.map((n) => n.replace(/\.[^.]+$/, '').replace(/[-_ .]*\d+$/, '').toLowerCase());
  return stems.length > 1 && stems[0] && stems.every((s) => s === stems[0]) ? stems[0] : null;
}
