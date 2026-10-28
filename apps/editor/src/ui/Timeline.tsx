// Transport and timeline: one row per layer (its clip from in to out, its
// keyframes summarised), expandable into one row per animated property.
// Clips move and trim, keyframes select and drag, all snapped to frames.
// A transition is put on a cut from a clip's menu; its band over the start of
// the incoming clip drags its length.

import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { applyOps, chapterList, chaptersOf, cutsOf, isLocked, layerActive, pointer, rippleTrimOps, rollOps, slideOps, slipOps, staticValue, toSequenceOps, type Composition, type Keyframe, type Layer, type Op, type SequenceTrack } from '@tramme/core';
import { clickSelect, comp, commit, draft, cancelDraft, S, select, selectAll, setTime, frameStep, toast, toggleFold, uiTime, viewDoc } from '../state.ts';
import { animatedProps, contentEnd, crossfadeOps, flatTree, freshId, keysOf, layerName, parentOf, parseTime, propPath, rawProp, rulerLabel, shiftLayerOps, snap, splitLayerOps, subtree, timecode, topLayers, trimInOps, type TreeItem } from '../model.ts';
import { bandOf, longPress, noBrowserMenu, openMenu, Seg, useSize } from './controls.tsx';
import { Icon, kindColor, kindIcon } from './icons.tsx';
import { fileLength, preview } from '../preview.ts';
import { Tabs } from './timeline/Tabs.tsx';
import { syncClips } from '../sync.ts';
import { makeMulticam } from './Multicam.tsx';
import { FILM_H, FILM_W, filmThumb, filmVersion } from '../filmstrip.ts';
import { GraphEditor } from './GraphEditor.tsx';
import { addLayerMenu, FoldButtons, openLayerMenu } from './LeftPanel.tsx';
import { peaksOf, wavePath, wavesReady } from '../waveforms.ts';
import { m, t, tr } from '../i18n/index.ts';
import { outgoingOf, TRANSITION_KINDS, transitionOf, transitionPlan, type TransitionKind } from '../transitions.ts';
import { laneHeight, TrackHeader } from './timeline/Tracks.tsx';
import { addTrackOps, clipsOn, laneOrder, moveToTrackOps } from './timeline/tracks.ts';
import { dropOps } from './timeline/clipDrag.ts';
import { ASSET_MIME, COMP_MIME } from './timeline/assets-drag.ts';
import { placeAsset, placeComp } from './timeline/place.ts';

export const pps = signal(0);              // pixels per second (0: fit)
const expanded = signal<Set<string>>(new Set());

const TRACK_PAD = 12;
/** how close (px) an edge comes to a target before it snaps on it */
const SNAP_PX = 8;

/** where moved edges snap: the start and end, the playhead, the markers, the edges of the clips not moving */
function snapTargets(c: Composition, moving: Set<string>): number[] {
  const ts = [0, c.duration, S.time.peek(), ...(c.markers ?? []).map((m) => m.t)];
  for (const [id, l] of Object.entries(c.layers)) if (!moving.has(id)) ts.push(l.in ?? 0, l.out ?? c.duration);
  return ts;
}

/** the shift putting the nearest edge on a target within `tol` seconds, and that target (null when none is close) */
function snapShift(edges: number[], targets: number[], tol: number): { d: number; at: number | null } {
  let best = tol, d = 0, at: number | null = null;
  for (const e of edges) for (const x of targets) if (Math.abs(x - e) < best) { best = Math.abs(x - e); d = x - e; at = x; }
  return { d, at };
}

