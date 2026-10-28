// Left column: the layer tree, the assets and the design tokens.

import { signal } from '@preact/signals';
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { addLayer, applyOps, layerActive, moveLayer, pointer, propKind, removeLayer, staticValue, type Asset, type KeyframedProp, type Prop, type StaticProp, type Vec2, type TrammeDoc, type Layer, type NodeType, type Op, type PresetType, type TokenType } from '@tramme/core';
import { clickSelect, comp, commit, foldAll, S, select, toggleFold, viewDoc, toast, uiTime } from '../state.ts';
import { fitCompOps, flatTree, freshId, layerName, shiftProp, parentOf, SOUND_GROUP, soundGroupOf, subtree, topLayers, commonStem, folderOf, imagesIn, wholeFile } from '../model.ts';
import { ColorField, longPress, openMenu, Seg, Swatch, TextInput, resolveColor, type MenuItem } from './controls.tsx';
import { Icon, kindColor, kindIcon } from './icons.tsx';
import { ASSET_MIME, chosenAsset, COMP_MIME, sourceOpen } from './timeline/assets-drag.ts';
import { newSequenceFromAsset } from './timeline/place.ts';
import { MediaBar, naming, useSpoken } from './MediaBar.tsx';
import { relinkFiles } from '../relink-run.ts';
import { clipFromRange } from '../subclips.ts';
import { binsOf, filterAssets, removeTagOps, setBinOps, type AssetFilter } from '../bins.ts';
import { preview } from '../preview.ts';
import { mediaDuration } from '../perception.ts';
import { manifestOf } from '@tramme/project';
import { copiesIn } from '../installed.ts';
import { packBySrc, packIdOf, packUpdates, shippedPacks, type PackEntry, type PackUpdate } from '../packs.ts';
import { api } from '../api.ts';
import { fromLottie } from '@tramme/interop';
import { mediaOf, TranscribeButton, transcribeItem } from './Transcribe.tsx';
import { safeName, takenPaths, upload } from '../files.ts';
import { askUser } from '../confirm.ts';
import { assetWithHash, contentHash } from '../hash.ts';
import { m, t, tr } from '../i18n/index.ts';
import { listCommands } from '../ai/commands.ts';
import { runCommand } from '../ai/conversation.ts';

const tab = signal<'layers' | 'assets' | 'tokens'>('layers');

// ── new layers ───────────────────────────────────────────────
function firstToken(doc: TrammeDoc, type: TokenType) {
  const e = Object.entries(doc.tokens).find(([, t]) => t.type === type);
  return e ? `@${e[0]}` : null;
}
function firstAsset(doc: TrammeDoc, type: string) {
  return Object.entries(doc.assets).find(([, a]) => a.type === type)?.[0] ?? null;
}

/** a new layer of a node type, centred, with sensible defaults */
export function newLayer(doc: TrammeDoc, compId: string, node: NodeType, extra: Partial<Layer> = {}): Layer {
  const c = doc.compositions[compId];
  const center: [number, number] = [c.width / 2, c.height / 2];
  const u = Math.min(c.width, c.height);
  const color = firstToken(doc, 'color') ?? '#2EC4B6';
  const props: Record<string, unknown> = {};
  switch (node.type) {
    case 'shape.rect': Object.assign(props, { size: [Math.round(u * 0.4), Math.round(u * 0.4)], fill: color }); break;
    case 'shape.ellipse': Object.assign(props, { size: [Math.round(u * 0.4), Math.round(u * 0.4)], fill: color }); break;
    case 'shape.path': Object.assign(props, { fill: color }); break;
    case 'text': case 'text.counter': {
      const font = firstAsset(doc, 'font');
      Object.assign(props, { size: Math.round(u * 0.09), weight: 700, align: 'center', color: '#FFFFFF', ...(font ? { font } : {}) });
      if (node.type === 'text') props.text = t('panel.text');
      break;
    }
    case 'image': { const img = firstAsset(doc, 'image'); Object.assign(props, { size: [Math.round(u * 0.6), Math.round(u * 0.6)], fit: 'contain', ...(img ? { image: img } : {}) }); break; }
    case 'audio': { const a = firstAsset(doc, 'audio'); if (a) props.audio = a; break; }
    case 'video': { const v = firstAsset(doc, 'video'); Object.assign(props, { size: [c.width, c.height], fit: 'cover', ...(v ? { video: v } : {}) }); break; }
    case 'model.3d': { const m3 = firstAsset(doc, 'model'); Object.assign(props, { height: Math.round(u * 0.6), ...(m3 ? { source: m3 } : {}) }); break; }
  }
  const positioned = node.type !== 'group' && node.type !== 'code' && node.type !== 'audio';
  return {
    type: node.type, name: t(node.title),
    ...(positioned ? { transform: { position: center } } : {}),
    ...(node.container ? { children: [] } : {}),
    ...(Object.keys(props).length ? { props } : {}),
    ...extra,
  };
}

/** a preset as a layer of the open composition: centred when it has no position */
function presetLayer(p: PresetType): Layer {
  const c = S.doc.peek().compositions[S.compId.peek()];
  const tr0 = p.layer!.transform ?? {};
  return { ...structuredClone(p.layer!), name: tr(p.title ?? p.name), transform: { ...structuredClone(tr0), position: tr0.position ?? [c.width / 2, c.height / 2] } } as Layer;
}

/** an effect-stack preset: its effects pushed onto every selected layer at once */
function applyStack(p: PresetType) {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const sel = S.selection.peek().filter((id) => c.layers[id]);
  if (!sel.length) { toast(t('panel.stackNeedsSelection')); return; }
  const ops = sel.flatMap((id) => {
    const effects = c.layers[id].effects ?? [];
    const stack = p.effects!.map((e, i) => ({ id: freshId(Object.fromEntries(effects.map((x) => [x.id, 1])), `${e.type.split('.').pop()}-${i + 1}`), type: e.type, ...(e.props ? { props: structuredClone(e.props) } : {}) }));
    return effects.length
      ? [{ op: 'add' as const, path: `${pointer('compositions', compId, 'layers', id)}/effects/-`, value: stack }]
      : [{ op: 'add' as const, path: `${pointer('compositions', compId, 'layers', id)}/effects`, value: stack }];
  });
  commit(t('panel.stackApplied', { name: tr(p.title ?? p.name) }), ops);
}

/** add a layer above the selection (same parent), or at the top of the root; extra: what changes with it, in the same undo step */
export function insertLayer(layer: Layer, base?: string, extra: Op[] = []) {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const id = freshId(c.layers, base ?? layer.type.split('.').pop()!);
  const sel = S.selection.peek()[0];
  let place: { parent?: string; index?: number } = {};
  if (sel && c.layers[sel]) {
    if (c.layers[sel].children && S.registry.peek().node(c.layers[sel].type).container) place = { parent: sel };
    else {
      const parent = parentOf(c, sel) ?? undefined;
      const arr = parent ? c.layers[parent].children! : c.order;
      place = { parent, index: arr.indexOf(sel) + 1 };
    }
  }
  if (commit(t('panel.newLayerName', { name: layer.name ?? id }), [...addLayer(doc, compId, id, layer, place), ...extra])) select([id]);
}

