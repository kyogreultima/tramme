// The studio's retouching: what is drawn on the picture (points, paths to
// follow, groups of layers to select), the list of retouches built from it, and
// the confirmation of an area before it becomes a selection. The state lives in
// studio.ts and the pure parts in retouch.ts; these are the views and the gesture.

import type { RefObject } from 'preact';
import { Evaluator, sampleAt, type Vec2 } from '@tramme/core';
import { running } from '../ai/conversation.ts';
import { draft } from '../attachments.ts';
import { comp, S, uiTime } from '../state.ts';
import { addPin, cancelReview, confirmReview, editRetouch, moveRetouch, notes, removePin, removeRetouch, resetRetouch, sendRetouches, strokeDone, studio, toggleReview } from '../studio.ts';
import { anchorPoint, summaryOf, type Pin, type Placed, type Pt } from '../retouch.ts';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

/** the layers on the picture now, with their boxes: what an area is proposed from */
export function placedNow(): Placed[] {
  const doc = S.doc.peek(), id = S.compId.peek();
  try {
    return sampleAt(new Evaluator(doc, S.registry.peek()), id, uiTime.peek()).layers.map((p) => ({ id: p.id, name: p.layer.name ?? p.id, type: p.layer.type, box: p.box, opacity: p.opacity, locked: p.layer.locked }));
  } catch { return []; }
}

const frac = (c: Vec2): Pt => { const k = comp.peek(); return [Math.min(1, Math.max(0, c[0] / k.width)), Math.min(1, Math.max(0, c[1] / k.height))]; };
const long = (pts: Pt[]) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);

/**
 * A press on the picture, with the tool in hand: a point pins at once; a path or
 * an area follows the finger and is done when it lifts. While an area waits for
 * the user's word, a press on a layer turns it on or off in the proposal.
 */
export function pressPicture(p: Vec2, _e: PointerEvent, hit: () => string | null, toComp: (e: { clientX: number; clientY: number }) => Vec2, area: RefObject<HTMLTextAreaElement>): boolean {
  const c = comp.peek(), id = hit(), l = id ? c.layers[id] : null;
  const under = l && id ? { id, name: l.name ?? id, type: l.type } : null;
  S.playing.value = false;
  if (studio.review.peek()) { if (under) toggleReview(under); return true; }
  const tool = studio.tool.peek();
  if (tool === 'point') {
    addPin({ kind: 'point', at: frac(p).map((v) => +v.toFixed(4)) as Pt, ...(under ? { under } : {}) });
    requestAnimationFrame(() => area.current?.focus());
    return true;
  }
  const pts: Pt[] = [frac(p)];
  studio.drawing.value = [...pts];
  const move = (ev: PointerEvent) => {
    const q = frac(toComp(ev)), last = pts[pts.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.004) { pts.push(q); studio.drawing.value = [...pts]; }
  };
  const done = (ev: Event) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', done); removeEventListener('pointercancel', done);
    studio.drawing.value = null;
    // a tap is no stroke: nothing is drawn
    if (ev.type === 'pointercancel' || pts.length < 3 || long(pts) < 0.03) return;
    strokeDone(tool, pts, placedNow(), { w: c.width, h: c.height }, under);
    requestAnimationFrame(() => area.current?.focus());
  };
  addEventListener('pointermove', move); addEventListener('pointerup', done); addEventListener('pointercancel', done);
  return true;
}

/** what a pin is called on a chip */
const kindLabel = (p: Pin) => (p.kind === 'point' ? t('studio.pinKindPoint') : p.kind === 'path' ? t('studio.pinKindPath') : t('studio.pinKindArea'));

/** the three tools of the hand: a point, a path to follow, a group to select */
export function PinTools() {
  const tool = studio.tool.value, pinning = studio.pinning.value;
  const pick = (k: 'point' | 'path' | 'area') => () => { studio.tool.value = k; studio.pinning.value = true; };
  return (
    <span class="pin-tools" data-tour="pin">
      <button class={`icon-btn sm${pinning && tool === 'point' ? ' on' : ''}`} title={t('studio.pinHint')} aria-pressed={pinning && tool === 'point'} onClick={pick('point')}><Icon name="pin" /></button>
      <button class={`icon-btn sm${pinning && tool === 'path' ? ' on' : ''}`} title={t('studio.pathHint')} aria-pressed={pinning && tool === 'path'} onClick={pick('path')}><Icon name="curve" /></button>
      <button class={`icon-btn sm${pinning && tool === 'area' ? ' on' : ''}`} title={t('studio.areaHint')} aria-pressed={pinning && tool === 'area'} onClick={pick('area')}><Icon name="box" /></button>
    </span>
  );
}

/** the pins of the note being written, each a chip to take away */
export function PinChips() {
  const pins = studio.pins.value;
  return <>{pins.map((p, i) => (
    <button key={p.id} class="ctx-chip on" title={t('studio.unpin')} onClick={() => removePin(p.id)}><Icon name={p.kind === 'point' ? 'pin' : p.kind === 'path' ? 'curve' : 'box'} /><span>{i + 1} · {kindLabel(p)}</span><Icon name="x" /></button>
  ))}</>;
}

/** a stroke as the points of an SVG shape, in the picture's own unit square */
const shape = (pts: Pt[]) => pts.map((q) => `${q[0]},${q[1]}`).join(' ');

