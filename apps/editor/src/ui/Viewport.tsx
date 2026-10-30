// The viewport: the picture rendered by the engine, and over it, in
// composition pixels, the selection gizmos, safe zones and grid. Direct
// manipulation edits position, scale and rotation through the same ops as
// the inspector (a key at the current time when the property is animated).

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_PERSPECTIVE, Evaluator, getAt, isTilted, staticValue, tiltQuad, layerActive, pointer, propKind, anchorShift, movePathVertex, setPathTangent, insertPathVertex, removePathVertex, nearestOnPath, pathD, localFrame, neighbourDrawings, type Composition, type TrammeDoc, type EvaluatedLayer, type Handle, type PathValue, type Prop, type Rect, type Vec2 } from '@tramme/core';
import { drawingRect } from '@tramme/nodes';
import { localMatrix } from '@tramme/render';
import { comp, commit, draft, cancelDraft, S, select, viewDoc, previewDoc, toast, uiTime } from '../state.ts';
import { decide } from '../ai/conversation.ts';
import { editAtOps, flatTree, layerName, parentOf, propPath, rawProp } from '../model.ts';
import { assetData, preview, previewInfo } from '../preview.ts';
import { prefs, setPrefs, settingsOpen, type Preferences } from '../settings.ts';
import { openMenu, type MenuItem } from './controls.tsx';
import { Icon } from './icons.tsx';
import { m, t } from '../i18n/index.ts';
import { picking, pixelAt } from '../dropper.ts';
import { grading, Scopes } from './Scopes.tsx';

/** a finger rather than a mouse: bigger handles */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const zoom = signal<'fit' | number>('fit');
const pan = signal<Vec2>([0, 0]);

interface Geo { matrix: DOMMatrix; parent: DOMMatrix; bounds: Rect; layer: EvaluatedLayer }

/** world matrix and local bounds of a layer at time t */
function geometry(ev: Evaluator, c: Composition, compId: string, id: string, t: number): Geo | null {
  if (!preview.renderer) return null;
  let parent = new DOMMatrix();
  const chain: string[] = [];
  for (let p = parentOf(c, id); p; p = parentOf(c, p)) chain.unshift(p);
  try {
    for (const p of chain) parent = parent.multiply(localMatrix(ev.layerAt(p, t, compId).transform));
    const L = ev.layerAt(id, t, compId);
    const host = preview.renderer.hostFactory({ t, frame: Math.round(t * c.fps) })(id);
    const bounds = L.node.bounds?.(L.props, host) ?? (L.node.render.canvas2d ? { x: 0, y: 0, w: c.width, h: c.height } : null);
    if (!bounds) return null;
    return { matrix: parent.multiply(localMatrix(L.transform)), parent, bounds, layer: L };
  } catch { return null; }
}

const corners = (b: Rect): Vec2[] => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
const apply = (m: DOMMatrix, [x, y]: Vec2): Vec2 => { const p = m.transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; };
const poly = (pts: Vec2[]) => pts.map((p) => p.join(',')).join(' ');

/** where a layer's box lands on the stage: through its 2D matrix, or its projected quad when it is turned around x or y */
function outline(g: Geo, c: Composition): Vec2[] {
  if (isTilted(g.layer.transform)) {
    const q = tiltQuad(g.bounds, g.layer.transform, [g.parent.a, g.parent.b, g.parent.c, g.parent.d, g.parent.e, g.parent.f], Number(staticValue(c.camera?.perspective)) || DEFAULT_PERSPECTIVE);
    if (q) return q;
  }
  return corners(g.bounds).map((p) => apply(g.matrix, p));
}

function inside(g: Geo, p: Vec2): boolean {
  const q = g.matrix.inverse().transformPoint(new DOMPoint(p[0], p[1]));
  const b = g.bounds;
  return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h;
}

/** safe zones for the frame's shape: social vertical, or broadcast action and title safe */
function safeZones(c: Composition): { label: string; rect: Rect }[] {
  const { width: W, height: H } = c;
  if (H / W > 1.6) {
    const x = W * 0.06, y = H * 0.14, r = W - (140 * W) / 1080;
    return [{ label: t('viewport.socialSafeZoneReels'), rect: { x, y, w: r - x, h: H * 0.65 - y } }];
  }
  return [
    { label: t('viewport.action'), rect: { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 } },
    { label: t('viewport.titles'), rect: { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.8 } },
  ];
}

const MOTION_LABEL = { auto: m('common.automatic'), full: m('common.full'), half: m('common.half'), quarter: m('common.quarter') } as const;