/**
 * A layer of an asset of the project. A video plays whole: its layer is as
 * long as its file, and the composition lengthens to hold it (one undo step).
 */
export async function layerFromAsset(id: string, a: Asset) {
  const built = await assetLayer(id, a);
  if (built) insertLayer(built.layer, id, built.ops);
}

/** the layer an asset becomes, and what must change with it (a video's composition lengthened to hold it); null for an asset that is no layer */
export async function assetLayer(id: string, a: Asset): Promise<{ layer: Layer; ops: Op[] } | null> {
  const doc = S.doc.peek(), compId = S.compId.peek(), reg = S.registry.peek();
  // a sub-clip plays its media from the start of its range, as long as the range: nothing to read in the file
  if (a.of !== undefined && a.range && (a.type === 'video' || a.type === 'audio')) {
    const l = newLayer(doc, compId, reg.node(a.type), { name: a.name || id });
    const layer = clipFromRange({ ...l, props: { ...l.props, [a.type]: a.of } }, a.range[0], a.range[1]);
    return { layer, ops: fitCompOps(doc, compId, layer.out!) };
  }
  if (a.type === 'image') return { layer: newLayer(doc, compId, reg.node('image'), { name: a.name || id, props: { image: id, size: [600, 600], fit: 'contain' } }), ops: [] };
  if (a.type === 'audio') return { layer: newLayer(doc, compId, reg.node('audio'), { name: a.name || id, props: { audio: id } }), ops: [] };
  if (a.type === 'video') {
    const length = await mediaDuration(new URL(a.src, new URL(S.docUrl.peek(), location.href)).href);
    const l = newLayer(S.doc.peek(), compId, reg.node('video'), { name: a.name || id });
    return wholeFile(S.doc.peek(), compId, { ...l, props: { ...l.props, video: id } }, length);
  }
  if (a.type === 'model' && reg.hasNode('model.3d')) { const l = newLayer(doc, compId, reg.node('model.3d'), { name: a.name || id }); return { layer: { ...l, props: { ...l.props, source: id } }, ops: [] }; }
  return null;
}

export function addLayerMenu(e: MouseEvent | DOMRect) {
  const reg = S.registry.peek();
  const groups = new Map<string, NodeType[]>();
  for (const n of reg.listNodes()) { if (!groups.has(n.category)) groups.set(n.category, []); groups.get(n.category)!.push(n); }
  const items: MenuItem[] = [];
  for (const [cat, nodes] of groups) {
    items.push({ section: t(cat) });
    for (const n of nodes) items.push({ label: t(n.title), icon: kindIcon(n.type), onClick: () => insertLayer(newLayer(S.doc.peek(), S.compId.peek(), n)) });
  }
  // ready-made layers: the editor's and the project's plugins'
  const presets = reg.listPresets().filter(({ preset }) => (preset.layer ? reg.hasNode(preset.layer.type) : !!preset.effects?.length));
  const sections = new Map<string, typeof presets>();
  for (const p of presets) { const cat = p.preset.category ?? m('panel.presets'); if (!sections.has(cat)) sections.set(cat, []); sections.get(cat)!.push(p); }
  for (const [cat, list] of sections) {
    items.push({ section: t(cat) });
    for (const { preset } of list) items.push(preset.effects
      ? { label: tr(preset.title ?? preset.name), icon: 'effects' as const, onClick: () => applyStack(preset) }
      : { label: tr(preset.title ?? preset.name), icon: kindIcon(preset.layer!.type), onClick: () => insertLayer(presetLayer(preset), preset.name) });
  }
  openMenu(e as MouseEvent, items);
}

export function deleteSelection() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const sel = S.selection.peek().filter((id) => c.layers[id]);
  if (!sel.length) return;
  // a layer inside another selected one goes with its parent
  const roots = topLayers(c, sel);
  const ops: Op[] = [];
  let cur = doc;
  for (const id of roots) {
    const o = removeLayer(cur, compId, id);
    ops.push(...o);
    cur = applyOps(cur, o).doc;
  }
  if (commit(roots.length > 1 ? t('panel.deleteNLayers', { n: roots.length }) : t('panel.deleteName', { name: layerName(roots[0], c.layers[roots[0]]) }), ops)) select([]);
}

export function duplicateSelection() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const id = S.selection.peek()[0];
  if (!id || !c.layers[id]) return;
  const taken: Record<string, unknown> = { ...c.layers };
  const mapping = new Map<string, string>();
  for (const lid of subtree(c, id)) { const nid = freshId(taken, lid); taken[nid] = 1; mapping.set(lid, nid); }
  const parent = parentOf(c, id) ?? undefined;
  const arr = parent ? c.layers[parent].children! : c.order;
  const ops: Op[] = [];
  for (const [lid, nid] of mapping) {
    const l = structuredClone(c.layers[lid]);
    if (l.children) l.children = l.children.map((ch) => mapping.get(ch)!);
    if (l.clip && mapping.has(l.clip)) l.clip = mapping.get(l.clip);
    if (lid === id) l.name = t('panel.nameCopy', { name: layerName(lid, c.layers[lid]) });
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', nid), value: l });
  }
  const container = parent ? pointer('compositions', compId, 'layers', parent, 'children') : pointer('compositions', compId, 'order');
  ops.push({ op: 'add', path: `${container}/${arr.indexOf(id) + 1}`, value: mapping.get(id)! });
  if (commit(t('common.duplicate'), ops)) select([mapping.get(id)!]);
}

/** the sounds at the root of the stack go into the Sound group, made at the bottom when there is none */
export function groupSounds() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const loose = c.order.filter((id) => c.layers[id]?.type === 'audio');
  if (!loose.length) return;
  const ops: Op[] = [];
  let cur = doc, group = soundGroupOf(c);
  if (!group) {
    group = freshId(c.layers, 'sound');
    const o = addLayer(cur, compId, group, { type: 'group', name: SOUND_GROUP, children: [] }, { index: 0 });
    ops.push(...o); cur = applyOps(cur, o).doc;
  }
  for (const id of loose) { const o = moveLayer(cur, compId, id, { parent: group }); ops.push(...o); cur = applyOps(cur, o).doc; }
  if (commit(t('panel.groupSoundsN', { n: loose.length }), ops)) S.collapsed.value = new Set([...S.collapsed.peek(), group]);
}

