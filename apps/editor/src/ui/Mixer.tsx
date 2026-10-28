// The mixer: one strip per sound track and bus, with its fader (dB), pan,
// mute, solo and the bus it feeds. With write armed, a fader moved while the
// film plays is recorded as the automation of the track's volume. The
// master shows the loudness the composition aims at and measures the mix.

import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { integratedLoudness, pointer, sampleKeyframes, staticValue, type Composition, type Keyframe, type SequenceTrack } from '@tramme/core';
import { mixComposition } from '@tramme/render';
import { cancelDraft, comp, commit, draft, S, toast, uiTime } from '../state.ts';
import { preview } from '../preview.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';
import { changeTrack } from './timeline/Tracks.tsx';
import { addBusOps, faderMoveOps, trackBusOps, trackPanOps, trackVolumeOps } from './timeline/mixer.ts';
import { clipsOn, soloOf } from './timeline/tracks.ts';

/** the tracks whose faders are recorded while the film plays */
const armed = signal<Set<string>>(new Set());

/** a track's volume at a moment: its still value, or its automation read there */
export function volumeAt(c: Composition, track: SequenceTrack, at: number): number {
  const v = track.volume;
  if (v && typeof v === 'object' && '$k' in v) return Number(sampleKeyframes('number', (v as { $k: Keyframe[] }).$k, at, S.doc.peek().tokens ?? {})) || 0;
  return Number(staticValue(v)) || 0;
}