/** the preview's quality, at hand: the main choices, and the settings for the rest */
function QualityButton() {
  const p = prefs.value, info = previewInfo.value;
  const reduced = info.scale < info.still - 1e-6;
  const menu = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pick = <K extends keyof Preferences>(k: K, v: Preferences[K], label: string): MenuItem => ({ label, icon: p[k] === v ? 'check' : undefined, onClick: () => setPrefs({ [k]: v } as Partial<Preferences>) });
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      { section: t('common.inMotion') },
      ...(['auto', 'full', 'half', 'quarter'] as const).map((v) => pick('motion', v, t(MOTION_LABEL[v]))),
      'sep', { section: t('common.whenStill') },
      pick('still', 'display', t('common.displayedSize')), pick('still', 'full', t('common.fullResolution')),
      'sep', { section: t('common.motionBlur') },
      pick('blur', 'document', t('common.document')), pick('blur', 'limited', t('viewport.limited4')), pick('blur', 'off', t('common.off')),
      'sep',
      { label: t('viewport.allSettings'), icon: 'gear', hint: 'Ctrl+,', onClick: () => { settingsOpen.value = true; } },
    ]);
  };
  return (
    <button data-tour="quality" class={`btn ghost sm quality${reduced ? ' reduced' : ''}`} onClick={menu}
      title={t('viewport.previewQualityExportsStay', { mode: t(MOTION_LABEL[p.motion]), n: Math.round(info.scale * 100) })}>
      <Icon name="frame" /><span>{reduced ? `${Math.round(info.scale * 100)} %` : t('viewport.sharp')}</span>
    </button>
  );
}

export interface ViewportProps {
  /** the studio's stage: the picture alone, no toolbar, banner, outlines nor handles (the studio shows its own) */
  bare?: boolean;
  /** room kept free around the picture, in pixels: top, right, bottom, left (what floats over the stage) */
  inset?: [number, number, number, number];
  /** drawn over the picture and sized like it (the studio's pins) */
  overlay?: ComponentChildren;
  /** a press on the picture, in composition pixels, taken before the selection sees it (a note pinned): true when taken; hit: the layer under it */
  intercept?: (p: Vec2, e: PointerEvent, hit: () => string | null, toComp: (e: { clientX: number; clientY: number }) => Vec2) => boolean;
}

/** the room the atelier keeps around the picture: its toolbar above */
const INSET: [number, number, number, number] = [60, 28, 32, 28];