/** move the selected layers (same parent) into a new composition, replaced by one comp layer */
export function precompose() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const sel = S.selection.peek().filter((id) => c.layers[id]);
  if (!sel.length) return;
  const parent = parentOf(c, sel[0]) ?? undefined;
  if (sel.some((id) => (parentOf(c, id) ?? undefined) !== parent)) { toast(t('panel.precomposeChooseLayersFrom'), 'error'); return; }
  const container = parent ? c.layers[parent].children! : c.order;
  const ordered = container.filter((id) => sel.includes(id));
  const moved = new Set(ordered.flatMap((id) => subtree(c, id)));
  const newId = freshId(doc.compositions, 'precomp');
  const layers: Record<string, Layer> = {};
  for (const id of moved) {
    const l = structuredClone(c.layers[id]);
    if (l.clip && !moved.has(l.clip)) delete l.clip;
    layers[id] = l;
  }
  const ops: Op[] = [{ op: 'add', path: pointer('compositions', newId), value: { name: t('panel.precompN', { n: Object.keys(doc.compositions).length }), width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: null, layers, order: ordered } }];
  let cur = applyOps(doc, ops).doc;
  for (const id of ordered) { const o = removeLayer(cur, compId, id); ops.push(...o); cur = applyOps(cur, o).doc; }
  const at = Math.min(...ordered.map((id) => container.indexOf(id)));
  const layerId = freshId(cur.compositions[compId].layers, 'precomp');
  ops.push(...addLayer(cur, compId, layerId, { type: 'comp', name: t('panel.precompN', { n: Object.keys(doc.compositions).length }), transform: { position: [c.width / 2, c.height / 2] }, props: { comp: newId } }, { parent, index: at }));
  if (commit(t('panel.precompose'), ops)) select([layerId]);
}

const shiftProps = <T extends Record<string, Prop> | undefined>(o: T, dt: number): T => (o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shiftProp(v, dt)])) as T);

/**
 * The reverse of precompose: the selected comp layer becomes a group holding
 * the layers of its composition, in place and on the same frame (the group
 * takes the layer's transform, its anchor moved by half the composition, as
 * a composition is drawn centred on its layer). Its time must run as the
 * parent's (no speed, loop or override); the composition is removed when no
 * other layer shows it. Expressions are kept as they are.
 */
export function decompose() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const id = S.selection.peek()[0], l = c.layers[id];
  const innerId = l?.type === 'comp' && typeof l.props?.comp === 'string' ? l.props.comp as string : null;
  const inner = innerId ? doc.compositions[innerId] : null;
  if (!l || !innerId || !inner) return;
  const p = l.props ?? {}, start = p.start ?? 0, anchor = l.transform?.anchor;
  if ((p.remap ?? null) !== null || (p.loop ?? false) !== false || (p.speed ?? 1) !== 1 || typeof start !== 'number') { toast(t('panel.decomposeTimed'), 'error'); return; }
  if (anchor !== undefined && (propKind(anchor) === 'expression' || propKind(anchor) === 'link')) { toast(t('panel.decomposeAnchor'), 'error'); return; }
  // the composition's time 0 falls at the layer's in point, less its start
  const dt = (l.in ?? 0) - start;
  const plus = (v: unknown): Vec2 => { const [x, y] = (v as Vec2 | undefined) ?? [0, 0]; return [x + inner.width / 2, y + inner.height / 2]; };
  const moved = anchor === undefined ? plus(undefined)
    : propKind(anchor) === 'keyframes' ? { ...(anchor as KeyframedProp<Vec2>), $k: (anchor as KeyframedProp<Vec2>).$k.map((k) => ({ ...k, v: plus(k.v) })) }
    : staticValue(anchor) !== anchor ? { ...(anchor as StaticProp<Vec2>), $v: plus(staticValue(anchor)) } : plus(anchor);
  // the ids of the composition, kept unless the parent already has them
  const taken: Record<string, unknown> = { ...c.layers }, ids = new Map<string, string>();
  for (const lid of Object.keys(inner.layers)) { const nid = freshId(taken, lid); taken[nid] = 1; ids.set(lid, nid); }
  const ops: Op[] = [];
  for (const [lid, nid] of ids) {
    const x = structuredClone(inner.layers[lid]);
    if (x.children) x.children = x.children.map((ch) => ids.get(ch)!);
    if (x.clip) x.clip = ids.get(x.clip);
    if (dt) {
      x.in = Math.max(0, (x.in ?? 0) + dt);
      x.out = (x.out ?? inner.duration) + dt;
      x.transform = shiftProps(x.transform as Record<string, Prop> | undefined, dt) as Layer['transform'];
      x.props = shiftProps(x.props, dt);
      x.effects = x.effects?.map((e) => ({ ...e, props: shiftProps(e.props, dt) }));
    }
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', nid), value: x });
  }
  const group: Layer = { ...structuredClone(l), type: 'group', transform: { ...l.transform, anchor: moved as Prop<Vec2> }, children: inner.order.map((o) => ids.get(o)!) };
  delete group.props;
  ops.push({ op: 'replace', path: pointer('compositions', compId, 'layers', id), value: group });
  const shown = Object.entries(doc.compositions).some(([cid, k]) => Object.entries(k.layers).some(([lid, x]) => (cid !== compId || lid !== id) && x.type === 'comp' && x.props?.comp === innerId));
  if (!shown && innerId !== doc.root) ops.push({ op: 'remove', path: pointer('compositions', innerId) });
  if (commit(t('panel.decompose'), ops)) select([id]);
}

/** the compositions from the main one down to this one, through the comp layers that show them */
function trailTo(doc: TrammeDoc, target: string): string[] {
  const seen = new Set<string>();
  const walk = (cid: string): string[] | null => {
    if (cid === target) return [cid];
    if (seen.has(cid)) return null;
    seen.add(cid);
    for (const l of Object.values(doc.compositions[cid]?.layers ?? {})) {
      const next = l.type === 'comp' && typeof l.props?.comp === 'string' ? l.props.comp as string : null;
      const rest = next && walk(next);
      if (rest) return [cid, ...rest];
    }
    return null;
  };
  return walk(doc.root) ?? [doc.root, target];
}

/** where the open composition sits: each step above goes back up to it */
function CompTrail() {
  const doc = viewDoc.value, id = S.compId.value;
  if (!id || id === doc.root || !doc.compositions[id]) return null;
  const trail = trailTo(doc, id);
  return (
    <nav class="comp-trail" aria-label={t('panel.compositionPath')}>
      {trail.map((cid, i) => (i < trail.length - 1
        ? <Fragment key={cid}><button title={t('panel.backToName', { name: doc.compositions[cid].name })} onClick={() => { S.compId.value = cid; select([]); }}>{doc.compositions[cid].name}</button><Icon name="chevron" size={10} /></Fragment>
        : <span key={cid} class="here">{doc.compositions[cid].name}</span>))}
    </nav>
  );
}

/**
 * The menu of a layer, the same in the layer list and on its clip in the
 * timeline: `before` first (what only that place offers), rename when the
 * place can rename in line.
 */
