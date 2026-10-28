// The header of a lane of a sequence, in the timeline's names column: its name
// (double click to rename), and what it switches: lock, picture, sound, solo,
// magnetism; the menu adds and removes tracks and sets the lane's height.

import { useState } from 'preact/hooks';
import type { Composition, SequenceTrack } from '@tramme/core';
import { commit, S } from '../../state.ts';
import { t } from '../../i18n/index.ts';
import { Icon, kindColor, kindIcon } from '../icons.tsx';
import { openMenu, type MenuItem } from '../controls.tsx';
import { addTrackOps, clipsOn, removeTrackOps, soloOf, trackChangeOps, type TrackChange } from './tracks.ts';

/** lane heights the menu offers, px */
export const LANE_HEIGHTS: [string, number][] = [['timeline.laneSmall', 28], ['timeline.laneMedium', 44], ['timeline.laneLarge', 72]];
export const laneHeight = (track: SequenceTrack) => track.height ?? (track.kind === 'audio' ? 36 : 44);

const label = (track: SequenceTrack) => track.name || track.id;

/** a track's switches written to the document, one undo each */
export const changeTrack = (compId: string, track: SequenceTrack, change: TrackChange, what: string) =>
  commit(what, trackChangeOps(S.doc.peek().compositions[compId], compId, track.id, change));

/** the menu of a lane (right click on its header or the add button) */
export function trackMenu(e: { clientX: number; clientY: number } | DOMRect, compId: string, c: Composition, track?: SequenceTrack) {
  const add = (kind: 'video' | 'audio') => commit(kind === 'video' ? t('timeline.addVideoTrack') : t('timeline.addSoundTrack'), addTrackOps(S.doc.peek().compositions[compId], compId, kind).ops);
  const items: MenuItem[] = [];
  if (track) {
    items.push(
      { label: t('timeline.renameTrack'), icon: 'edit', onClick: () => document.querySelector<HTMLElement>(`[data-track-name="${track.id}"]`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
      ...LANE_HEIGHTS.map(([key, h]): MenuItem => ({ label: t(key), check: laneHeight(track) === h, onClick: () => changeTrack(compId, track, { height: h }, t('timeline.laneHeight')) })),
      'sep',
    );
  }
  items.push(
    { label: t('timeline.addVideoTrack'), icon: 'plus', onClick: () => add('video') },
    { label: t('timeline.addSoundTrack'), icon: 'plus', onClick: () => add('audio') },
  );
  if (track) {
    const empty = !clipsOn(c, track.id).length;
    items.push('sep', { label: t('timeline.removeTrack'), icon: 'trash', danger: true, disabled: !empty, detail: empty ? undefined : t('timeline.trackNotEmpty'), onClick: () => commit(t('timeline.removeTrack'), removeTrackOps(S.doc.peek(), compId, track.id)) });
  }
  openMenu(e, items);
}

export function TrackHeader({ compId, c, track }: { compId: string; c: Composition; track: SequenceTrack }) {
  const [text, setText] = useState<string | null>(null);
  const audio = track.kind === 'audio', ids = clipsOn(c, track.id), soloed = ids.length > 0 && ids.every((id) => S.solo.value.has(id));
  const toggle = (key: keyof TrackChange, what: string) => (e: Event) => { e.stopPropagation(); changeTrack(compId, track, { [key]: !track[key as 'locked'] } as TrackChange, what); };
  return (
    <div class={`tl-name track${track.locked ? ' locked' : ''}`} style={{ height: laneHeight(track) - 2 }} data-track-header={track.id}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); trackMenu(e, compId, c, track); }}>
      <span class="kind" style={{ color: kindColor(track.kind) }}><Icon name={kindIcon(track.kind)} size={12} /></span>
      {text === null
        ? <span class="name" data-track-name={track.id} title={t('timeline.renameTrackHint')} onDblClick={() => setText(label(track))}>{label(track)}</span>
        : <input class="name-input" value={text} autoFocus
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onBlur={() => { if (text !== label(track)) changeTrack(compId, track, { name: text === track.id ? '' : text }, t('timeline.renameTrack')); setText(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(null); e.stopPropagation(); }} />}
      {!audio && <button class={`tbtn${track.magnetic ? ' on' : ''}`} title={t('timeline.magnetic')} onClick={toggle('magnetic', t('timeline.magnetic'))}><Icon name="magnet" size={12} /></button>}
      {!audio && <button class={`tbtn${track.hidden ? ' on' : ''}`} title={track.hidden ? t('common.show') : t('common.hide')} onClick={toggle('hidden', t('panel.visibility'))}><Icon name={track.hidden ? 'eyeOff' : 'eye'} size={12} /></button>}
      <button class={`tbtn${track.muted ? ' on' : ''}`} title={track.muted ? t('timeline.unmuteTrack') : t('timeline.muteTrack')} onClick={toggle('muted', t('timeline.muteTrack'))}><Icon name="audio" size={12} /></button>
      {audio && <button class={`solo${soloed ? ' on' : ''}`} title={soloed ? t('timeline.soloOff') : t('timeline.solo')} onClick={(e) => { e.stopPropagation(); S.solo.value = soloOf(c, track.id, S.solo.value); }}>S</button>}
      <button class={`tbtn${track.locked ? ' on' : ''}`} title={track.locked ? t('timeline.unlockTrack') : t('timeline.lockTrack')} onClick={toggle('locked', t('timeline.lockTrack'))}><Icon name={track.locked ? 'lock' : 'unlock'} size={12} /></button>
    </div>
  );
}