function Strip({ compId, c, track }: { compId: string; c: Composition; track: SequenceTrack }) {
  const readings = useRef<[number, number][]>([]);
  const [held, setHeld] = useState<number | null>(null);
  const now = uiTime.value, automated = !!track.volume && typeof track.volume === 'object', write = armed.value.has(track.id);
  const db = held ?? volumeAt(c, track, now), buses = (c.tracks ?? []).filter((x) => x.bus && x.id !== track.id);
  const soloed = clipsOn(c, track.id).length > 0 && clipsOn(c, track.id).every((id) => S.solo.value.has(id));
  const recording = () => write && S.playing.peek();
  const move = (v: number) => {
    setHeld(v);
    if (recording()) readings.current.push([S.time.peek(), v]);
    else draft(trackVolumeOps(S.doc.peek().compositions[compId], compId, track.id, v));
  };
  const release = () => {
    const v = held;
    if (v !== null) {
      const doc = S.doc.peek().compositions[compId];
      if (readings.current.length) commit(t('timeline.automateVolume'), faderMoveOps(doc, compId, track.id, readings.current));
      else { cancelDraft(); commit(t('timeline.trackVolume'), trackVolumeOps(doc, compId, track.id, v)); }
    }
    readings.current = [];
    setHeld(null);
  };
  return (
    <div class={`strip${track.muted ? ' muted' : ''}`} data-strip={track.id}>
      <div class="strip-name" title={track.name || track.id}>{track.name || track.id}</div>
      <input class="fader" type="range" min={-60} max={12} step={0.5} value={db} aria-label={t('timeline.volume')}
        onInput={(e) => move(Number((e.target as HTMLInputElement).value))} onPointerUp={release} onKeyUp={release}
        onDblClick={() => commit(t('timeline.trackVolume'), trackVolumeOps(c, compId, track.id, 0))} />
      <div class="strip-db mono">{db > 0 ? '+' : ''}{db.toFixed(1)}{automated && !held ? ' ◆' : ''}</div>
      {!track.bus && <input class="pan" type="range" min={-1} max={1} step={0.05} value={track.pan ?? 0} aria-label={t('timeline.pan')} title={t('timeline.panHint')}
        onChange={(e) => commit(t('timeline.trackPan'), trackPanOps(S.doc.peek().compositions[compId], compId, track.id, Number((e.target as HTMLInputElement).value)))}
        onDblClick={() => commit(t('timeline.trackPan'), trackPanOps(c, compId, track.id, 0))} />}
      <div class="strip-keys">
        <button class={`tbtn${track.muted ? ' on' : ''}`} title={track.muted ? t('timeline.unmuteTrack') : t('timeline.muteTrack')} onClick={() => changeTrack(compId, track, { muted: !track.muted }, t('timeline.muteTrack'))}>M</button>
        {!track.bus && <button class={`tbtn${soloed ? ' on' : ''}`} title={soloed ? t('timeline.soloOff') : t('timeline.solo')} onClick={() => { S.solo.value = soloOf(c, track.id, S.solo.value); }}>S</button>}
        <button class={`tbtn${write ? ' on' : ''}`} title={t('timeline.writeAutomation')} onClick={() => { const s = new Set(armed.value); write ? s.delete(track.id) : s.add(track.id); armed.value = s; }}>W</button>
      </div>
      {!track.bus && (
        <select class="strip-bus" value={track.to ?? ''} aria-label={t('timeline.feedsBus')} onChange={(e) => commit(t('timeline.feedsBus'), trackBusOps(S.doc.peek().compositions[compId], compId, track.id, (e.target as HTMLSelectElement).value || null))}>
          <option value="">{t('timeline.noBus')}</option>
          {buses.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
        </select>
      )}
    </div>
  );
}

/** the loudness the composition aims at, and what its mix measures */
function Master({ compId, c }: { compId: string; c: Composition }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const target = c.sound?.loudness === null || c.sound?.loudness === undefined ? null : Number(staticValue(c.sound.loudness));
  const measure = async () => {
    const r = preview.renderer;
    if (!r) return;
    setBusy(true);
    try {
      const buf = await mixComposition(S.doc.peek(), compId, (id) => r.assets.url(id), { master: false });
      setMeasured(buf ? integratedLoudness([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate) : null);
      if (!buf) toast(t('timeline.noSoundToMeasure'), 'info');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div class="strip master">
      <div class="strip-name">{t('timeline.master')}</div>
      <div class="loudness">
        <label>{t('timeline.loudnessTarget')}
          <input type="number" min={-40} max={0} step={1} value={target ?? ''} placeholder={t('timeline.asMixed')}
            onChange={(e) => { const v = (e.target as HTMLInputElement).value; commit(t('timeline.loudnessTarget'), [{ op: 'add', path: pointer('compositions', compId, 'sound'), value: { ...(c.sound ?? {}), loudness: v === '' ? null : Number(v) } }]); }} />
        </label>
        <div class="meter" aria-label={t('timeline.loudness')}>
          {target !== null && <i class="target" style={{ left: `${Math.max(0, Math.min(100, ((target + 40) / 40) * 100))}%` }} title={`${target} LUFS`} />}
          {measured !== null && Number.isFinite(measured) && <i class="level" style={{ width: `${Math.max(0, Math.min(100, ((measured + 40) / 40) * 100))}%` }} />}
        </div>
        <button class="btn sm" disabled={busy} onClick={() => void measure()}>{busy ? t('timeline.measuring') : t('timeline.measure')}</button>
        {measured !== null && Number.isFinite(measured) && <span class="mono">{measured.toFixed(1)} LUFS</span>}
      </div>
    </div>
  );
}

export function Mixer() {
  const c = comp.value, compId = S.compId.value;
  const sound = (c.tracks ?? []).filter((x) => x.kind === 'audio');
  return (
    <div class="mixer">
      {sound.length === 0 && <div class="empty"><Icon name="audio" />{t('timeline.noSoundTracks')}</div>}
      {sound.filter((x) => !x.bus).concat(sound.filter((x) => x.bus)).map((track) => <Strip key={track.id} compId={compId} c={c} track={track} />)}
      <button class="btn sm ghost add-bus" onClick={() => commit(t('timeline.addBus'), addBusOps(S.doc.peek().compositions[compId], compId).ops)}><Icon name="plus" />{t('timeline.addBus')}</button>
      <Master compId={compId} c={c} />
    </div>
  );
}