// ── transport ────────────────────────────────────────────────
export function Transport() {
  const c = comp.value, now = S.time.value, playing = S.playing.value;
  const [text, setText] = useState<string | null>(null);
  const frames = Math.round(c.duration * c.fps);
  const tab = S.bottomTab.value;
  return (
    <div class="transport" data-tour="transport" onContextMenu={noBrowserMenu}>
      <div class="controls">
        <button class="icon-btn" data-step="start" title={t('timeline.startHome')} onClick={() => setTime(0)}><Icon name="start" /></button>
        <button class="icon-btn" title={t('timeline.previousFrame')} onClick={() => frameStep(-1)}><Icon name="prev" /></button>
        <button class="icon-btn play" title={t('timeline.playSpace')} onClick={() => { S.playing.value = !playing; }}><Icon name={playing ? 'pause' : 'play'} /></button>
        <button class="icon-btn" title={t('timeline.nextFrame')} onClick={() => frameStep(1)}><Icon name="next" /></button>
        <button class="icon-btn" data-step="end" title={t('timeline.endEnd')} onClick={() => setTime(c.duration)}><Icon name="end" /></button>
        <button class={`icon-btn${S.loop.value ? ' on' : ''}`} title={t('timeline.loop')} onClick={() => { S.loop.value = !S.loop.value; }}><Icon name="loop" /></button>
      </div>
      <Tabs />
      <div class="timecode">
        <input value={text ?? timecode(now, c.fps)} title={t('timeline.timeSFrame8')}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={() => { if (text !== null) { const v = parseTime(text, c.fps); if (v !== null) setTime(v); } setText(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') setText(null); (e.target as HTMLInputElement).blur(); } }} />
        <span class="total">{t('common.frameDoneTotal', { done: Math.min(frames, Math.round(now * c.fps) + 1), total: frames })}<span class="fps"> · {t('common.nFps', { n: c.fps })}</span></span>
      </div>
      <span class="grow" />
      <Seg value={tab} role="tablist"
        options={[
          { value: 'timeline', label: t('common.timeline'), icon: 'timeline', tour: 'bottom-tab-timeline' },
          { value: 'graph', label: t('common.curves'), icon: 'curve', tour: 'bottom-tab-graph' },
        ]}
        onChange={(v) => { S.bottomTab.value = v as 'timeline' | 'graph'; }} />
      <div class="tl-zoom" title={t('timeline.timelineZoomCtrlWheel')}>
        <Icon name="minus" size={12} />
        <input type="range" min={0} max={100} value={zoomToSlider(c)} onInput={(e) => { pps.value = sliderToZoom(c, Number((e.target as HTMLInputElement).value)); }} />
        <Icon name="plus" size={12} />
      </div>
      <span class="render-ms faint mono" style={{ fontSize: 10.5, minWidth: 54, textAlign: 'right' }} title={t('timeline.lastRenderTime')}>{preview.lastMs ? `${preview.lastMs.toFixed(0)} ms` : ''}</span>
    </div>
  );
}

let fitPps = 100;
const zoomToSlider = (c: Composition) => { const z = pps.value || fitPps; return Math.round((Math.log(z / fitPps) / Math.log(c.fps * 40 / fitPps)) * 100) || 0; };
const sliderToZoom = (c: Composition, s: number) => (s <= 0 ? 0 : fitPps * Math.pow(c.fps * 40 / fitPps, s / 100));

// ── timeline ─────────────────────────────────────────────────
interface Row { kind: 'layer'; item: TreeItem }
interface PropRowT { kind: 'prop'; item: TreeItem; name: string; keys: Keyframe[] }
/** a lane of a sequence: its clips side by side in one row */
interface TrackRowT { kind: 'track'; track: SequenceTrack; ids: string[] }
type AnyRow = Row | PropRowT | TrackRowT;

const PROP_LABEL: Record<string, string> = { 'transform.position': m('timeline.position'), 'transform.scale': m('timeline.scale'), 'transform.rotation': m('timeline.rotation'), 'transform.opacity': m('timeline.opacity'), 'transform.anchor': m('timeline.anchor') };
export function propLabel(type: string, name: string): string {
  if (PROP_LABEL[name]) return t(PROP_LABEL[name]);
  const reg = S.registry.peek();
  return tr(reg.hasNode(type) ? reg.node(type).props[name]?.label : undefined) || name;
}

function rulerStep(pxPerSec: number, fps: number): [number, number] {
  const steps = [1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 30, 60];
  const major = steps.find((s) => s * pxPerSec >= 70) ?? 60;
  const minor = steps.slice().reverse().find((s) => s < major && s * pxPerSec >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) ?? major;
  return [major, minor];
}

export function Timeline() {
  const c = comp.value, doc = viewDoc.value, now = uiTime.value, compId = S.compId.value;
  const tracks = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [scroll, setScroll] = useState(0);
  const [namesW, namesHandle] = useSize('tl.names', 220, 140, 420);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(tracks.current!);
    return () => ro.disconnect();
  }, []);
  fitPps = Math.max(1, (width - TRACK_PAD * 2) / c.duration);
  const k = pps.value || fitPps;
  const X = (time: number) => TRACK_PAD + time * k;
  const T = (x: number) => (x - TRACK_PAD) / k;
  const total = X(c.duration) + TRACK_PAD;

  const rows: AnyRow[] = [];
  // a sequence: its layers without a track first (titles, shapes), then its lanes, the picture tracks top first, the sound tracks last
  const lanes = c.tracks ? laneOrder(c) : [];
  const videoLanes = lanes.filter((l) => l.kind === 'video'), audioLanes = lanes.filter((l) => l.kind === 'audio');
  for (const item of flatTree(c, S.collapsed.value)) {
    if (item.layer.track && lanes.length) continue;
    rows.push({ kind: 'layer', item });
    if (expanded.value.has(item.id)) for (const [name, keys] of animatedProps(item.layer)) rows.push({ kind: 'prop', item, name, keys });
  }
  if (lanes.length) {
    const at = rows.length;
    rows.splice(at, 0, ...videoLanes.map((track): AnyRow => ({ kind: 'track', track, ids: clipsOn(c, track.id) })));
    rows.push(...audioLanes.map((track): AnyRow => ({ kind: 'track', track, ids: clipsOn(c, track.id) })));
  }
  const sel = S.selection.value, keySel = S.keys.value;
  const fps = c.fps;
  const order = rows.flatMap((r) => (r.kind === 'layer' ? [r.item.id] : r.kind === 'track' ? r.ids : []));
  const [snapAt, setSnapAt] = useState<number | null>(null);
  /** the lane an asset of the media panel is being dragged over */
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── interactions ───────────────────────────────────────────
  const scrubFrom = (e: PointerEvent) => {
    // the right button opens the ruler's menu, it does not move the playhead
    if (e.button !== 0) return;
    const r = tracks.current!.getBoundingClientRect();
    const at = (ev: PointerEvent) => setTime(snap(T(ev.clientX - r.left + tracks.current!.scrollLeft), fps));
    at(e);
    S.playing.value = false;
    const move = (ev: PointerEvent) => at(ev);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /** a click in an empty part of the tracks sets the time; a drag draws a lasso over the clips and keyframes it touches
   *  (Shift: added to the selection, Ctrl/Cmd: theirs flips). Mouse and pen: a finger keeps scrolling. */
  const emptyDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const el = tracks.current!, r = el.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY, adding = e.shiftKey, toggling = e.ctrlKey || e.metaKey;
    const baseLayers = adding || toggling ? S.selection.peek() : [], baseKeys = adding || toggling ? S.keys.peek() : [];
    const picked = (base: string[], ids: string[]) => {
      const out = new Set(base);
      for (const id of ids) toggling && out.has(id) ? out.delete(id) : out.add(id);
      return [...out];
    };
    let banding = false;
    const move = (ev: PointerEvent) => {
      if (!banding && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      banding = true;
      const { band, ids: clips } = bandOf(el, { clientX: x0, clientY: y0 }, ev, '.clip[data-layer]', 'data-layer');
      const keys = bandOf(el, { clientX: x0, clientY: y0 }, ev, '.kf[data-key]', 'data-key').ids;
      setBand({ x: band.l - r.left + el.scrollLeft, y: band.t - r.top + el.scrollTop, w: band.r - band.l, h: band.b - band.t });
      select(picked(baseLayers, clips));
      S.keys.value = picked(baseKeys, keys);
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setBand(null);
      if (banding) return;
      S.keys.value = [];
      S.playing.value = false;
      setTime(snap(T(ev.clientX - r.left + el.scrollLeft), fps));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /** moves the clip, with the other selected ones, or trims it; its edges snap (Shift held: free) */
  const dragClip = (e: PointerEvent, id: string, mode: 'move' | 'in' | 'out') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    // Shift on an edge rolls the cut; Alt on a clip slips its file, Ctrl+Alt slides it between its neighbours (clips on a track only)
    const onTrack = !!c.layers[id]?.track, ctrlAlt = (e.ctrlKey || e.metaKey) && e.altKey;
    const tool: 'roll' | 'slip' | 'slide' | null = !onTrack ? null : mode !== 'move' ? (e.shiftKey ? 'roll' : null) : e.altKey ? (ctrlAlt ? 'slide' : 'slip') : null;
    if (!tool && (e.shiftKey || e.ctrlKey || e.metaKey)) { clickSelect(e, id, order); return; }
    if (!sel.includes(id)) select([id]);
    const x0 = e.clientX, d0 = S.doc.peek(), c0 = d0.compositions[compId], l = c0.layers[id];
    if (isLocked(c0, id)) { toast(t('timeline.trackLocked'), 'error'); return; }
    // a layer inside a selected group goes with it
    const moving = mode === 'move' && sel.includes(id) ? topLayers(c0, sel) : [id];
    const targets = snapTargets(c0, new Set(moving.flatMap((x) => subtree(c0, x))));
    const tin = l.in ?? 0, tout = l.out ?? c0.duration;
    const edges = mode === 'move' ? moving.flatMap((x) => [c0.layers[x].in ?? 0, c0.layers[x].out ?? c0.duration]) : [mode === 'in' ? tin : tout];
    const earliest = Math.min(...moving.map((x) => c0.layers[x].in ?? 0));
    // on a magnetic track a drag lets the clip fall among the others and a trim ripples the track
    const magnetic = !!l.track && !!c0.tracks?.find((x) => x.id === l.track)?.magnetic;
    let ops: Op[] = [], lastDt = 0;
    const move = (ev: PointerEvent) => {
      let dt = (ev.clientX - x0) / k;
      const s = ev.shiftKey ? { d: 0, at: null } : snapShift(edges.map((x) => x + dt), targets, SNAP_PX / k);
      dt = s.at === null ? snap(dt, fps) : dt + s.d;
      setSnapAt(s.at);
      lastDt = dt;
      const cut = tool === 'roll' ? cutsOf(c0, l.track!).find((x) => (mode === 'in' ? x.right : x.left) === id) : undefined;
      if (tool) {
        const by = snap(dt, fps);
        ops = tool === 'slip' ? slipOps(d0, compId, id, -by, fileLength) : tool === 'slide' ? slideOps(d0, compId, id, by) : cut ? rollOps(d0, compId, cut.left, cut.right, cut.at + by, fileLength) : [];
      } else if (mode === 'move') {
        dt = Math.max(dt, -earliest);
        ops = dt ? moving.flatMap((x) => shiftLayerOps(d0, compId, x, dt)) : [];
      } else if (magnetic) {
        ops = rippleTrimOps(d0, compId, id, mode, mode === 'in' ? tin + dt : tout + dt, fileLength);
      } else {
        const lp = pointer('compositions', compId, 'layers', id);
        if (mode === 'in') {
          // a video, a sound or a composition trims in its source: the edge carries
          // the start with it, so the head cut off stops playing
          ops = trimInOps(d0, compId, id, Math.min(tout - 1 / fps, Math.max(0, tin + dt)));
        } else {
          ops = [{ op: 'add', path: `${lp}/out`, value: +Math.max(tin + 1 / fps, tout + dt).toFixed(4) }];
        }
      }
      if (ops.length) draft(ops); else cancelDraft();
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setSnapAt(null);
      // dropped on another lane of a sequence: the clip changes track, where it is in time
      const lane = !tool && mode === 'move' && moving.length === 1 ? document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.track)?.getAttribute('data-track') : null;
      if (!tool && mode === 'move' && magnetic && !lane) ops = dropOps(d0, compId, moving, lastDt);
      else if (lane && lane !== l.track) ops = [...ops, ...moveToTrackOps(ops.length ? applyOps(d0, ops).doc : d0, compId, id, lane)];
      if (!ops.length) { cancelDraft(); return; }
      const label = tool ? t(TOOL_LABEL[tool]) : mode === 'in'
        ? (ops.length > 1 && l.type === 'video' ? t('timeline.trimVideoInFile') : t('common.inPoint'))
        : mode === 'out' ? t('common.outPoint') : moving.length > 1 ? t('timeline.moveNClips', { n: moving.length }) : t('timeline.moveInTime');
      commit(label, ops);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const keyId = (id: string, name: string, i: number) => `${id}|${name}|${i}`;
  const dragKey = (e: PointerEvent, id: string, name: string, i: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const kid = keyId(id, name, i);
    let chosen = keySel.includes(kid) ? keySel : e.shiftKey ? [...keySel, kid] : [kid];
    S.keys.value = chosen;
    const x0 = e.clientX, d0 = S.doc.peek();
    let ops: Op[] = [];
    // a long press of a finger opens the menu and ends the drag: the press
    // itself moves nothing, and neither does the finger once the menu is up
    let menued = false;
    const stopPress = longPress(e, (pos) => { menued = true; keyMenu(pos, id, name, i); });
    const move = (ev: PointerEvent) => {
      if (menued) return;
      const dt = snap((ev.clientX - x0) / k, fps);
      ops = dt ? moveKeysOps(d0, compId, chosen, dt) : [];
      if (ops.length) draft(ops); else cancelDraft();
    };
    const up = () => {
      stopPress();
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (menued) return;
      if (ops.length) {
        commit(chosen.length > 1 ? t('timeline.moveNKeyframes', { n: chosen.length }) : t('timeline.moveKeyframe'), ops);
        // indexes change once keys are re-sorted: clear the selection
        S.keys.value = [];
      } else cancelDraft();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const keyMenu = (e: MouseEvent | { clientX: number; clientY: number }, id: string, name: string, i: number) => {
    if ('preventDefault' in e) e.preventDefault();
    const kid = keyId(id, name, i);
    const chosen = keySel.includes(kid) ? keySel : [kid];
    S.keys.value = chosen;
    const eases: [string, unknown][] = [[t('common.linear'), 'linear'], [t('common.hold'), 'hold'],
      ...Object.entries(doc.tokens).filter(([, tk]) => tk.type === 'ease').map(([n]) => [n, `@${n}`] as [string, unknown])];
    const at = keysOf(rawProp(doc, compId, id, name))?.[i]?.t;
    openMenu(e, [
      ...(at !== undefined ? [{ label: t('timeline.goToKey'), icon: 'target' as const, onClick: () => setTime(at) }, 'sep' as const] : []),
      { section: t('timeline.curveToTheNext') },
      ...eases.map(([label, v]) => ({ label: String(label), onClick: () => commit(t('common.curve'), easeOps(S.doc.peek(), compId, chosen, v)) })),
      'sep',
      { label: t('common.delete'), icon: 'trash', hint: t('common.del'), onClick: () => deleteKeys() },
    ]);
  };

  // ── the right click: the timeline's own menus, never the browser's ──
  const timeAt = (x: number) => snap(Math.max(0, Math.min(c.duration, T(x - tracks.current!.getBoundingClientRect().left + tracks.current!.scrollLeft))), fps);
  const setDuration = (label: string, d: number) => commit(label, [{ op: 'replace', path: pointer('compositions', compId, 'duration'), value: d }]);

  const splitAt = (id: string, at: number) => { const r = splitLayerOps(S.doc.peek(), compId, id, at); if (r && commit(t('timeline.split'), r.ops)) select([r.id]); };

  /** a clip or its name: what the playhead can do to it, then the layer's own menu (the same as in the layer list) */
  const clipMenu = (e: MouseEvent, id: string) => {
    const d0 = S.doc.peek(), l = d0.compositions[compId]?.layers[id];
    if (!l) return;
    const at = snap(S.time.peek(), fps), tin = l.in ?? 0, tout = l.out ?? c.duration, inside = at > tin && at < tout;
    const lp = pointer('compositions', compId, 'layers', id);
    // a cross-fade with the layer under it, when their times meet and neither opacity is animated
    const fade = crossfadeOps(d0, compId, id, 0.5);
    const media = l.type === 'video' || l.type === 'audio';
    // no start written means the file plays from its beginning: the loop stays offered
    const start0 = l.props?.start === undefined ? 0 : typeof staticValue(l.props.start) === 'number' ? (staticValue(l.props.start) as number) : null;
    const rate = typeof staticValue(l.props?.rate) === 'number' ? (staticValue(l.props?.rate) as number) : 1;
    const looping = staticValue(l.props?.loop) === true;
    openLayerMenu(e, id, {
      before: [
        { section: t('timeline.atPlayhead', { time: timecode(at, fps) }) },
        { label: t('timeline.split'), icon: 'split', disabled: !inside || !!l.children, onClick: () => splitAt(id, at) },
        { label: t('timeline.trimStartToPlayhead'), icon: 'cutHead', disabled: !inside, onClick: () => commit(t('timeline.trimStartToPlayhead'), trimInOps(S.doc.peek(), compId, id, at)) },
        { label: t('timeline.trimEndToPlayhead'), icon: 'cutTail', disabled: !inside, onClick: () => commit(t('timeline.trimEndToPlayhead'), [{ op: 'add', path: `${lp}/out`, value: at }]) },
        { label: t('timeline.moveToPlayhead'), icon: 'arrow', disabled: at === tin, onClick: () => commit(t('timeline.moveToPlayhead'), shiftLayerOps(S.doc.peek(), compId, id, at - tin)) },
        { label: t('timeline.syncBySound'), icon: 'audio', disabled: S.selection.peek().length < 2 || !S.selection.peek().includes(id), onClick: () => { void syncClips(S.selection.peek()); } },
        { label: t('timeline.makeMulticam'), icon: 'film', disabled: S.selection.peek().filter((x) => c.layers[x]?.type === 'video').length < 2 || !S.selection.peek().includes(id), onClick: () => { void makeMulticam(S.selection.peek()); } },
        { label: t('timeline.crossfade'), icon: 'compare', hint: t('timeline.crossfadeHint'), disabled: !fade, onClick: () => fade && commit(t('timeline.crossfade'), fade.ops) },
        {
          label: transitionOf(l) ? t('timeline.changeTransition') : t('timeline.addTransition'), icon: 'effects', hint: t('timeline.transitionHint'),
          disabled: !outgoingOf(d0, compId, id),
          onClick: () => {
            const had = Number(staticValue(transitionOf(l)?.props?.duration)) || 0.5;
            openMenu(e, TRANSITION_KINDS.map((kind) => ({ label: t(KIND_LABEL[kind]), onClick: () => { const ops = putTransition(compId, id, kind, had); if (ops) commit(t('timeline.transitionName', { name: t(KIND_LABEL[kind]) }), ops); } })));
          },
        },
        ...(media && start0 !== null ? [{
          label: looping ? t('timeline.stopTheLoop') : t('timeline.loopToTheEnd'),
          icon: 'loop' as const,
          disabled: !looping && tout >= c.duration - 0.5 / fps,
          onClick: () => {
            const ops: Op[] = looping
              ? [{ op: 'add', path: `${lp}/props/loop`, value: false }]
              : [{ op: 'add', path: `${lp}/props/loop`, value: true }, { op: 'add', path: `${lp}/props/loopEnd`, value: +Math.max(start0 + 1 / fps, (start0 + (tout - tin) * rate)).toFixed(4) }, { op: 'add', path: `${lp}/out`, value: c.duration }];
            commit(looping ? t('timeline.stopTheLoop') : t('timeline.loopToTheEnd'), ops);
          },
        }] : []),
      ],
    });
  };

  /** a marker of the ruler: go there, or take it away */
  const markerMenu = (e: MouseEvent, mid: string) => {
    const list = c.markers ?? [], m = list.find((x) => x.id === mid);
    if (!m) return;
    const at = list.indexOf(m), chapter = m.kind === 'chapter';
    openMenu(e, [
      { label: t('timeline.goToMarker'), icon: 'target', onClick: () => setTime(m.t) },
      { label: chapter ? t('timeline.notAChapter') : t('timeline.makeAChapter'), icon: 'marker', onClick: () => commit(chapter ? t('timeline.notAChapter') : t('timeline.makeAChapter'), [chapter ? { op: 'remove', path: pointer('compositions', compId, 'markers', at, 'kind') } : { op: 'add', path: pointer('compositions', compId, 'markers', at, 'kind'), value: 'chapter' }]) },
      'sep',
      { label: t('timeline.deleteMarker'), icon: 'trash', danger: true, onClick: () => commit(t('timeline.deleteMarker'), [{ op: 'replace', path: pointer('compositions', compId, 'markers'), value: list.filter((x) => x.id !== mid) }]) },
    ]);
  };

  /** an empty place of the tracks or the ruler: the time there, the composition, the view */
  const timeMenu = (e: MouseEvent, at: number) => {
    const list = c.markers ?? [];
    const mid = freshId(Object.fromEntries(list.map((x) => [x.id, 1])), `m${list.length + 1}`);
    const end = snap(contentEnd(c), fps);
    openMenu(e, [
      { section: timecode(at, fps) },
      { label: t('timeline.setTimeHere'), icon: 'target', onClick: () => { S.playing.value = false; setTime(at); } },
      ...(chaptersOf(c.markers).length ? [{ label: t('timeline.copyChapters'), icon: 'copy' as const, onClick: () => { const list = chaptersOf(c.markers); void navigator.clipboard?.writeText(chapterList(list)); toast(t('timeline.chaptersCopied', { n: list.length }), 'info', 1500); } }] : []),
      { label: t('timeline.addMarkerHere'), icon: 'marker', onClick: () => commit(t('timeline.addMarkerHere'), [{ op: 'add', path: pointer('compositions', compId, 'markers'), value: [...list, { id: mid, t: at, label: t('timeline.markerN', { n: list.length + 1 }) }].sort((a, b) => a.t - b.t) }]) },
      { label: t('timeline.endHere'), icon: 'end', disabled: at <= 0 || at === c.duration, onClick: () => setDuration(t('timeline.endHere'), at) },
      { label: t('topbar.trimToContent'), icon: 'collapse', disabled: !(end > 0 && end < c.duration - 0.5 / fps), onClick: () => setDuration(t('topbar.trimToContent'), end) },
      'sep',
      { label: t('panel.addALayer'), icon: 'plus', onClick: () => addLayerMenu(e) },
      ...(c.tracks
        ? (['video', 'audio'] as const).map((kind) => ({ label: t(kind === 'video' ? 'timeline.addVideoTrack' : 'timeline.addSoundTrack'), icon: kind === 'video' ? 'film' : 'audio', onClick: () => commit(t(kind === 'video' ? 'timeline.addVideoTrack' : 'timeline.addSoundTrack'), addTrackOps(S.doc.peek().compositions[compId], compId, kind).ops) }))
        : [{ label: t('timeline.makeSequence'), icon: 'film' as const, onClick: () => commit(t('timeline.makeSequence'), toSequenceOps(S.doc.peek(), compId)) }]),
      { label: t('timeline.selectAll'), icon: 'layers', hint: 'Ctrl+A', disabled: !order.length, onClick: selectAll },
      { label: t('timeline.zoomToFit'), icon: 'expand', disabled: !pps.value, onClick: () => { pps.value = 0; } },
    ]);
  };

  const onMenu = (e: MouseEvent) => {
    noBrowserMenu(e);
    if (!e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    const key = el.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) { const [id, name, i] = key.split('|'); keyMenu(e, id, name, Number(i)); return; }
    const marker = el.closest<HTMLElement>('[data-marker]')?.dataset.marker;
    if (marker) { markerMenu(e, marker); return; }
    const layer = el.closest<HTMLElement>('.clip[data-layer], [data-row]');
    if (layer) { clipMenu(e, layer.dataset.layer ?? layer.dataset.row!); return; }
    timeMenu(e, el.closest('.tl-tracks, .tl-ruler') ? timeAt(e.clientX) : snap(S.time.peek(), fps));
  };

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = tracks.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, at = T(mx + tracks.current!.scrollLeft);
    const next = Math.max(fitPps, Math.min(fps * 60, k * Math.exp(-e.deltaY * 0.002)));
    pps.value = next <= fitPps * 1.001 ? 0 : next;
    requestAnimationFrame(() => { if (tracks.current) tracks.current.scrollLeft = TRACK_PAD + at * next - mx; });
  };

  const toggle = (set: typeof expanded, id: string) => { const s = new Set(set.value); s.has(id) ? s.delete(id) : s.add(id); set.value = s; };

  /** a clip: its bar over [a, b], with what it shows (waveform, shots, fades, transition) and its two edges */
  const clipView = (id: string, l: Layer, a: number, b: number) => (
    <div key={id} data-layer={id} class={`clip${sel.includes(id) ? ' selected' : ''}`} style={{ left: X(a), width: Math.max(2, (b - a) * k), '--c': kindColor(l.type), opacity: l.visible === false ? 0.45 : layerActive(l, c, now) ? 1 : 0.8 }}
      onPointerDown={(e) => dragClip(e, id, 'move')} onDblClick={() => setTime(a)}>
      {l.type === 'audio' && <ClipWave layer={l} from={a} seconds={b - a} width={(b - a) * k} />}
      {l.type === 'video' && !S.playing.value && <ClipFilm layer={l} from={a} seconds={b - a} width={(b - a) * k} />}
      {(l.type === 'audio' || l.type === 'video') && (b - a) * k > 60 && <ClipFades compId={compId} id={id} layer={l} seconds={b - a} k={k} />}
      <TransitionBand compId={compId} id={id} layer={l} k={k} />
      {(b - a) * k > 60 && <span class="label">{layerName(id, l)}</span>}
      <span class="edge l" onPointerDown={(e) => dragClip(e, id, 'in')} />
      <span class="edge r" onPointerDown={(e) => dragClip(e, id, 'out')} />
    </div>
  );

  const [major, minor] = rulerStep(k, fps);
  const ticks: { t: number; major: boolean }[] = [];
  const t0 = Math.max(0, T(scroll) - major), t1 = Math.min(c.duration, T(scroll + width) + major);
  for (let i = Math.floor(t0 / minor); i * minor <= t1 + 1e-9; i++) {
    const tt = i * minor;
    ticks.push({ t: tt, major: Math.abs(tt / major - Math.round(tt / major)) < 1e-6 });
  }

  return (
    <div class="timeline" data-tour="timeline" style={{ '--names': `${namesW}px` }} onWheel={onWheel} onContextMenu={onMenu}>
      <div class="tl-corner"><Icon name="layers" size={13} /><span class="tl-count">{t('timeline.nLayers', { n: Object.keys(c.layers).length })}</span><span class="grow" /><FoldButtons /></div>
      <div class="tl-ruler" onPointerDown={scrubFrom}>
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-scroll}px)` }}>
          {ticks.map((tk) => (
            <div key={tk.t} class={`tick${tk.major ? '' : ' minor'}`} style={{ left: X(tk.t) }}>{tk.major && <span>{rulerLabel(tk.t, fps)}</span>}</div>
          ))}
          {(c.markers || []).map((m) => (
            <div key={m.id} data-marker={m.id} class={`tl-marker${m.kind === 'scene' ? ' scene' : m.kind === 'chapter' ? ' chapter' : ''}`} style={{ left: X(m.t) }} title={`${m.label ?? m.id} · ${timecode(m.t, fps)}`}
              onDblClick={(e) => { e.stopPropagation(); setTime(m.t); }}>
              {k * 0.4 > 30 && <span>{m.label ?? m.id}</span>}
            </div>
          ))}
          <Playhead x={X} />
        </div>
      </div>
      <div class="tl-names" ref={names} style={{ position: 'relative' }}>
        {rows.map((r) => r.kind === 'track' ? (
          <TrackHeader key={`track.${r.track.id}`} compId={compId} c={c} track={r.track} />
        ) : r.kind === 'layer' ? (
          <div key={r.item.id} data-row={r.item.id} class={`tl-name${sel.includes(r.item.id) ? ' selected' : ''}`} style={{ paddingLeft: 6 + r.item.depth * 12 }} onClick={(e) => clickSelect(e, r.item.id, order)}>
            {r.item.layer.children
              ? <button class={`twist${S.collapsed.value.has(r.item.id) ? '' : ' open'}`} title={t('panel.foldHint')} onClick={(e) => { e.stopPropagation(); toggleFold(r.item.id, e.altKey); }}><Icon name="chevron" /></button>
              : animatedProps(r.item.layer).length
                ? <button class={`twist${expanded.value.has(r.item.id) ? ' open' : ''}`} title={t('timeline.animatedProperties')} onClick={(e) => { e.stopPropagation(); toggle(expanded, r.item.id); }}><Icon name="chevron" /></button>
                : <span style={{ width: 16, flex: 'none' }} />}
            <span style={{ color: kindColor(r.item.layer.type), display: 'grid' }}><Icon name={kindIcon(r.item.layer.type)} size={12} /></span>
            <span class="name">{layerName(r.item.id, r.item.layer)}</span>
            {r.item.layer.type === 'audio' && <SoloButton id={r.item.id} />}
          </div>
        ) : (
          <div key={`${r.item.id}.${r.name}`} class="tl-name sub" style={{ paddingLeft: 30 + r.item.depth * 12 }}>
            <span class="dot-key" />
            <span class="name">{propLabel(r.item.layer.type, r.name)}</span>
          </div>
        ))}
        <div class="resizer v" style={{ position: 'absolute', top: 0, bottom: 0, right: -1 }} {...namesHandle('x', 1)} />
      </div>
      <div class="tl-tracks" ref={tracks}
        onScroll={(e) => { const el = e.currentTarget as HTMLDivElement; setScroll(el.scrollLeft); if (names.current) names.current.scrollTop = el.scrollTop; }}
        onPointerDown={(e) => { const el = e.target as HTMLElement; if (el === e.currentTarget || el.classList.contains('tl-row') || el.classList.contains('tl-content')) emptyDown(e); }}>
        <div class="tl-content" style={{ position: 'relative', width: total, minHeight: '100%' }}>
          {rows.map((r) => {
            if (r.kind === 'track') {
              const { track } = r;
              return (
                <div key={`track.${track.id}`} data-track={track.id} class={`tl-row track${track.locked ? ' locked' : ''}${track.hidden || track.muted ? ' off' : ''}${dropLane === track.id ? ' drop' : ''}`} style={{ height: laneHeight(track) }}
                  onDragOver={(e) => { if (!e.dataTransfer?.types.includes(ASSET_MIME) && !e.dataTransfer?.types.includes(COMP_MIME)) return; e.preventDefault(); setDropLane(track.id); }}
                  onDragLeave={() => setDropLane(null)}
                  onDrop={(e) => {
                    const asset = e.dataTransfer?.getData(ASSET_MIME), inner = e.dataTransfer?.getData(COMP_MIME);
                    if (!asset && !inner) return;
                    e.preventDefault(); setDropLane(null);
                    // the track makes room when it is magnetic, the clip lies over what is there otherwise; Alt does the other
                    const mode = (track.magnetic ? !e.altKey : e.altKey) ? 'insert' : 'overwrite';
                    if (inner) placeComp(inner, timeAt(e.clientX), track.id, mode); else void placeAsset(asset!, timeAt(e.clientX), track.id, mode);
                  }}>
                  {r.ids.map((id) => { const l = c.layers[id], a = l.in ?? 0; return clipView(id, l, a, Math.max(a, l.out ?? c.duration)); })}
                </div>
              );
            }
            if (r.kind === 'layer') {
              const l = r.item.layer, id = r.item.id;
              // visible range: the layer's own, inside its parents'
              let a = l.in ?? 0, b = l.out ?? c.duration;
              for (let p = r.item.parent; p; p = parentOf(c, p)) { a = Math.max(a, c.layers[p].in ?? 0); b = Math.min(b, c.layers[p].out ?? c.duration); }
              if (b <= a) b = a;
              const keysAll = animatedProps(l).flatMap(([, ks]) => ks.map((kf) => kf.t));
              return (
                <div key={id} class={`tl-row`}>
                  {clipView(id, l, a, b)}
                  {[...new Set(keysAll)].map((kt) => <span key={kt} class="kf summary" style={{ left: X(kt) }} />)}
                </div>
              );
            }
            const { item, name, keys } = r;
            return (
              <div key={`${item.id}.${name}`} class="tl-row sub">
                {keys.slice(1).map((kf, i) => keys[i].ease !== 'hold' && <span key={`s${i}`} class="kf-span" style={{ left: X(keys[i].t), width: (kf.t - keys[i].t) * k }} />)}
                {keys.map((kf, i) => {
                  const kid = keyId(item.id, name, i);
                  return <span key={i} data-key={kid} class={`kf${kf.ease === 'hold' ? ' hold' : ''}${keySel.includes(kid) ? ' selected' : ''}`} style={{ left: X(kf.t) }}
                    title={`${timecode(kf.t, fps)} · ${JSON.stringify(kf.v)}${kf.ease ? ` · ${JSON.stringify(kf.ease)}` : ''}`}
                    onPointerDown={(e) => dragKey(e, item.id, name, i)} onDblClick={() => setTime(kf.t)} />;
                })}
              </div>
            );
          })}
          <div class="tl-out" style={{ left: X(c.duration), width: TRACK_PAD }} />
          {snapAt !== null && <div class="tl-snap" style={{ left: X(snapAt) }} />}
          {band && <div class="tl-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
          <Playhead x={X} />
        </div>
      </div>
    </div>
  );
}

/**
 * The waveform of a sound file in a box `width` pixels wide: the file from
 * `offset` seconds, `seconds` of the composition played at `rate`; its file
 * read once in the background (the timeline's clips, the studio's storyboard).
 */
export function Wave({ asset, offset, seconds, rate, width, class: cls }: { asset: string; offset: number; seconds: number; rate: number; width: number; class?: string }) {
  void wavesReady.value;
  const r = preview.renderer;
  if (!r || width < 8) return null;
  let url: string;
  try { url = r.assets.url(asset); } catch { return null; }
  const p = peaksOf(url);
  if (!p) return null;
  return <svg class={cls} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true"><path d={wavePath(p, offset, seconds, rate, width)} /></svg>;
}

/** the waveform of an audio clip */
function ClipWave({ layer, from, seconds, width }: { layer: Layer; from: number; seconds: number; width: number }) {
  const asset = staticValue(layer.props?.audio);
  if (typeof asset !== 'string') return null;
  const rate = Number(staticValue(layer.props?.rate) ?? 1) || 1, offset = Number(staticValue(layer.props?.start) ?? 0) + (from - (layer.in ?? 0)) * rate;
  return <Wave class="wave" asset={asset} offset={offset} seconds={seconds} rate={rate} width={width} />;
}

/** a thumbnail of the file every 64 px of the clip: the video seen at a glance, decoded in the background */
function ClipFilm({ layer, from, seconds, width }: { layer: Layer; from: number; seconds: number; width: number }) {
  void filmVersion.value;
  const canvas = useRef<HTMLCanvasElement>(null);
  const asset = staticValue(layer.props?.video);
  const rate = Number(staticValue(layer.props?.rate) ?? 1) || 1;
  const start = Math.max(0, Number(staticValue(layer.props?.start) ?? 0) || 0);
  const looping = staticValue(layer.props?.loop) === true, loopEnd = Number(staticValue(layer.props?.loopEnd) ?? 0);
  // at most 128 slots: the canvas never passes what a browser takes (8192 px) and the CSS stretches it over the clip
  const slots = Math.min(Math.ceil(width / FILM_W), Math.floor(8192 / FILM_W));
  const ok = typeof asset === 'string' && width >= 60 && slots > 0;
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !ok || typeof asset !== 'string') return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const len = (looping ? loopEnd : 0) - start;
    for (let i = 0; i < slots; i++) {
      const mid = from + ((i + 0.5) * seconds) / slots;
      let src = start + (mid - (layer.in ?? 0)) * rate;
      if (looping && len > 0.001) src = start + (((src - start) % len) + len) % len;
      const th = filmThumb(asset, src);
      if (th) g.drawImage(th, i * FILM_W, 0, FILM_W, FILM_H);
    }
  });
  if (!ok) return null;
  return <canvas ref={canvas} class="film" width={slots * FILM_W} height={FILM_H} aria-hidden="true" />;
}

/** what a modified drag is called in the history */
const TOOL_LABEL = { roll: m('timeline.roll'), slip: m('timeline.slip'), slide: m('timeline.slide') };

const KIND_LABEL: Record<TransitionKind, string> = {
  crossfade: m('timeline.kindCrossfade'), dip: m('timeline.kindDip'), push: m('timeline.kindPush'), slide: m('timeline.kindSlide'),
  zoom: m('timeline.kindZoom'), whip: m('timeline.kindWhip'), luma: m('timeline.kindLuma'), glitch: m('timeline.kindGlitch'),
};

/** a transition on the cut into this clip, its length: the operations, or a toast saying why not */
function putTransition(compId: string, id: string, kind: TransitionKind, duration: number, quiet = false): Op[] | null {
  const plan = transitionPlan(S.doc.peek(), compId, id, kind, duration, fileLength);
  if ('error' in plan) {
    if (!quiet) toast(plan.error === 'no-handle' ? t('timeline.noHandleLeft', { missing: (plan.missing ?? 0).toFixed(2) }) : t('timeline.noCutHere'), 'error');
    return null;
  }
  return plan.ops;
}

/** the transition of a clip as a band over its start: drag its right edge to change its length */
function TransitionBand({ compId, id, layer, k }: { compId: string; id: string; layer: Layer; k: number }) {
  const tr0 = transitionOf(layer);
  if (!tr0) return null;
  const kind = (TRANSITION_KINDS as readonly string[]).includes(String(staticValue(tr0.props?.kind))) ? staticValue(tr0.props?.kind) as TransitionKind : 'crossfade';
  const d0 = Number(staticValue(tr0.props?.duration)) || 0.5;
  const drag = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const fps = comp.peek().fps, x0 = e.clientX;
    let ops: Op[] | null = null;
    const move = (ev: PointerEvent) => {
      const d = snap(Math.max(1 / fps, d0 + (ev.clientX - x0) / k), fps);
      ops = Math.abs(d - d0) < 1e-6 ? null : putTransition(compId, id, kind, d, true);
      if (ops) draft(ops); else cancelDraft();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (ops) commit(t('timeline.transitionName', { name: t(KIND_LABEL[kind]) }), ops); else cancelDraft();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return (
    <span class="tr-band" style={{ width: d0 * k }} title={t('timeline.transitionBand', { name: t(KIND_LABEL[kind]), seconds: d0.toFixed(2) })}>
      <span class="tr-edge" onPointerDown={drag} />
    </span>
  );
}

/** the fades of a clip as two handles at its top corners: drag one, the gain follows */
function ClipFades({ compId, id, layer, seconds, k }: { compId: string; id: string; layer: Layer; seconds: number; k: number }) {
  const fi = Number(staticValue(layer.props?.fadeIn) ?? 0) || 0;
  const fo = Number(staticValue(layer.props?.fadeOut) ?? 0) || 0;
  const drag = (which: 'in' | 'out') => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const fps = comp.peek().fps, max = Math.max(0.05, seconds / 2);
    const name = which === 'in' ? 'fadeIn' : 'fadeOut', v0 = which === 'in' ? fi : fo, x0 = e.clientX, dir = which === 'in' ? 1 : -1;
    let ops: Op[] = [];
    const move = (ev: PointerEvent) => {
      const v = snap(Math.min(max, Math.max(0, v0 + dir * (ev.clientX - x0) / k)), fps);
      ops = v === v0 ? [] : [{ op: 'add', path: pointer('compositions', compId, 'layers', id, 'props', name), value: +v.toFixed(3) }];
      if (ops.length) draft(ops); else cancelDraft();
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (ops.length) commit(t('timeline.fadeName', { name: which === 'in' ? t('common.fadeIn') : t('common.fadeOut') }), ops); else cancelDraft();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const max = Math.max(0.05, seconds / 2);
  return <>
    <span class={`fade-h l${fi > 0.001 ? ' set' : ''}`} style={{ width: Math.min(100, (Math.min(fi, max) / seconds) * 100) + '%' }} title={t('common.fadeIn')} onPointerDown={drag('in')} />
    <span class={`fade-h r${fo > 0.001 ? ' set' : ''}`} style={{ width: Math.min(100, (Math.min(fo, max) / seconds) * 100) + '%' }} title={t('common.fadeOut')} onPointerDown={drag('out')} />
  </>;
}

/** plays a sound layer alone in the preview, or with the others again */
function SoloButton({ id }: { id: string }) {
  const on = S.solo.value.has(id);
  return (
    <button class={`solo${on ? ' on' : ''}`} title={on ? t('timeline.soloOff') : t('timeline.solo')}
      onClick={(e) => { e.stopPropagation(); const s = new Set(S.solo.value); on ? s.delete(id) : s.add(id); S.solo.value = s; }}>S</button>
  );
}

/** the playhead alone follows every frame, without redrawing the timeline */
function Playhead({ x }: { x: (t: number) => number }) {
  // moved by the compositor (its own layer): the timeline is not repainted at each frame
  return <div class="playhead" style={{ transform: `translateX(${x(S.time.value)}px)` }} />;
}

// ── keyframe edits ───────────────────────────────────────────
function groupKeys(ids: string[]) {
  const by = new Map<string, Set<number>>();
  for (const kid of ids) {
    const [id, name, i] = kid.split('|');
    const key = `${id}|${name}`;
    if (!by.has(key)) by.set(key, new Set());
    by.get(key)!.add(Number(i));
  }
  return by;
}

export function moveKeysOps(doc: import('@tramme/core').TrammeDoc, compId: string, ids: string[], dt: number): Op[] {
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const raw = rawProp(doc, compId, id, name);
    const keys = keysOf(raw);
    if (!keys) continue;
    const moved = keys.map((kf, i) => (idx.has(i) ? { ...kf, t: +Math.max(0, kf.t + dt).toFixed(5) } : kf)).sort((a, b) => a.t - b.t);
    ops.push({ op: 'replace', path: `${propPath(compId, id, name)}/$k`, value: moved });
  }
  return ops;
}

function easeOps(doc: import('@tramme/core').TrammeDoc, compId: string, ids: string[], ease: unknown): Op[] {
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const keys = keysOf(rawProp(doc, compId, id, name));
    if (!keys) continue;
    for (const i of idx) {
      const { ease: _, ...rest } = keys[i];
      ops.push({ op: 'replace', path: `${propPath(compId, id, name)}/$k/${i}`, value: ease === 'linear' ? rest : { ...rest, ease } });
    }
  }
  return ops;
}

export function deleteKeys(): boolean {
  const ids = S.keys.peek();
  if (!ids.length) return false;
  const doc = S.doc.peek(), compId = S.compId.peek();
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const keys = keysOf(rawProp(doc, compId, id, name));
    if (!keys) continue;
    const left = keys.filter((_, i) => !idx.has(i));
    const path = propPath(compId, id, name);
    ops.push(left.length ? { op: 'replace', path: `${path}/$k`, value: left } : { op: 'replace', path, value: keys[0].v });
  }
  S.keys.value = [];
  return commit(ids.length > 1 ? t('timeline.deleteNKeyframes', { n: ids.length }) : t('common.deleteKeyframe'), ops);
}

export function Bottom() {
  return S.bottomTab.value === 'graph' ? <GraphEditor /> : <Timeline />;
}
