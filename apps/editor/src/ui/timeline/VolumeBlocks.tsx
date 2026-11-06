import { useRef, useState } from 'preact/hooks';
import type { Composition, SequenceTrack } from '@tramme/core';
import { commit, S } from '../../state.ts';
import { prefs } from '../../settings.ts';
import { t } from '../../i18n/index.ts';
import { addVolumeBlockOps, removeVolumeBlockOps, resizeVolumeBlockOps } from './mixer.ts';

interface Edit { id: string; from: number; to: number; depth: number; attack: number; release: number }

/** A track's saved dips: draw across the lane, then edit each group as one object. */
export function VolumeBlocks({ compId, c, track, k, X, T, drawing }: { compId: string; c: Composition; track: SequenceTrack; k: number; X: (t: number) => number; T: (x: number) => number; drawing: boolean }) {
  const [band, setBand] = useState<[number, number] | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const fps = c.fps;
  const at = (x: number, row: HTMLElement) => Math.max(0, Math.min(c.duration, Math.round(T(x - row.getBoundingClientRect().left) * fps) / fps));
  const begin = (e: PointerEvent) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const row = (e.currentTarget as HTMLElement).parentElement!;
    const first = at(e.clientX, row);
    setBand([first, first]);
    const move = (ev: PointerEvent) => setBand([Math.min(first, at(ev.clientX, row)), Math.max(first, at(ev.clientX, row))]);
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const a = Math.max(0.15, Math.min(first, at(ev.clientX, row)));
      const b = Math.min(c.duration - 0.5, Math.max(first, at(ev.clientX, row)));
      setBand(null);
      if (b - a < 1 / fps) return;
      const current = S.doc.peek().compositions[compId];
      const ops = addVolumeBlockOps(current, compId, track.id, a, b, prefs.peek().duckDb, 0.15, 0.5);
      if (ops.length) commit(t('timeline.volumeDip'), ops);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const open = (block: NonNullable<SequenceTrack['volumeBlocks']>[number]) => {
    const [start, down, hold, end] = block.keys;
    setEdit({ id: block.id, from: down.t, to: hold.t, depth: down.v, attack: +(down.t - start.t).toFixed(3), release: +(end.t - hold.t).toFixed(3) });
    dialog.current?.showModal();
  };
  const write = (remove = false) => {
    if (!edit) return;
    const current = S.doc.peek().compositions[compId];
    const ops = remove ? removeVolumeBlockOps(current, compId, track.id, edit.id)
      : resizeVolumeBlockOps(current, compId, track.id, edit.id, edit.from, edit.to, edit.depth, edit.attack, edit.release);
    if (ops.length) { commit(t(remove ? 'timeline.removeVolumeDip' : 'timeline.editVolumeDip'), ops); dialog.current?.close(); }
  };
  const field = (name: keyof Omit<Edit, 'id'>, label: string, min: number, max: number, step: number) => <label class="effect-field">{label}<input type="number" required min={min} max={max} step={step} value={edit?.[name] ?? ''} onInput={(e) => setEdit((old) => old ? { ...old, [name]: Number((e.currentTarget as HTMLInputElement).value) } : null)} /></label>;
  return <>
    {drawing && <div class="volume-draw-surface" aria-label={t('timeline.drawVolumeDip')} onPointerDown={begin} />}
    {(track.volumeBlocks ?? []).map((block) => {
      const [start, down, , end] = block.keys;
      return <button key={block.id} type="button" class="volume-block" style={{ left: X(start.t), width: Math.max(9, (end.t - start.t) * k) }} title={`${t('timeline.editVolumeDip')}: ${down.v} dB, ${down.t.toFixed(2)}–${block.keys[2].t.toFixed(2)} s`} aria-label={`${t('timeline.editVolumeDip')}: ${down.v} dB`} onPointerDown={(e) => e.stopPropagation()} onClick={() => open(block)}>{Math.abs(down.v).toFixed(0)} dB</button>;
    })}
    {band && band[1] > band[0] && <div class="volume-block ghost" style={{ left: X(band[0]), width: (band[1] - band[0]) * k }} />}
    <dialog ref={dialog} class="volume-dialog" onClose={() => setEdit(null)} aria-label={t('timeline.editVolumeDip')}>
      <form onSubmit={(e) => { e.preventDefault(); write(); }}>
        <strong>{t('timeline.editVolumeDip')}</strong>
        {field('from', t('timeline.dipFrom'), 0, c.duration, 0.001)}
        {field('to', t('timeline.dipTo'), 0, c.duration, 0.001)}
        {field('depth', t('timeline.dipDepth'), -40, -1, 0.5)}
        {field('attack', t('timeline.dipAttack'), 0.02, 2, 0.01)}
        {field('release', t('timeline.dipRelease'), 0.05, 4, 0.01)}
        <div class="volume-dialog-actions"><button type="button" onClick={() => write(true)}>{t('timeline.removeVolumeDip')}</button><button type="button" onClick={() => dialog.current?.close()}>{t('common.cancel')}</button><button type="submit">{t('common.apply')}</button></div>
      </form>
    </dialog>
  </>;
}