export function openLayerMenu(e: MouseEvent | { clientX: number; clientY: number }, id: string, opts: { rename?: () => void; before?: MenuItem[] } = {}) {
  if ('preventDefault' in e) e.preventDefault();
  const c = comp.peek(), l = c.layers[id];
  if (!l) return;
  if (!S.selection.peek().includes(id)) select([id]);
  const lp = pointer('compositions', S.compId.peek(), 'layers', id);
  const media = mediaOf(l);
  openMenu(e, [
    ...(opts.before?.length ? [...opts.before, 'sep' as const] : []),
    ...(opts.rename ? [{ label: t('common.rename'), icon: 'text' as const, onClick: opts.rename }] : []),
    { label: t('common.duplicate'), icon: 'copy', hint: 'Ctrl+D', onClick: duplicateSelection },
    { label: l.visible === false ? t('common.show') : t('common.hide'), icon: l.visible === false ? 'eye' : 'eyeOff', onClick: () => commit(t('panel.visibility'), l.visible === false ? [{ op: 'remove', path: `${lp}/visible` }] : [{ op: 'add', path: `${lp}/visible`, value: false }]) },
    { label: t('panel.goToInPoint'), icon: 'start', onClick: () => { S.time.value = l.in ?? 0; } },
    { label: t('panel.precompose'), icon: 'comp', onClick: precompose },
    ...(l.type === 'comp' && typeof l.props?.comp === 'string' ? [
      { label: t('panel.openComposition'), icon: 'comp' as const, onClick: () => { S.compId.value = l.props!.comp as string; select([]); } },
      { label: t('panel.decompose'), icon: 'group' as const, onClick: decompose },
    ] : []),
    ...(l.type === 'audio' && c.order.includes(id) ? [{ label: t('panel.groupSounds'), icon: 'audio' as const, onClick: groupSounds }] : []),
    ...(media ? [transcribeItem(media)] : []),
    'sep',
    { label: t('common.delete'), icon: 'trash', hint: t('common.del'), onClick: deleteSelection },
  ]);
}

// ── layer tree ───────────────────────────────────────────────
/** the words the layer tree is narrowed to: every layer whose name holds them, folded groups opened */
const filter = signal('');