export function Viewport({ bare = false, inset = INSET, overlay, intercept }: ViewportProps = {}) {
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const [spaceDown, setSpace] = useState(false);
  const c = comp.value, doc = viewDoc.value, now = S.time.value, compId = S.compId.value;
  const reg = S.registry.value;
  const ev = useMemo(() => new Evaluator(doc, reg, { data: assetData }), [doc, reg]);

  useLayoutEffect(() => {
    stageRef.current!.prepend(preview.canvas);
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') setSpace(true); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    addEventListener('keydown', down); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);

  const [inTop, inRight, inBottom, inLeft] = inset;
  const fit = Math.min((box.w - inLeft - inRight) / c.width, (box.h - inTop - inBottom) / c.height);
  const scale = zoom.value === 'fit' ? Math.max(0.02, fit) : zoom.value;
  const sw = c.width * scale, sh = c.height * scale;
  // the preview renders at the displayed size (device pixels), in a few steps to avoid resizing all the time
  useEffect(() => {
    const need = scale * (window.devicePixelRatio || 1);
    const k = [0.25, 0.375, 0.5, 0.75, 1].find((s) => s >= need - 0.01) ?? 1;
    if (S.previewScale.peek() !== k) S.previewScale.value = k;
  }, [scale]);
  /** where a picture of this size sits before the view is moved */
  const origin = (w: number, h: number): Vec2 => [inLeft + (box.w - inLeft - inRight - w) / 2, inTop + (box.h - inTop - inBottom - h) / 2];
  const left = origin(sw, sh)[0] + pan.value[0], top = origin(sw, sh)[1] + pan.value[1];

  /** pointer to composition pixels */
  const toComp = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = stageRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  // hit test, top first, deepest layers before their group
  const pick = (p: Vec2): string | null => {
    for (const it of flatTree(c)) {
      const l = it.layer;
      if (l.visible === false || l.locked || l.type === 'audio' || !layerActive(l, c, now)) continue;
      if (l.children) continue;
      let ok = true;
      for (let q = it.parent; q; q = parentOf(c, q)) { const pl = c.layers[q]; if (pl.visible === false || !layerActive(pl, c, now)) ok = false; }
      if (!ok) continue;
      const g = geometry(ev, c, compId, it.id, now);
      if (g && g.bounds.w * g.bounds.h < c.width * c.height * 0.98 && inside(g, p)) return it.id;
    }
    // full-frame layers last: they would always win
    for (const it of flatTree(c)) {
      const l = it.layer;
      if (l.visible === false || l.locked || l.children || l.type === 'audio' || !layerActive(l, c, now)) continue;
      const g = geometry(ev, c, compId, it.id, now);
      if (g && inside(g, p)) return it.id;
    }
    return null;
  };

  const selected = S.selection.value.filter((id) => c.layers[id]);
  const geo = !bare && selected.length === 1 ? geometry(ev, c, compId, selected[0], now) : null;
  const [vertex, setVertexAt] = useState<number | null>(null);
  /** the path the selected vertex belongs to: a node's path property, or a mask's ('masks.<id>.path') */
  const [vertexPath, setVertexPath] = useState<string | null>(null);
  const setVertex = (i: number | null, prop: string | null = null) => { setVertexAt(i); setVertexPath(i === null ? null : prop); };
  useEffect(() => { setVertex(null); }, [selected[0]]);

  /** where a property lives in the document: a mask's ('masks.<id>.<prop>') by the mask's place in the layer's list */
  const pathOf = (id: string, name: string) => {
    const mask = /^masks\.([^.]+)\.(.+)$/.exec(name);
    if (!mask) return propPath(compId, id, name);
    const i = (S.doc.peek().compositions[compId]?.layers[id]?.masks ?? []).findIndex((x) => x.id === mask[1]);
    return pointer('compositions', compId, 'layers', id, 'masks', i, 'props', mask[2]);
  };
  /** a property's name for the undo list */
  const labelOf = (g: Geo, name: string) => (name.startsWith('masks.') ? t('inspector.masks') : t(g.layer.node.props[name]?.label ?? name));
  const canEdit = (id: string, name: string) => {
    const raw = getAt(S.doc.peek(), pathOf(id, name)) as Prop | undefined;
    const k = raw === undefined ? 'static' : propKind(raw);
    if (k === 'expression' || k === 'link') { toast(k === 'link' ? t('viewport.nameIsDrivenBy', { name: name.replace('transform.', '') }) : t('viewport.nameIsDrivenByAn', { name: name.replace('transform.', '') })); return false; }
    return true;
  };
  const opsFor = (id: string, name: string, v: unknown) => editAtOps(S.doc.peek(), pathOf(id, name), v, S.time.peek(), c.fps);

  // ── drags ──────────────────────────────────────────────────
  const dragMove = (e: PointerEvent, id: string, g: Geo) => {
    if (!canEdit(id, 'transform.position')) return;
    const p0 = toComp(e), pos0 = g.layer.transform.position;
    const inv = g.parent.inverse();
    const a = inv.transformPoint(new DOMPoint(p0[0], p0[1]));
    let last: unknown = null;
    track((ev2) => {
      const p = toComp(ev2);
      const b = inv.transformPoint(new DOMPoint(p[0], p[1]));
      let dx = b.x - a.x, dy = b.y - a.y;
      if (ev2.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      last = [Math.round((pos0[0] + dx) * 10) / 10, Math.round((pos0[1] + dy) * 10) / 10];
      draft(opsFor(id, 'transform.position', last));
    }, () => { if (last) commit(t('viewport.moveName', { name: layerName(id, c.layers[id]) }), opsFor(id, 'transform.position', last)); else cancelDraft(); });
  };

  const dragScale = (e: PointerEvent, g: Geo, corner: Vec2) => {
    const id = selected[0];
    if (!canEdit(id, 'transform.scale')) return;
    e.stopPropagation();
    const tr = g.layer.transform;
    const base = g.parent.translate(tr.position[0], tr.position[1]).rotate(tr.rotation).inverse();
    const ref: Vec2 = [corner[0] - tr.anchor[0], corner[1] - tr.anchor[1]];
    let last: Vec2 | null = null;
    track((ev2) => {
      const p = toComp(ev2);
      const q = base.transformPoint(new DOMPoint(p[0], p[1]));
      let sx = ref[0] ? q.x / ref[0] : tr.scale[0], sy = ref[1] ? q.y / ref[1] : tr.scale[1];
      if (ev2.shiftKey) { const k = Math.abs(sx / tr.scale[0]) > Math.abs(sy / tr.scale[1]) ? sx / tr.scale[0] : sy / tr.scale[1]; sx = tr.scale[0] * k; sy = tr.scale[1] * k; }
      last = [Math.round(sx * 1000) / 1000, Math.round(sy * 1000) / 1000];
      draft(opsFor(id, 'transform.scale', last));
    }, () => { if (last) commit(t('viewport.scaleLayer'), opsFor(id, 'transform.scale', last)); else cancelDraft(); });
  };

  const dragRotate = (e: PointerEvent, g: Geo) => {
    const id = selected[0];
    if (!canEdit(id, 'transform.rotation')) return;
    e.stopPropagation();
    const tr = g.layer.transform;
    const center = apply(g.parent, tr.position);
    const p0 = toComp(e);
    const a0 = Math.atan2(p0[1] - center[1], p0[0] - center[0]);
    let last: number | null = null;
    track((ev2) => {
      const p = toComp(ev2);
      let r = tr.rotation + ((Math.atan2(p[1] - center[1], p[0] - center[0]) - a0) * 180) / Math.PI;
      r = ev2.shiftKey ? Math.round(r / 15) * 15 : Math.round(r * 10) / 10;
      last = r;
      draft(opsFor(id, 'transform.rotation', r));
    }, () => { if (last !== null) commit(t('viewport.rotate'), opsFor(id, 'transform.rotation', last)); else cancelDraft(); });
  };

  /** a handle the node declares: a point or a distance in the layer's local space, for one of its properties */
  const dragHandle = (e: PointerEvent, g: Geo, h: Handle) => {
    const id = selected[0];
    if (!canEdit(id, h.prop)) return;
    e.stopPropagation();
    const inv = g.matrix.inverse();
    let last: unknown = null;
    track((ev2) => {
      const p = toComp(ev2), q = inv.transformPoint(new DOMPoint(p[0], p[1]));
      const [fx, fy] = h.from ?? [0, 0];
      last = h.kind === 'distance' ? Math.round(Math.hypot(q.x - fx, q.y - fy) * (h.factor ?? 1) * 10) / 10 : [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10];
      draft(opsFor(id, h.prop, last));
    }, () => { if (last !== null) commit(t('viewport.editName', { name: t(g.layer.node.props[h.prop]?.label ?? h.prop) }), opsFor(id, h.prop, last)); else cancelDraft(); });
  };

  // ── a path property's vertices and tangents, and the anchor ──
  /** the path properties of the selected layer's node, then its masks' paths, with their value at the current time */
  const pathsOf = (g: Geo): [string, PathValue][] => {
    const out: [string, PathValue][] = [];
    for (const [name, def] of Object.entries(g.layer.node.props)) {
      if (def.type !== 'path') continue;
      const pv = g.layer.props[name] as PathValue | undefined;
      if (pv && Array.isArray(pv.v) && pv.v.length) out.push([name, pv]);
    }
    for (const mk of g.layer.masks ?? []) {
      const pv = mk.props.path as PathValue | undefined;
      if (pv && Array.isArray(pv.v) && pv.v.length) out.push([`masks.${mk.id}.path`, pv]);
    }
    return out;
  };

  const dragVertex = (e: PointerEvent, g: Geo, prop: string, pv: PathValue, i: number) => {
    const id = selected[0];
    if (!canEdit(id, prop)) return;
    e.stopPropagation();
    setVertex(i, prop);
    const inv = g.matrix.inverse();
    const a = inv.transformPoint(new DOMPoint(...toComp(e)));
    let last: PathValue | null = null;
    track((ev2) => {
      const q = inv.transformPoint(new DOMPoint(...toComp(ev2)));
      last = movePathVertex(pv, i, [q.x - a.x, q.y - a.y]);
      draft(opsFor(id, prop, last));
    }, () => { if (last) commit(t('viewport.editName', { name: labelOf(g, prop) }), opsFor(id, prop, last)); else cancelDraft(); });
  };

  const dragTangent = (e: PointerEvent, g: Geo, prop: string, pv: PathValue, i: number, which: 'i' | 'o') => {
    const id = selected[0];
    if (!canEdit(id, prop)) return;
    e.stopPropagation();
    setVertex(i, prop);
    const inv = g.matrix.inverse();
    const a = inv.transformPoint(new DOMPoint(...toComp(e)));
    const t0 = (which === 'i' ? pv.i?.[i] : pv.o?.[i]) ?? [0, 0];
    let last: PathValue | null = null;
    track((ev2) => {
      const q = inv.transformPoint(new DOMPoint(...toComp(ev2)));
      // Shift keeps the two tangents mirrored
      last = setPathTangent(pv, i, which, [t0[0] + q.x - a.x, t0[1] + q.y - a.y], ev2.shiftKey);
      draft(opsFor(id, prop, last));
    }, () => { if (last) commit(t('viewport.editName', { name: labelOf(g, prop) }), opsFor(id, prop, last)); else cancelDraft(); });
  };

  /** the anchor cross: without Alt the layer stays put on screen (position compensates); Alt moves the anchor alone */
  const dragAnchor = (e: PointerEvent, g: Geo, alone: boolean) => {
    const id = selected[0];
    if (!canEdit(id, 'transform.anchor')) return;
    e.stopPropagation();
    const driven = ['transform.position', 'transform.rotation', 'transform.scale', 'transform.anchor']
      .some((n) => { const k = propKind(rawProp(S.doc.peek(), compId, id, n)); return k === 'keyframes' || k === 'expression' || k === 'link'; });
    if (driven && !alone) { toast(t('viewport.anchorStaysPut')); return; }
    const tr = g.layer.transform;
    const inv = g.matrix.inverse();
    const a = inv.transformPoint(new DOMPoint(...toComp(e)));
    let ops: ReturnType<typeof opsFor> | null = null;
    track((ev2) => {
      const q = inv.transformPoint(new DOMPoint(...toComp(ev2)));
      const d: Vec2 = [Math.round((q.x - a.x) * 10) / 10, Math.round((q.y - a.y) * 10) / 10];
      const anchor: Vec2 = [Math.round((tr.anchor[0] + d[0]) * 10) / 10, Math.round((tr.anchor[1] + d[1]) * 10) / 10];
      const s = anchorShift(tr.rotation, tr.scale, d);
      const position: Vec2 = [Math.round((tr.position[0] + s[0]) * 10) / 10, Math.round((tr.position[1] + s[1]) * 10) / 10];
      ops = [...opsFor(id, 'transform.anchor', anchor), ...(alone ? [] : opsFor(id, 'transform.position', position))];
      draft(ops);
    }, () => { if (ops) commit(t('viewport.moveAnchor'), ops); else cancelDraft(); });
  };

  /** Alt+click on the path's stroke adds a vertex there; Delete takes the selected one out */
  const addVertex = (e: PointerEvent, g: Geo, prop: string, pv: PathValue) => {
    if (!canEdit(selected[0], prop)) return;
    e.stopPropagation();
    const q = g.matrix.inverse().transformPoint(new DOMPoint(...toComp(e)));
    const hit = nearestOnPath(pv, [q.x, q.y]);
    if (!hit) return;
    commit(t('viewport.addAVertex'), opsFor(selected[0], prop, insertPathVertex(pv, hit.seg, hit.u)));
    setVertex(hit.seg + 1, prop);
  };

  // Delete takes the selected path vertex out, before the layers' own shortcut sees the key
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (vertex === null || !geo || e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      const [prop, pv] = pathsOf(geo).find(([name]) => name === vertexPath) ?? pathsOf(geo)[0] ?? [];
      if (!prop || !pv) return;
      e.stopPropagation();
      commit(t('viewport.removeAVertex'), opsFor(selected[0], prop, removePathVertex(pv, vertex)));
      setVertex(null);
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  });

  /** move the view; `tap` runs when the pointer was released without moving (a tap on the background) */
  const dragPan = (e: PointerEvent, tap?: () => void) => {
    const x0 = e.clientX, y0 = e.clientY, p0 = pan.value;
    let moved = false;
    track((ev2) => {
      if (!moved && Math.hypot(ev2.clientX - x0, ev2.clientY - y0) < 6) return;
      moved = true;
      pan.value = [p0[0] + ev2.clientX - x0, p0[1] + ev2.clientY - y0];
    }, () => { if (!moved) tap?.(); });
  };

  // ── touch: two fingers pinch to zoom and move the view ─────────
  const touches = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ d0: number; s0: number; u: Vec2 } | null>(null);
  const mid = (): Vec2 => {
    const r = host.current!.getBoundingClientRect(), pts = [...touches.current.values()];
    return [pts.reduce((n, p) => n + p[0], 0) / pts.length - r.left, pts.reduce((n, p) => n + p[1], 0) / pts.length - r.top];
  };
  const dist = () => { const [a, b] = [...touches.current.values()]; return Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])); };
  const touchDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.current.size < 2) return;
    // the first finger may have started a drag: drop it, the gesture is a pinch
    e.stopPropagation(); abortDrag?.();
    const m = mid();
    pinch.current = { d0: dist(), s0: scale, u: [(m[0] - left) / scale, (m[1] - top) / scale] };
  };
  const touchMove = (e: PointerEvent) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = pinch.current;
    if (!g || touches.current.size < 2) return;
    const s = Math.min(8, Math.max(0.05, (g.s0 * dist()) / g.d0)), m = mid(), o = origin(c.width * s, c.height * s);
    zoom.value = s;
    pan.value = [m[0] - g.u[0] * s - o[0], m[1] - g.u[1] * s - o[1]];
  };
  const touchUp = (e: PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    // a colour field waiting: this click picks the pixel under it
    const waiting = picking.peek();
    if (waiting && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      // drawn once more and read at once: the WebGL canvas keeps nothing between tasks
      try { preview.renderer?.render(uiTime.peek()); } catch { /* the last picture, then */ }
      waiting(pixelAt(preview.canvas, e.clientX, e.clientY));
      preview.invalidate();
      return;
    }
    if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); dragPan(e); return; }
    if (e.button !== 0 || S.draft.peek()) return;
    const p = toComp(e);
    if (intercept?.(p, e, () => pick(p), toComp)) return;
    if (geo && selected.length === 1 && inside(geo, p) && !e.altKey) { dragMove(e, selected[0], geo); return; }
    const id = pick(p);
    if (!id && e.pointerType === 'touch') { dragPan(e, () => { if (!e.shiftKey) select([]); }); return; }
    if (!id) { if (!e.shiftKey) select([]); return; }
    if (e.shiftKey) { select(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]); return; }
    select([id]);
    const g = geometry(ev, c, compId, id, now);
    if (g) dragMove(e, id, g);
  };

  const onMove = (e: PointerEvent) => {
    if (e.buttons || bare) return;
    const id = pick(toComp(e));
    setHover(id && !selected.includes(id) ? id : null);
  };

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    const next = Math.min(8, Math.max(0.05, scale * k));
    zoom.value = next;
  };

  const zoomMenu = (e: MouseEvent) => openMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), [
    { label: t('viewport.fit'), hint: t('viewport.shift1'), onClick: () => { zoom.value = 'fit'; pan.value = [0, 0]; } },
    ...[0.25, 0.5, 1, 2].map((z) => ({ label: `${z * 100} %`, onClick: () => { zoom.value = z; } })),
  ]);

  /** the onion skin of a selected drawn-animation layer: the drawings either side of the current one, tinted, at rest only */
  const onionSkin = () => {
    if (!onion || S.playing.value || S.draft.value || !geo) return null;
    const id = selected[0];
    if (c.layers[id]?.type !== 'sequence') return null;
    const p = geo.layer.props as unknown as { frames: string[]; hold: number; sheet: string; loop: 'loop' | 'once' | 'pingpong'; offset: number; drawing: number; size: [number, number]; fit: 'contain' | 'cover' | 'fill' | 'none' };
    if (!Array.isArray(p.frames) || !p.frames.length) return null;
    const { prev, next } = neighbourDrawings({ ...p, count: p.frames.length }, localFrame(now, c.layers[id].in ?? 0, c.fps));
    const side = (di: number, filter: string, key: string) => {
      if (di < 0) return null;
      const asset = p.frames[di];
      const img = assetData(asset) as { width: number; height: number } | undefined;
      if (!img?.width || !img?.height) return null;
      let url: string;
      try { url = preview.renderer!.assets.url(asset); } catch { return null; }
      const r = drawingRect(p.fit, p.size[0], p.size[1], img.width, img.height);
      if (!r) return null;
      return <image key={key} href={url} x={r.x} y={r.y} width={r.w} height={r.h}
        transform={`matrix(${geo.matrix.a}, ${geo.matrix.b}, ${geo.matrix.c}, ${geo.matrix.d}, ${geo.matrix.e}, ${geo.matrix.f})`}
        style={{ opacity: 0.4, filter }} />;
    };
    // the convention: what came before in red, what comes next in green
    return <g>{side(prev, 'grayscale(1) sepia(1) hue-rotate(-45deg) saturate(5)', 'p')}{side(next, 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(4)', 'n')}</g>;
  };

  const hoverGeo = hover ? geometry(ev, c, compId, hover, now) : null;
  const pending = S.proposal.value?.status === 'pending' && previewDoc.value;
  const handleR = (coarse ? 11 : 5) / scale;
  const grid = S.grid.value, safe = S.safe.value, onion = S.onion.value;

  return (
    <div class={`viewport${bare ? ' bare' : ''}`} data-tour="viewport" ref={host} onWheel={onWheel} onPointerDownCapture={touchDown} onPointerMove={touchMove} onPointerUp={touchUp} onPointerCancel={touchUp} style={{ cursor: spaceDown ? 'grab' : undefined }}>
      {!bare && grading() && <Scopes />}
      {!bare && <div class="toolbar" data-tour="viewport-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button class="zoom" onClick={zoomMenu} title={t('viewport.zoomCtrlWheel')}>{Math.round(scale * 100)} %</button>
        <span class="sep" />
        <button class={`icon-btn sm round${safe ? ' on' : ''}`} title={t('viewport.safeZones')} onClick={() => { S.safe.value = !safe; }}><Icon name="safe" /></button>
        <button class={`icon-btn sm round${grid ? ' on' : ''}`} title={t('viewport.grid')} onClick={() => { S.grid.value = !grid; }}><Icon name="grid" /></button>
        <button class={`icon-btn sm round${onion ? ' on' : ''}`} title={t('viewport.onionSkin')} onClick={() => { S.onion.value = !onion; }}><Icon name="onion" /></button>
        <span class="sep" />
        <QualityButton />
      </div>}
      <div class={`stage${picking.value ? ' picking' : ''}`} ref={stageRef} style={{ left, top, width: sw, height: sh }} onPointerDown={onPointerDown} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg class="overlay" ref={svgRef} viewBox={`0 0 ${c.width} ${c.height}`} preserveAspectRatio="none">
          {grid && <g>
            {[1, 2].map((i) => <line key={`v${i}`} class="grid-line" x1={(c.width * i) / 3} y1={0} x2={(c.width * i) / 3} y2={c.height} />)}
            {[1, 2].map((i) => <line key={`h${i}`} class="grid-line" x1={0} y1={(c.height * i) / 3} x2={c.width} y2={(c.height * i) / 3} />)}
            <line class="grid-line" x1={c.width / 2 - 20 / scale} y1={c.height / 2} x2={c.width / 2 + 20 / scale} y2={c.height / 2} />
            <line class="grid-line" x1={c.width / 2} y1={c.height / 2 - 20 / scale} x2={c.width / 2} y2={c.height / 2 + 20 / scale} />
          </g>}
          {safe && safeZones(c).map((z) => <g key={z.label}>
            <rect class="safe-line" x={z.rect.x} y={z.rect.y} width={z.rect.w} height={z.rect.h} />
            <text class="safe-label" x={z.rect.x + 6 / scale} y={z.rect.y - 6 / scale} style={{ fontSize: 10 / scale }}>{z.label}</text>
          </g>)}
          {onionSkin()}
          {hoverGeo && <polygon class="gizmo-hover" points={poly(outline(hoverGeo, c))} />}
          {!bare && selected.length > 1 && selected.map((id) => { const g = geometry(ev, c, compId, id, now); return g && <polygon key={id} class="gizmo-box" points={poly(outline(g, c))} />; })}
          {geo && (() => {
            const pts = outline(geo, c);
            const tr = geo.layer.transform;
            const anchor = apply(geo.parent, tr.position);
            const topMid: Vec2 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
            const up = apply(geo.matrix, [geo.bounds.x + geo.bounds.w / 2, geo.bounds.y]);
            const dir = Math.hypot(up[0] - anchor[0], up[1] - anchor[1]) > 1 ? [up[0] - anchor[0], up[1] - anchor[1]] : [0, -1];
            const n = Math.hypot(dir[0], dir[1]);
            const rot: Vec2 = [topMid[0] + (dir[0] / n) * (coarse ? 38 : 26) / scale, topMid[1] + (dir[1] / n) * (coarse ? 38 : 26) / scale];
            return <g>
              <polygon class="gizmo-box" points={poly(pts)} />
              <line class="gizmo-box" x1={topMid[0]} y1={topMid[1]} x2={rot[0]} y2={rot[1]} />
              <circle class="gizmo-handle" cx={rot[0]} cy={rot[1]} r={handleR} style={{ cursor: 'grab' }} onPointerDown={(e) => dragRotate(e as unknown as PointerEvent, geo)} />
              {corners(geo.bounds).map((cn, i) => {
                const p = pts[i];
                return <rect key={i} class="gizmo-handle" x={p[0] - handleR} y={p[1] - handleR} width={handleR * 2} height={handleR * 2} style={{ cursor: i % 2 ? 'nesw-resize' : 'nwse-resize' }} onPointerDown={(e) => dragScale(e as unknown as PointerEvent, geo, cn)} />;
              })}
              {(() => { try { return geo.layer.node.handles?.(geo.layer.props as never) ?? []; } catch { return []; } })().map((h, i) => {
                const p = apply(geo.matrix, h.at);
                return <rect key={`h${i}`} class="gizmo-handle node-handle" x={p[0] - handleR} y={p[1] - handleR} width={handleR * 2} height={handleR * 2} transform={`rotate(45 ${p[0]} ${p[1]})`} style={{ cursor: 'move' }} onPointerDown={(e) => dragHandle(e as unknown as PointerEvent, geo, h)}><title>{t(geo.layer.node.props[h.prop]?.label ?? h.prop)}</title></rect>;
              })}
              {pathsOf(geo).map(([prop, pv]) => <g key={prop}>
                {/* the outline itself; a fat invisible stroke over it catches the Alt+click that adds a vertex */}
                <path class="gizmo-outline" d={pathD(pv)} transform={`matrix(${geo.matrix.a}, ${geo.matrix.b}, ${geo.matrix.c}, ${geo.matrix.d}, ${geo.matrix.e}, ${geo.matrix.f})`} />
                <path d={pathD(pv)} transform={`matrix(${geo.matrix.a}, ${geo.matrix.b}, ${geo.matrix.c}, ${geo.matrix.d}, ${geo.matrix.e}, ${geo.matrix.f})`}
                  fill="none" stroke="transparent" stroke-width={12} style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
                  onPointerDown={(e) => { if (e.altKey) addVertex(e as unknown as PointerEvent, geo, prop, pv); }} />
                {pv.v.map((pt, i) => {
                  const p = apply(geo.matrix, pt);
                  return <rect key={`v${i}`} class={`gizmo-handle path-handle${vertex === i && vertexPath === prop ? ' on' : ''}${prop.startsWith('masks.') ? ' mask-handle' : ''}`} x={p[0] - handleR} y={p[1] - handleR} width={handleR * 2} height={handleR * 2} transform={`rotate(45 ${p[0]} ${p[1]})`} style={{ cursor: 'move' }}
                    onPointerDown={(e) => dragVertex(e as unknown as PointerEvent, geo, prop, pv, i)}><title>{`${prop} · ${i + 1}`}</title></rect>;
                })}
                {vertex !== null && vertexPath === prop && pv.v[vertex] && (['i', 'o'] as const).map((which) => {
                  const t = (which === 'i' ? pv.i?.[vertex] : pv.o?.[vertex]) ?? [0, 0];
                  const from = apply(geo.matrix, pv.v[vertex]);
                  const to = apply(geo.matrix, [pv.v[vertex][0] + t[0], pv.v[vertex][1] + t[1]]);
                  return <g key={which}>
                    <line class="gizmo-tangent" x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
                    <circle class="gizmo-handle tangent-handle" cx={to[0]} cy={to[1]} r={handleR * 0.8} style={{ cursor: 'move' }}
                      onPointerDown={(e) => dragTangent(e as unknown as PointerEvent, geo, prop, pv, vertex, which)} />
                  </g>;
                })}
              </g>)}
              <g style={{ cursor: 'move' }} onPointerDown={(e) => dragAnchor(e as unknown as PointerEvent, geo, e.altKey)}>
                <circle class="gizmo-anchor" cx={anchor[0]} cy={anchor[1]} r={4 / scale} />
                <line class="gizmo-anchor" x1={anchor[0] - 7 / scale} y1={anchor[1]} x2={anchor[0] + 7 / scale} y2={anchor[1]} />
                <line class="gizmo-anchor" x1={anchor[0]} y1={anchor[1] - 7 / scale} x2={anchor[0]} y2={anchor[1] + 7 / scale} />
                <circle cx={anchor[0]} cy={anchor[1]} r={Math.max(handleR, 8 / scale)} fill="transparent" stroke="none" />
              </g>
            </g>;
          })()}
        </svg>
        {overlay}
      </div>
      {!preview.renderer && !S.renderError.value && <div class="loading">{t('viewport.loadingAssets')}</div>}
      {S.renderError.value && <div class="error">{S.renderError.value}</div>}
      {pending && !bare && (
        <div class="banner ai">
          <Icon name="chat" />
          <span class="label">{S.showProposal.value ? t('viewport.proposalPreview') : t('viewport.proposalHidden')} : {S.proposal.value!.label}</span>
          <button class="btn sm ghost" onClick={() => { S.showProposal.value = !S.showProposal.value; }}>{S.showProposal.value ? t('viewport.showOriginal') : t('viewport.showProposal')}</button>
          <button class="btn sm" onClick={() => decide(false)}>{t('common.decline')}</button>
          <button class="btn sm primary" onClick={() => decide(true)}>{t('common.apply')}</button>
        </div>
      )}
    </div>
  );
}

let abortDrag: (() => void) | null = null;

/** follow the pointer until release (or until the system takes the touch over) */
function track(move: (e: PointerEvent) => void, end: () => void) {
  const stop = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); abortDrag = null; };
  const up = () => { stop(); end(); };
  abortDrag = () => { stop(); cancelDraft(); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

