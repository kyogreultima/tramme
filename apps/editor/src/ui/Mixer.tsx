// The mixer: one strip per sound track and bus, with its fader (dB), pan,
// mute, solo and the bus it feeds. With write armed, a fader moved while the
// film plays is recorded as the automation of the track's volume. The
// master shows the loudness the composition aims at and measures the mix.

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { integratedLoudness, pointer, sampleKeyframes, soundMix, staticValue, type Composition, type Keyframe, type SequenceTrack } from '@tramme/core';
import { mixComposition } from '@tramme/render';
import { cancelDraft, comp, commit, draft, S, toast, uiTime } from '../state.ts';
import { preview } from '../preview.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';
import { changeTrack } from './timeline/Tracks.tsx';
import { addBusOps, duckTrackOps, faderMoveOps, trackBusOps, trackPanOps, trackVolumeOps } from './timeline/mixer.ts';
import { clipsOn, soloOf } from './timeline/tracks.ts';
import { MASTER_METER_ID, METER_FLOOR, type LevelReading } from '../audio-meters.ts';
import { EffectSlots } from './EffectSlots.tsx';
import { Popover } from './controls.tsx';

/** the tracks whose faders are recorded while the film plays */
const armed = signal<Set<string>>(new Set());
const levels = signal<Record<string, LevelReading>>({});
const meterPosition = (db: number) => `${Math.max(0, Math.min(100, (db - METER_FLOOR) / -METER_FLOOR * 100))}%`;

function LiveMeter({ id }: { id: string }) {
  const level = levels.value[id];
  const peak = level?.peak ?? METER_FLOOR;
  const details = `${t('timeline.peakLevel')}: ${peak.toFixed(1)} dBFS; RMS: ${(level?.rms ?? METER_FLOOR).toFixed(1)} dBFS; ${t('timeline.peakHold')}: ${(level?.hold ?? METER_FLOOR).toFixed(1)} dBFS`;
  return <div class="strip-level">
    <div class="meter-line">
    <div class="live-meter" role="meter" aria-label={t('timeline.peakLevel')} aria-valuemin={METER_FLOOR} aria-valuemax={0} aria-valuenow={Math.min(0, peak)} aria-valuetext={details} title={details}>
      <i class="peak" style={{ width: meterPosition(peak) }} />
      <i class="rms" style={{ width: meterPosition(level?.rms ?? METER_FLOOR) }} />
      <i class="hold" style={{ left: meterPosition(level?.hold ?? METER_FLOOR) }} />
    </div>
    <button class={`clip-indicator${level?.clipped ? ' on' : ''}`} aria-label={t('timeline.resetClip')} title={t('timeline.clipIndicator')} aria-pressed={level?.clipped ?? false} onClick={() => preview.meters.reset(id)} />
    </div>
    <span class="mono strip-db" title={t('timeline.peakLevel')}>{peak.toFixed(1)} dBFS</span>
  </div>;
}

/** a track's volume at a moment: its still value, or its automation read there */
export function volumeAt(c: Composition, track: SequenceTrack, at: number): number {
  const v = track.volume;
  if (v && typeof v === 'object' && '$k' in v) return Number(sampleKeyframes('number', (v as { $k: Keyframe[] }).$k, at, S.doc.peek().tokens ?? {})) || 0;
  return Number(staticValue(v)) || 0;
}