function LayerTree() {
  const c = comp.value, now = uiTime.value, sel = S.selection.value, q = filter.value.trim().toLowerCase();
  const items = q ? flatTree(c).filter(({ id, layer }) => `${layerName(id, layer)} ${id}`.toLowerCase().includes(q)) : flatTree(c, S.collapsed.value);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'after' | 'inside' } | null>(null);
  const compId = S.compId.value;
  const lp = (id: string) => pointer('compositions', compId, 'layers', id);

  const click = (e: MouseEvent, id: string) => clickSelect(e, id, items.map((i) => i.id));

  const startDrag = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || renaming) return;
    const y0 = e.clientY;
    let dragging = false, target: typeof drop = null;
    // a long press of a finger opens the row's menu and ends the drag
    let menued = false;
    const stopPress = longPress(e, (pos) => { menued = true; rowMenu(pos, id); });
    const move = (ev: PointerEvent) => {
      if (menued) return;
      if (!dragging && Math.abs(ev.clientY - y0) < 4) return;
      dragging = true;
      const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-layer]') as HTMLElement | null;
      const over = row?.dataset.layer;
      if (!over || subtree(c, id).includes(over)) { target = null; setDrop(null); return; }
      const r = row!.getBoundingClientRect(), k = (ev.clientY - r.top) / r.height;
      const isGroup = !!c.layers[over].children;
      const where = isGroup && k > 0.3 && k < 0.7 ? 'inside' : k < 0.5 ? 'before' : 'after';
      target = { id: over, where };
      setDrop(target);
    };
    const up = () => {
      stopPress();
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setDrop(null);
      if (menued || !dragging || !target) return;
      const doc = S.doc.peek();
      let place: { parent?: string; index?: number };
      if (target.where === 'inside') place = { parent: target.id };
      else {
        const parent = parentOf(c, target.id) ?? undefined;
        const arr = (parent ? c.layers[parent].children! : c.order).filter((x) => x !== id);
        const i = arr.indexOf(target.id);
        // the list shows the top first: "before" in the list is above, so later in the stack
        place = { parent, index: target.where === 'before' ? i + 1 : i };
      }
      commit(t('panel.moveLayer'), moveLayer(doc, compId, id, place));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const rowMenu = (e: MouseEvent | { clientX: number; clientY: number }, id: string) => openLayerMenu(e, id, { rename: () => setRenaming(id) });

  if (!Object.keys(c.layers).length) {
    return <div class="empty"><Icon name="layers" />{t('panel.noLayers')}<button class="btn sm" onClick={(e) => addLayerMenu(e)}><Icon name="plus" />{t('panel.addALayer')}</button></div>;
  }
  return (
    <div class="tree" role="tree">
      <div class="tree-filter">
        <Icon name="search" size={12} />
        <input value={filter.value} placeholder={t('panel.filterLayers')} spellcheck={false}
          onInput={(e) => { filter.value = (e.target as HTMLInputElement).value; }} onKeyDown={(e) => { if (e.key === 'Escape') { filter.value = ''; (e.target as HTMLInputElement).blur(); } }} />
        {filter.value ? <button class="icon-btn xs" title={t('panel.clearFilter')} onClick={() => { filter.value = ''; }}><Icon name="x" /></button> : <FoldButtons />}
      </div>
      {!items.length && <div class="faint tree-none">{t('panel.noLayerMatches')}</div>}
      {items.map(({ id, layer, depth }) => {
        const active = layerActive(layer, c, now);
        const hidden = layer.visible === false;
        const isOpen = !S.collapsed.value.has(id);
        const d = drop?.id === id ? ` drop-${drop.where}` : '';
        return (
          <div key={id} data-layer={id} role="treeitem" aria-selected={sel.includes(id)}
            class={`tree-row${sel.includes(id) ? ' selected' : ''}${active ? '' : ' inactive'}${hidden ? ' hidden' : ''}${d}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={(e) => click(e, id)} onDblClick={() => setRenaming(id)} onPointerDown={(e) => startDrag(e, id)} onContextMenu={(e) => rowMenu(e, id)}>
            {layer.children
              ? <button class={`twist${isOpen ? ' open' : ''}`} title={t('panel.foldHint')} onClick={(e) => { e.stopPropagation(); toggleFold(id, e.altKey); }}><Icon name="chevron" /></button>
              : <span style={{ width: 16, flex: 'none' }} />}
            <span class="kind" style={{ color: kindColor(layer.type) }}><Icon name={kindIcon(layer.type)} /></span>
            <span class="name">
              {renaming === id
                ? <input autoFocus value={layer.name ?? id} onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); setRenaming(null); if (v && v !== (layer.name ?? id)) commit(t('common.rename'), [{ op: 'add', path: `${lp(id)}/name`, value: v }]); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                : layerName(id, layer)}
            </span>
            <span class="badge" title={layer.clip ? t('panel.clippedByName', { name: layer.clip }) : undefined}>{layer.clip && <Icon name="safe" size={12} />}</span>
            <span class={`row-actions${hidden ? ' always' : ''}`}>
              <button class={`icon-btn xs${hidden ? ' on' : ''}`} title={hidden ? t('common.show') : t('common.hide')} onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); commit(hidden ? t('common.show') : t('common.hide'), hidden ? [{ op: 'remove', path: `${lp(id)}/visible` }] : [{ op: 'add', path: `${lp(id)}/visible`, value: false }]); }}>
                <Icon name={hidden ? 'eyeOff' : 'eye'} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── assets ───────────────────────────────────────────────────
const ASSET_ICON: Record<string, string> = { image: 'image', font: 'text', audio: 'audio', video: 'film', module: 'code', json: 'code', model: 'box' };
const ASSET_LABEL: Record<string, string> = { image: m('panel.images'), font: m('panel.fonts'), audio: m('panel.sounds'), video: m('panel.videos'), module: m('panel.code'), json: m('panel.data'), model: m('panel.models'), lut: m('panel.luts') };

function typeOfFile(name: string): Asset['type'] | null {
  const ext = name.toLowerCase().split('.').pop()!;
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'].includes(ext)) return 'image';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (['wav', 'mp3', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['glb', 'gltf'].includes(ext)) return 'model';
  if (['js', 'mjs'].includes(ext)) return 'module';
  if (ext === 'json') return 'json';
  if (ext === 'cube') return 'lut';
  return null;
}

/** merge an imported document (Lottie) into this one: its compositions and assets, ids made unique */
async function importLottie(f: File) {
  const { doc: src, files, warnings } = fromLottie(JSON.parse(await f.text()));
  // the animation's embedded images become files of the project
  if (files.length) {
    const taken = await takenPaths(), moved = new Map<string, string>();
    const folder = `assets/${safeName(f.name.replace(/(\.lottie)?\.json$/i, ''))}`;
    for (const file of files) moved.set(file.path, await upload(taken, `${folder}/${safeName(file.path.split('/').pop()!)}`, file.data));
    for (const a of Object.values(src.assets)) a.src = moved.get(a.src) ?? a.src;
  }
  const doc = S.doc.peek();
  const ops: Op[] = [];
  const assetIds = new Map<string, string>(), compIds = new Map<string, string>();
  const takenA: Record<string, unknown> = { ...doc.assets }, takenC: Record<string, unknown> = { ...doc.compositions };
  for (const id of Object.keys(src.assets)) { const n = freshId(takenA, id); takenA[n] = 1; assetIds.set(id, n); }
  for (const id of Object.keys(src.compositions)) { const n = freshId(takenC, id === 'main' ? 'lottie' : id); takenC[n] = 1; compIds.set(id, n); }
  for (const [id, a] of Object.entries(src.assets)) ops.push({ op: 'add', path: pointer('assets', assetIds.get(id)!), value: a });
  for (const [id, c] of Object.entries(src.compositions)) {
    const copy = JSON.parse(JSON.stringify(c)) as typeof c;
    for (const l of Object.values(copy.layers)) {
      if (l.type === 'comp' && typeof l.props?.comp === 'string') l.props.comp = compIds.get(l.props.comp) ?? l.props.comp;
      if (l.type === 'image' && typeof l.props?.image === 'string') l.props.image = assetIds.get(l.props.image) ?? l.props.image;
    }
    if (id === 'main') copy.name = f.name.replace(/\.json$/i, '');
    ops.push({ op: 'add', path: pointer('compositions', compIds.get(id)!), value: copy });
  }
  if (commit(t('panel.importName', { name: f.name }), ops)) {
    S.compId.value = compIds.get('main')!;
    select([]);
    toast(warnings.length ? t('panel.lottieImportedWithN', { n: warnings.length, list: warnings.slice(0, 3).join(' ; ') }) : t('panel.lottieImported'), 'info', 8000);
  }
}

export async function importFiles(files: FileList | File[]) {
  const doc = S.doc.peek();
  const ops = [];
  const taken: Record<string, unknown> = { ...doc.assets };
  let paths: Set<string> | null = null;
  // numbered drawings (oeil_01.png, oeil_02.png…) go together in a folder of their own
  const images = Array.from(files).filter((f) => typeOfFile(f.name) === 'image');
  const stem = images.length > 1 ? commonStem(images.map((f) => f.name)) : null;
  const folder = stem ? `assets/${safeName(stem)}` : 'assets';
  // a file already in the project (or twice in this import) is answered with its asset, nothing written
  const added = new Map<string, string>(), already: string[] = [];
  for (const f of Array.from(files)) {
    if (/\.json$/i.test(f.name)) {
      try { await importLottie(f); } catch (e) { toast(t('panel.couldNotImportLottie', { error: (e as Error).message }), 'error'); }
      continue;
    }
    const type = typeOfFile(f.name);
    if (!type) { toast(t('panel.unsupportedFormatName', { name: f.name }), 'error'); continue; }
    let src: string, hash: string;
    try {
      hash = await contentHash(f);
      const have = assetWithHash(doc, hash) ?? added.get(hash);
      if (have) { already.push(t('panel.nameIsAsset', { name: f.name, asset: have })); continue; }
      paths ??= await takenPaths();
      src = await upload(paths, `${type === 'image' ? folder : 'assets'}/${safeName(f.name)}`, f);
    } catch (e) { toast(t('panel.couldNotImportName', { name: f.name, error: (e as Error).message }), 'error'); continue; }
    const id = freshId(taken, f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'));
    taken[id] = 1;
    added.set(hash, id);
    const asset: Asset = { type, src, name: f.name.replace(/\.[^.]+$/, ''), hash };
    if (type === 'font') asset.family = asset.name;
    ops.push({ op: 'add' as const, path: pointer('assets', id), value: asset });
  }
  if (ops.length && commit(ops.length > 1 ? t('panel.importNFiles', { n: ops.length }) : t('panel.importName', { name: (ops[0].value as Asset).name ?? '' }), ops) && stem) {
    toast(t('panel.nDrawingsInFolder', { n: images.length, folder }), 'info', 9000);
  }
  if (already.length) toast(t('panel.alreadyInProject', { list: already.join(', ') }), 'info', 8000);
  // a video this machine decodes slower than it plays: a proxy offered (measured on a second of it)
  for (const o of ops) {
    const a = o.value as Asset, f = Array.from(files).find((x) => x.name.replace(/\.[^.]+$/, '') === a.name);
    if (a.type === 'video' && f) void offerProxy(o.path.split('/').pop()!, f);
  }
}

async function offerProxy(id: string, file: File) {
  const { decodeRate, playsPoorly, proxySize } = await import('../proxy.ts');
  const rate = await decodeRate(file).catch(() => null);
  if (!rate || !proxySize(rate.width, rate.height) || !playsPoorly(rate.fps, rate.fileFps)) return;
  if (!(await askUser(t('panel.proxyTitle'), t('panel.proxyText', { name: file.name, fps: Math.round(rate.fps), need: Math.round(rate.fileFps) }), t('panel.makeProxy')))) return;
  const { listCommands } = await import('../ai/commands.ts'), { runCommand } = await import('../ai/conversation.ts');
  const cmd = listCommands(S.registry.peek()).find((c) => c.name === 'proxy');
  if (cmd) await runCommand(cmd, { video: id });
}

function Compositions() {
  const doc = viewDoc.value, active = S.compId.value;
  const create = () => {
    const c = doc.compositions[active];
    const id = freshId(doc.compositions, 'comp');
    if (commit(t('panel.newComposition'), [{ op: 'add', path: pointer('compositions', id), value: { name: t('panel.compositionN', { n: Object.keys(doc.compositions).length + 1 }), width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: null, layers: {}, order: [] } }])) {
      S.compId.value = id; select([]);
    }
  };
  const createSequence = () => {
    const c = doc.compositions[active];
    const id = freshId(doc.compositions, 'sequence');
    const tracks = [{ id: 'V1', kind: 'video', magnetic: true }, { id: 'A1', kind: 'audio' }];
    if (commit(t('panel.newSequence'), [{ op: 'add', path: pointer('compositions', id), value: { name: t('panel.sequenceN', { n: Object.keys(doc.compositions).length + 1 }), kind: 'sequence', width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: null, tracks, layers: {}, order: [] } }])) {
      S.compId.value = id; select([]);
    }
  };
  const menu = (e: MouseEvent | { clientX: number; clientY: number }, id: string) => {
    if ('preventDefault' in e) e.preventDefault();
    const c = doc.compositions[id];
    openMenu(e, [
      { label: t('common.open'), icon: 'comp', onClick: () => { S.compId.value = id; select([]); } },
      { label: t('panel.insertAsLayer'), icon: 'plus', disabled: id === active, onClick: () => insertLayer({ type: 'comp', name: c.name, transform: { position: [doc.compositions[active].width / 2, doc.compositions[active].height / 2] }, props: { comp: id } }, id) },
      { label: t('panel.mainComposition'), icon: doc.root === id ? 'check' : 'film', disabled: doc.root === id, onClick: () => commit(t('panel.mainComposition'), [{ op: 'replace', path: '/root', value: id }]) },
      // a component goes to the library shared by the projects
      ...(c.params && id !== doc.root ? [{ label: t('panel.keepInLibrary'), icon: 'download' as const, onClick: () => { const cmd = listCommands(S.registry.peek()).find((x) => x.name === 'component-keep'); if (cmd) void runCommand(cmd, { component: id }); } }] : []),
      'sep',
      { label: t('common.delete'), icon: 'trash', disabled: doc.root === id, onClick: () => { if (commit(t('panel.deleteName2', { name: c.name }), [{ op: 'remove', path: pointer('compositions', id) }])) { if (active === id) S.compId.value = doc.root; } } },
    ]);
  };
  return (
    <div>
      <div class="section-label" style={{ display: 'flex', alignItems: 'center' }}>{t('panel.compositions')}<span style={{ flex: 1 }} /><button class="icon-btn xs" title={t('panel.newComposition')} onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), [{ label: t('panel.newComposition'), icon: 'comp', onClick: create }, { label: t('panel.newSequence'), icon: 'film', onClick: createSequence }])}><Icon name="plus" /></button></div>
      {Object.entries(doc.compositions).map(([id, c]) => (
        <div key={id} class={`list-row${id === active ? ' on' : ''}`} onClick={() => { S.compId.value = id; select([]); }} draggable onDragStart={(e) => { e.dataTransfer?.setData(COMP_MIME, id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }}
          onPointerDown={(e) => longPress(e, (pos) => menu(pos, id))} onContextMenu={(e) => menu(e, id)}>
          <span class="thumb"><Icon name={doc.root === id ? 'film' : c.params ? 'sliders' : 'comp'} /></span>
          <span class="name" title={c.params ? t('panel.componentWith', { params: Object.keys(c.params).join(', ') }) : undefined}>{c.name}</span>
          <span class="meta mono">{c.params ? `${t('panel.component')} · ` : ''}{c.width}×{c.height} · {c.duration} s</span>
        </div>
      ))}
    </div>
  );
}

/** a sequence layer playing every drawing of a folder, at the size of the composition */
function animateFolder(folder: string) {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const frames = imagesIn(doc, folder);
  if (!frames.length) return;
  const name = folder.split('/').pop() || t('panel.sequence');
  insertLayer(newLayer(doc, compId, S.registry.peek().node('sequence'), { name, props: { frames, size: [c.width, c.height], hold: c.fps >= 48 ? 4 : 2 } }), frames[0]);
}

function Assets() {
  const doc = viewDoc.value;
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<AssetFilter>({});
  const spoken = useSpoken(doc, !!filter.text);
  const input = useRef<HTMLInputElement>(null);
  const relink = useRef<HTMLInputElement>(null);
  const offline = S.offline.value;
  // a copy of a shipped pack older than the editor's: offered its update, the way an installed plugin's copy is
  const [updates, setUpdates] = useState<PackUpdate[]>([]);
  // read again only when the modules or their recorded versions change, not on every edit; a read overtaken by a newer one is dropped
  const modulesKey = JSON.stringify([Object.entries(doc.assets).filter(([, a]) => a.type === 'module').map(([id, a]) => [id, a.src]), doc.meta.installedCopies ?? null]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const packs = await shippedPacks();
        const versions: Record<string, string> = {};
        for (const a of Object.values(doc.assets)) {
          if (a.type !== 'module' || !packBySrc(packs, a.src)) continue;
          try { versions[a.src!] = manifestOf((await api.readText(S.project.peek().id, a.src!))?.text ?? '', a.src!).version; } catch { /* unread: no offer */ }
        }
        if (live) setUpdates(packUpdates(doc, packs, versions));
      } catch { /* no packs: no offers */ }
    })();
    return () => { live = false; };
  }, [modulesKey]);
  const byType = new Map<string, [string, Asset][]>();
  const shown = filterAssets(doc, filter, spoken);
  for (const e of shown) { if (!byType.has(e[1].type)) byType.set(e[1].type, []); byType.get(e[1].type)!.push(e); }
  const url = (id: string) => { try { return preview.renderer?.assets.url(id) ?? ''; } catch { return ''; } };
  const assetMenu = (e: MouseEvent | { clientX: number; clientY: number }, id: string, a: Asset) => {
    if ('preventDefault' in e) e.preventDefault();
    openMenu(e, [
      ...(a.type === 'image' || a.type === 'audio' || a.type === 'video' || a.type === 'model' ? [{ label: t('panel.createALayer'), icon: 'plus' as const, onClick: () => use(id, a) }] : []),
      { label: t('panel.moveToBin'), icon: 'folder' as const, onClick: () => openMenu(e, [
        ...binsOf(doc).filter((b) => b !== a.bin).map((b): MenuItem => ({ label: b, icon: 'folder', onClick: () => commit(t('panel.moveToBin'), setBinOps(S.doc.peek(), [id], b)) })),
        { label: t('panel.newBin'), icon: 'plus', onClick: () => { naming.value = { kind: 'bin', ids: [id] }; } },
        ...(a.bin ? [{ label: t('panel.takeOutOfBin'), icon: 'x' as const, onClick: () => commit(t('panel.takeOutOfBin'), setBinOps(S.doc.peek(), [id], '')) }] : []),
      ]) },
      { label: t('panel.addTag'), icon: 'marker' as const, onClick: () => { naming.value = { kind: 'tag', ids: [id] }; } },
      ...(a.tags ?? []).map((tag): MenuItem => ({ label: `#${tag} ×`, onClick: () => commit(t('panel.addTag'), removeTagOps(S.doc.peek(), [id], tag)) })),
      ...(a.type === 'audio' || a.type === 'video' ? [{ label: t('source.openInSource'), icon: 'film' as const, onClick: () => { sourceOpen.value = id; } }] : []),
      ...(S.offline.peek().includes(id) ? [{ label: t('panel.relinkFile'), icon: 'search' as const, onClick: () => relink.current?.click() }] : []),
      ...(a.type === 'audio' || a.type === 'video' || a.type === 'image' ? [{ label: t('panel.newSequenceFromMedia'), icon: 'film' as const, onClick: () => { void newSequenceFromAsset(id); } }] : []),
      ...(a.type === 'audio' || a.type === 'video' ? [transcribeItem(id)] : []),
      ...(a.type === 'image' ? [{ label: t('panel.animateTheFolderN', { n: imagesIn(doc, folderOf(a.src)).length }), icon: 'film' as const, onClick: () => animateFolder(folderOf(a.src)) }] : []),
      { label: t('panel.removeFromProject'), icon: 'trash', onClick: () => commit(t('common.removeName', { name: a.name || id }), [{ op: 'remove', path: pointer('assets', id) }]) },
    ]);
  };
  const use = (id: string, a: Asset) => { void layerFromAsset(id, a); };
  return (
    <div class={`panel-body${over ? ' drop' : ''}`} style={over ? { boxShadow: 'inset 0 0 0 2px var(--accent-line)' } : undefined}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files); }}>
      <Compositions />
      <input ref={relink} type="file" multiple hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) void relinkFiles([...f]); (e.target as HTMLInputElement).value = ''; }} />
      {offline.length > 0 && <div class="missing-note"><Icon name="alert" size={13} /><span>{t('panel.mediaMissing', { n: offline.length })}</span><button class="btn sm" onClick={() => relink.current?.click()}>{t('panel.relinkMissing')}</button></div>}
      {Object.keys(doc.assets).length > 0 && <MediaBar doc={doc} filter={filter} onChange={setFilter} />}
      {Object.keys(doc.assets).length > 0 && shown.length === 0 && <div class="faint tree-none">{t('panel.noMediaMatches')}</div>}
      <input ref={input} type="file" multiple hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) importFiles(f); (e.target as HTMLInputElement).value = ''; }} />
      {byType.size === 0 && <div class="empty"><Icon name="folder" />{t('panel.noAssetsDropFiles')}<button class="btn sm" onClick={() => input.current?.click()}><Icon name="plus" />{t('panel.import')}</button></div>}
      {[...byType].map(([type, list]) => (
        <div key={type}>
          <div class="section-label" style={type === 'module' ? { display: 'flex', alignItems: 'center' } : undefined}>
            {ASSET_LABEL[type] ? t(ASSET_LABEL[type]) : type}
            {type === 'module' && <span style={{ flex: 1 }} />}
            {type === 'module' && <button class="icon-btn xs" title={t('panel.addPack')} onClick={(e) => packMenu(e, addPack)}><Icon name="plus" /></button>}
          </div>
          {list.map(([id, a]) => (
            <div key={id} class={`list-row${chosenAsset.value === id ? ' on' : ''}`} title={a.src} draggable onDragStart={(e) => { e.dataTransfer?.setData(ASSET_MIME, id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => { chosenAsset.value = id; }} onDblClick={() => use(id, a)}
              onPointerDown={(e) => longPress(e, (pos) => assetMenu(pos, id, a))} onContextMenu={(e) => assetMenu(e, id, a)}>
              <span class="thumb" style={a.type === 'image' ? { backgroundImage: `url("${url(id)}")`, backgroundSize: 'contain', backgroundColor: 'var(--media)' } : undefined}>
                {a.type !== 'image' && (a.type === 'font' ? <span style={{ fontFamily: `"${a.family}"`, color: 'var(--text)', fontSize: 13 }}>Aa</span> : <Icon name={ASSET_ICON[a.type]} />)}
              </span>
              <span class="name" style={offline.includes(id) ? { color: 'var(--danger, var(--text-3))' } : undefined}>{a.name || id}</span>
              {offline.includes(id) && <span class="offline-badge" title={t('panel.fileMissing')}><Icon name="alert" size={12} /></span>}
              {updates.filter((u) => u.assetId === id).map((u) => (
                <button key={u.to} class="btn sm" title={t('panel.packOlderHere', { from: u.from, to: u.to })}
                  onClick={() => takeUpdate(u).catch((x) => toast(t('panel.couldNotUpdatePack', { error: (x as Error).message }), 'error', 9000))}>
                  {t('panel.updateTo', { version: u.to })}
                </button>
              ))}
              {a.type === 'audio' || a.type === 'video' ? <TranscribeButton asset={id} small /> : <span class="meta mono">{id}</span>}
            </div>
          ))}
        </div>
      ))}
      {byType.size > 0 && <div style={{ padding: 10 }}><button class="btn sm ghost" onClick={() => input.current?.click()}><Icon name="plus" />{t('panel.importFiles')}</button></div>}
      {byType.size === 0 && <div style={{ padding: 10 }}><button class="btn sm ghost" onClick={(e) => packMenu(e, addPack)}><Icon name="plus" />{t('panel.addPack')}</button></div>}
    </div>
  );
}