/** the pins drawn over the picture: the ones of the list and of the note being written, numbered as the assistant will number them, and the notes left earlier near this moment */
export function Marks() {
  const now = uiTime.value, draft = studio.pins.value, review = studio.review.value, drawing = studio.drawing.value;
  const listed = studio.retouches.value.flatMap((r) => r.pins), all = [...listed, ...draft];
  const near = notes.value.filter(({ note }) => note.pin && Math.abs(note.at! - now) < 0.75);
  const k = comp.value;
  const boxes = review ? placedNow().filter((p) => p.box && review.candidates.some((c) => c.id === p.id)) : [];
  return (
    <div class="pins">
      <svg class="strokes" viewBox="0 0 1 1" preserveAspectRatio="none">
        {all.map((p) => (p.kind === 'point' ? null : p.kind === 'path'
          ? <polyline key={p.id} class="stroke path" points={shape(p.points)} />
          : <polygon key={p.id} class={`stroke area${p.layers.length ? '' : ' hint'}`} points={shape(p.points)} />))}
        {review && <polygon class="stroke area review" points={shape(review.stroke)} />}
        {drawing && <polyline class="stroke drawing" points={shape(drawing)} />}
      </svg>
      {boxes.map((p) => {
        const on = review!.candidates.find((c) => c.id === p.id)!.on, b = p.box!;
        return <span key={p.id} class={`cand${on ? ' on' : ''}`} style={{ left: `${(b.x / k.width) * 100}%`, top: `${(b.y / k.height) * 100}%`, width: `${(b.w / k.width) * 100}%`, height: `${(b.h / k.height) * 100}%` }} />;
      })}
      {near.map(({ n, note }) => (
        <button key={note.id} class="pin" style={{ left: `${note.pin![0] * 100}%`, top: `${note.pin![1] * 100}%` }} title={note.text}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => { studio.panel.value = 'notes'; studio.flash.value = note.id; }}>
          <span>{n}</span>
        </button>
      ))}
      {all.map((p, i) => { const [x, y] = anchorPoint(p); return <span key={p.id} class="pin new" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}><span>{i + 1}</span></span>; })}
    </div>
  );
}

/** an area waiting for the user's word: the layers it may mean, to drop or add, and what to do with them */
export function AreaReview() {
  const r = studio.review.value;
  if (!r) return null;
  const chosen = r.candidates.filter((c) => c.on).length;
  return (
    <div class="area-review" role="group" aria-label={t('studio.reviewTitle')}>
      <div class="area-head"><Icon name="box" /><b>{t('studio.reviewTitle')}</b></div>
      <p class="faint">{r.tooMany ? t('studio.reviewTooMany', { n: r.count }) : r.candidates.length ? t('studio.reviewTap') : t('studio.reviewNone')}</p>
      {r.candidates.length > 0 && (
        <div class="area-layers">
          {r.candidates.map((c) => (
            <button key={c.id} class={`chip${c.on ? ' on' : ''}`} aria-pressed={c.on} onClick={() => toggleReview(c)}><Icon name={c.on ? 'check' : 'plus'} />{c.name}</button>
          ))}
        </div>
      )}
      <div class="area-actions">
        <button class="btn sm primary" disabled={!chosen} onClick={() => confirmReview('layers')}><Icon name="check" />{t('studio.reviewUse', { n: chosen })}</button>
        <button class="btn sm" onClick={() => confirmReview('hint')}>{t('studio.reviewHint')}</button>
        <button class="btn sm ghost" onClick={cancelReview}>{t('studio.reviewCancel')}</button>
      </div>
    </div>
  );
}

/** the retouches written and waiting: in order, each about its pins; reorder, take back to change, remove, and send them all as one turn */
export function RetouchList() {
  const list = studio.retouches.value;
  if (!list.length) return null;
  let n = 1;
  return (
    <div class="retouch-list" data-tour="retouches">
      <div class="retouch-head">
        <b>{t('studio.retouchList', { n: list.length })}</b>
        <span class="grow" />
        <button class="btn sm ghost" onClick={resetRetouch}>{t('studio.clearList')}</button>
        <button class="btn sm primary" onClick={() => { void sendRetouches(); }}><Icon name={running.value ? 'clock' : 'send'} />{running.value ? t('studio.sendAllLater', { n: list.length }) : t('studio.sendAll', { n: list.length })}</button>
      </div>
      <ol>
        {list.map((r, i) => {
          const first = n; n += r.pins.length;
          return (
            <li key={r.id}>
              <span class="retouch-n mono">{r.pins.length ? (r.pins.length > 1 ? `${first}-${first + r.pins.length - 1}` : first) : '·'}</span>
              <span class="retouch-text">
                {r.voice && <Icon name="mic" />}
                <span title={r.text}>{r.text || t('studio.retouchPinsOnly')}</span>
                {r.pins.length > 0 && <span class="faint">{summaryOf(r.pins)}</span>}
              </span>
              <span class="retouch-actions">
                <button class="icon-btn xs" title={t('studio.moveUp')} disabled={i === 0} onClick={() => moveRetouch(r.id, -1)}><Icon name="chevronDown" class="flip" /></button>
                <button class="icon-btn xs" title={t('studio.moveDown')} disabled={i === list.length - 1} onClick={() => moveRetouch(r.id, 1)}><Icon name="chevronDown" /></button>
                <button class="icon-btn xs" title={t('studio.editRetouch')} onClick={() => { draft.value = editRetouch(r.id); studio.pinning.value = false; }}><Icon name="edit" /></button>
                <button class="icon-btn xs" title={t('studio.removeRetouch')} onClick={() => removeRetouch(r.id)}><Icon name="x" /></button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