function Strip({ compId, c, track }: { compId: string; c: Composition; track: SequenceTrack }) {
  const readings = useRef<[number, number][]>([]);
  const [held, setHeld] = useState<number | null>(null);
  const [duckAnchor, setDuckAnchor] = useState<HTMLElement | null>(null);
  const now = uiTime.value, automated = !!track.volume && typeof track.volume === 'object', write = armed.value.has(track.id);
  const db = held ?? volumeAt(c, track, now), buses = (c.tracks ?? []).filter((x) => x.bus && x.id !== track.id);
  const voiceTracks = (c.tracks ?? []).filter((x) => x.kind === 'audio' && !x.bus && x.id !== track.id);
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
      <LiveMeter id={track.id} />
      <EffectSlots compId={compId} c={c} track={track} />
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
        {!track.bus && voiceTracks.length > 0 && <button class={`tbtn${track.duckUnder ? ' on' : ''}`} type="button" title={t('timeline.duckUnderTrack')} aria-label={t('timeline.duckUnderTrack')} onClick={(e) => setDuckAnchor(e.currentTarget as HTMLElement)}>D</button>}
      </div>
      {!track.bus && (
        <select class="strip-bus" value={track.to ?? ''} aria-label={t('timeline.feedsBus')} onChange={(e) => commit(t('timeline.feedsBus'), trackBusOps(S.doc.peek().compositions[compId], compId, track.id, (e.target as HTMLSelectElement).value || null))}>
          <option value="">{t('timeline.noBus')}</option>
          {buses.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}</option>)}
        </select>
      )}
      {duckAnchor && <Popover anchor={duckAnchor} onClose={() => setDuckAnchor(null)} class="effect-popover"><label class="effect-field">{t('timeline.duckUnderTrack')}<select autoFocus value={track.duckUnder ?? ''} onChange={(e) => { commit(t('timeline.duckUnderTrack'), duckTrackOps(S.doc.peek().compositions[compId], compId, track.id, (e.currentTarget as HTMLSelectElement).value || null)); setDuckAnchor(null); }}>
        <option value="">{t('timeline.noDuckTrack')}</option>
        {voiceTracks.map((source) => <option key={source.id} value={source.id}>{source.name || source.id}</option>)}
      </select></label></Popover>}
    </div>
  );
}

/** the loudness the composition aims at, and what its mix measures */
function Master({ compId, c }: { compId: string; c: Composition }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const target = soundMix(c).loudness;
  const playing = S.playing.value, live = levels.value[MASTER_METER_ID];
  const shown = playing ? live?.lufs ?? null : measured;
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
      <LiveMeter id={MASTER_METER_ID} />
      <div class="loudness">
        <label>{t('timeline.loudnessTarget')}
          <input type="number" min={-31} max={-6} step={1} value={target ?? ''} placeholder={t('timeline.asMixed')}
            onChange={(e) => { const v = (e.target as HTMLInputElement).value; commit(t('timeline.loudnessTarget'), [{ op: 'add', path: pointer('compositions', compId, 'sound'), value: { ...(c.sound ?? {}), loudness: v === '' ? null : Number(v) } }]); }} />
        </label>
        <div class="meter" aria-label={t('timeline.loudness')}>
          {target !== null && <i class="target" style={{ left: `${Math.max(0, Math.min(100, ((target + 40) / 40) * 100))}%` }} title={`${target} LUFS`} />}
          {shown !== null && Number.isFinite(shown) && <i class="level" style={{ width: `${Math.max(0, Math.min(100, ((shown + 40) / 40) * 100))}%` }} />}
        </div>
        {playing && <div class="master-figures">
          <span class="short-term">{t('timeline.shortTermLoudness')}: {live?.lufs != null ? `${live.lufs.toFixed(1)} LUFS` : t('timeline.measuring')}</span>
          <span>{t('timeline.truePeak')}: {(live?.truePeak ?? METER_FLOOR).toFixed(1)} dBTP</span>
        </div>}
        <button class="btn sm" disabled={busy || playing} onClick={() => void measure()}>{busy ? t('timeline.measuring') : t('timeline.measure')}</button>
        {!playing && measured !== null && Number.isFinite(measured) && <span class="mono">{measured.toFixed(1)} LUFS</span>}
      </div>
    </div>
  );
}

export function Mixer() {
  useEffect(() => {
    preview.meters.show(true);
    let frame = 0;
    const read = (now: number) => {
      levels.value = preview.meters.read(now / 1000);
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => { cancelAnimationFrame(frame); preview.meters.show(false); levels.value = {}; };
  }, []);
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