/** the shipped packs, one click each: the file enters the project, the document loads it */
async function addPack(p: PackEntry) {
  const text = await fetch(`/plugins/${p.file}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const path = await upload(await takenPaths(), `plugins/${p.file}`, new Blob([text], { type: 'text/javascript; charset=utf-8' }));
  const doc = S.doc.peek();
  const id = freshId(doc.assets, p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const ops: Op[] = [{ op: 'add', path: pointer('assets', id), value: { type: 'module', src: path, name: p.name } }];
  if (doc.plugins?.length) ops.push({ op: 'add', path: '/plugins/-', value: id });
  else ops.push({ op: 'add', path: '/plugins', value: [id] });
  commit(t('panel.packAdded', { name: p.name }), ops);
}

/** the shipped version put in the open project in place of its older copy (asked, never applied alone), its version recorded as an installed plugin's copy keeps its own */
async function takeUpdate(u: PackUpdate) {
  const text = await fetch(`/plugins/${u.file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
  await api.write(S.project.peek().id, u.src, new Blob([text], { type: 'text/javascript; charset=utf-8' }), { type: 'text/javascript; charset=utf-8' });
  const doc = S.doc.peek(), copies = { ...copiesIn(doc), [packIdOf(u.file)]: u.to };
  const ops: Op[] = [{ op: doc.meta.installedCopies === undefined ? 'add' : 'replace', path: '/meta/installedCopies', value: copies }];
  if (commit(t('panel.packUpdated', { name: u.name, version: u.to }), ops)) await preview.reload([u.assetId]);
}

async function packMenu(e: MouseEvent, add: (p: PackEntry) => Promise<void>) {
  const packs = await shippedPacks();
  openMenu(e, packs.length
    ? packs.map((p): MenuItem => ({ label: p.name, icon: 'plus', onClick: () => add(p).catch((x) => toast(t('panel.couldNotAddPack', { error: (x as Error).message }), 'error', 9000)) }))
    : [{ label: t('panel.noPacks'), disabled: true, onClick: () => {} }]);
}

// ── tokens ───────────────────────────────────────────────────
function EaseThumb({ v }: { v: unknown }) {
  const b = Array.isArray(v) ? v as number[] : [0, 0, 1, 1];
  const P = (x: number, y: number) => `${3 + x * 20},${23 - y * 20}`;
  return <svg class="ease-thumb" viewBox="0 0 26 26"><path d={`M${P(0, 0)} C${P(b[0], b[1])} ${P(b[2], b[3])} ${P(1, 1)}`} /></svg>;
}

function Tokens() {
  const doc = viewDoc.value;
  const colors = Object.entries(doc.tokens).filter(([, t]) => t.type === 'color');
  const eases = Object.entries(doc.tokens).filter(([, t]) => t.type === 'ease');
  const others = Object.entries(doc.tokens).filter(([, t]) => t.type !== 'color' && t.type !== 'ease');
  const [editing, setEditing] = useState<string | null>(null);
  const addColor = () => {
    const id = freshId(doc.tokens, 'color');
    commit(t('panel.newToken'), [{ op: 'add', path: pointer('tokens', id), value: { type: 'color', value: '#2EC4B6' } }]);
    setEditing(id);
  };
  const tokenMenu = (e: MouseEvent | { clientX: number; clientY: number }, name: string) => {
    if ('preventDefault' in e) e.preventDefault();
    openMenu(e, [
    { label: t('panel.edit'), icon: 'palette', onClick: () => setEditing(name) },
    { label: t('common.delete'), icon: 'trash', onClick: () => commit(t('panel.deleteName3', { name }), [{ op: 'remove', path: pointer('tokens', name) }]) },
  ]); };
  return (
    <div class="panel-body">
      <div class="section-label" style={{ display: 'flex', alignItems: 'center' }}>{t('panel.colors')}<span style={{ flex: 1 }} /><button class="icon-btn xs" title={t('panel.newColor')} onClick={addColor}><Icon name="plus" /></button></div>
      {colors.length === 0 && <div class="faint" style={{ padding: '0 10px 8px' }}>{t('panel.noBrandColors')}</div>}
      <div class="token-grid">
        {colors.map(([name, t]) => (
          <div class="token" key={name} title={t.description ?? ''} onPointerDown={(e) => longPress(e, (pos) => tokenMenu(pos, name))} onContextMenu={(e) => tokenMenu(e, name)} onDblClick={() => setEditing(name)}>
            <Swatch color={resolveColor(`@${name}`, doc.tokens)} onClick={() => setEditing(editing === name ? null : name)} />
            <div style={{ minWidth: 0 }}><div class="tname">{name}</div><div class="tval">{String(t.value)}</div></div>
          </div>
        ))}
      </div>
      {editing && doc.tokens[editing] && (
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 10px', alignItems: 'center' }}>
          <span class="mono faint" style={{ width: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>@{editing}</span>
          <ColorField value={String(doc.tokens[editing].value)} tokens={{}} onCommit={(v) => commit(`@${editing}`, [{ op: 'replace', path: pointer('tokens', editing, 'value'), value: v }])} />
          <button class="icon-btn sm" onClick={() => setEditing(null)}><Icon name="check" /></button>
        </div>
      )}
      <div class="section-label">{t('common.curves')}</div>
      {eases.length === 0 && <div class="faint" style={{ padding: '0 10px 8px' }}>{t('panel.noNamedCurves')}</div>}
      <div class="token-grid">
        {eases.map(([name, t]) => (
          <div class="token" key={name} title={t.description ?? ''} onPointerDown={(e) => longPress(e, (pos) => tokenMenu(pos, name))} onContextMenu={(e) => tokenMenu(e, name)}>
            <EaseThumb v={t.value} />
            <div style={{ minWidth: 0 }}><div class="tname">{name}</div><div class="tval">{Array.isArray(t.value) ? (t.value as number[]).join(' ') : String(t.value)}</div></div>
          </div>
        ))}
      </div>
      {others.length > 0 && <>
        <div class="section-label">{t('panel.others')}</div>
        {others.map(([name, tok]) => (
          <div class="list-row" key={name}>
            <span class="name mono">@{name}</span>
            <div style={{ width: 110 }}><TextInput value={JSON.stringify(tok.value)} mono onCommit={(v) => { try { commit(`@${name}`, [{ op: 'replace', path: pointer('tokens', name, 'value'), value: JSON.parse(v) }]); } catch { toast(t('panel.invalidJsonValue'), 'error'); } }} /></div>
          </div>
        ))}
      </>}
    </div>
  );
}

/** fold or unfold every group at once: shown when the composition has groups */
export function FoldButtons() {
  if (!Object.values(comp.value.layers).some((l) => l.children)) return null;
  return (
    <>
      <button class="icon-btn xs" title={t('panel.foldAll')} onClick={() => foldAll(true)}><Icon name="foldAll" /></button>
      <button class="icon-btn xs" title={t('panel.unfoldAll')} onClick={() => foldAll(false)}><Icon name="unfoldAll" /></button>
    </>
  );
}

export function LeftPanel() {
  const current = tab.value;
  return (
    <>
      <div class="panel-head">
        <Seg value={current} role="tablist"
          options={[
            { value: 'layers', label: t('common.layers'), tour: 'left-tab-layers' },
            { value: 'assets', label: t('panel.assets'), tour: 'left-tab-assets' },
            { value: 'tokens', label: t('panel.tokens'), tour: 'left-tab-tokens' },
          ]}
          onChange={(v) => { tab.value = v as 'layers' | 'assets' | 'tokens'; }} />
        <span class="grow" />
        {current === 'layers' && <button class="icon-btn sm" title={t('panel.addALayer')} onClick={(e) => addLayerMenu(e)}><Icon name="plus" /></button>}
      </div>
      {current === 'layers' && <div class="panel-body" onClick={(e) => { if (e.target === e.currentTarget) select([]); }}><CompTrail /><LayerTree /></div>}
      {current === 'assets' && <Assets />}
      {current === 'tokens' && <Tokens />}
    </>
  );
}
