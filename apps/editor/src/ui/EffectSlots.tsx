import { useEffect, useRef, useState } from 'preact/hooks';
import { DELAY_NOTES, SOUND_MIX_SCHEMA, pointer, type AudioEffect, type Composition, type SequenceTrack } from '@tramme/core';
import { chainText, EFFECT_KINDS, EFFECT_PRESETS, effectFields, startEffect } from '../effect-chain.ts';
import { S, commit } from '../state.ts';
import { t } from '../i18n/index.ts';
import { Popover } from './controls.tsx';
import { addTrackEffectOps, appendTrackEffectsOps, bypassTrackEffectOps, moveTrackEffectOps, removeTrackEffectOps, setTrackEffectOps } from './timeline/mixer.ts';

export const effectName = (kind: AudioEffect['kind']) => ({
  eq: t('audioEffects.eq'), compressor: t('audioEffects.compressor'), reverb: t('audioEffects.reverb'),
  lowCut: t('audioEffects.lowCut'), highCut: t('audioEffects.highCut'), delay: t('audioEffects.delay'), distortion: t('audioEffects.distortion'),
})[kind];
const presetName = (name: string) => ({
  'voice-cleanup': t('audioEffects.voiceCleanup'), 'music-under-voice': t('audioEffects.musicUnderVoice'),
  telephone: t('audioEffects.telephone'), 'big-room': t('audioEffects.bigRoom'),
} as Record<string, string>)[name] ?? name;
const fieldName = (name: string) => ({
  low: t('audioEffects.low'), mid: t('audioEffects.mid'), midFreq: t('audioEffects.midFreq'), midQ: t('audioEffects.midQ'),
  high: t('audioEffects.high'), amount: t('audioEffects.amount'), frequency: t('audioEffects.frequency'), wet: t('audioEffects.wet'),
  time: t('audioEffects.time'), feedback: t('audioEffects.feedback'), drive: t('audioEffects.drive'), tone: t('audioEffects.tone'),
} as Record<string, string>)[name] ?? name;

function Dialog({ anchor, title, close, children }: { anchor: HTMLElement; title: string; close: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button, input, select')?.focus(); }, []);
  return <Popover anchor={anchor} onClose={close} class="effect-popover">
    <div ref={ref} role="dialog" aria-label={title} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); anchor.isConnected && anchor.focus(); }
      if (event.key !== 'Tab') return;
      const focusable = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])];
      if (!focusable.length) return;
      const i = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && i === 0) { event.preventDefault(); focusable.at(-1)!.focus(); }
      else if (!event.shiftKey && i === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
    }}>
      <div class="effect-dialog-head"><strong>{title}</strong><button type="button" onClick={close} aria-label={t('audioEffects.close')}>×</button></div>
      {children}
    </div>
  </Popover>;
}

export function EffectSlots({ compId, c, track }: { compId: string; c: Composition; track: SequenceTrack }) {
  const [open, setOpen] = useState<{ anchor: HTMLElement; index: number | null } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const chain = track.effects ?? [], locked = !!track.locked;
  const current = () => S.doc.peek().compositions[compId];
  const write = (label: string, ops: ReturnType<typeof addTrackEffectOps>) => { if (ops.length) commit(label, ops); };
  const move = (from: number, to: number) => { write(t('audioEffects.move'), moveTrackEffectOps(current(), compId, track.id, from, to)); setOpen(null); };
  const edit = (index: number, effect: AudioEffect) => write(t('audioEffects.change'), setTrackEffectOps(current(), compId, track.id, index, effect));
  const active = open?.index == null ? null : chain[open.index];
  const tempo = c.sound?.tempo;
  return <div class="effect-row" aria-label={t('audioEffects.chain')}>
    <div class="effect-slots">
      {chain.map((effect, index) => <div class={`effect-slot${effect.bypass ? ' bypassed' : ''}`} key={index} draggable={!locked}
        onDragStart={(event) => { event.dataTransfer?.setData('application/x-tramme-effect', JSON.stringify({ compId, track: track.id, index })); }}
        onDragOver={(event) => { if (event.dataTransfer?.types.includes('application/x-tramme-effect')) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); try { const from = JSON.parse(event.dataTransfer?.getData('application/x-tramme-effect') ?? ''); if (from.compId === compId && from.track === track.id && Number.isInteger(from.index)) move(from.index, index); } catch { /* foreign drag */ } }}>
        <button type="button" disabled={locked} class="effect-slot-name" aria-label={`${effectName(effect.kind)} ${index + 1}`} title={`${effectName(effect.kind)} · ${chainText([effect])} · ${t('audioEffects.reorderHint')}`}
          onClick={(event) => setOpen({ anchor: event.currentTarget as HTMLElement, index })}
          onKeyDown={(event) => { if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); const to = index + (event.key === 'ArrowLeft' ? -1 : 1); if (to >= 0 && to < chain.length) { move(index, to); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-strip="${CSS.escape(track.id)}"] .effect-slot:nth-child(${to + 1}) .effect-slot-name`)?.focus()); } } }}>
          {effectName(effect.kind).slice(0, 3)}
        </button>
        <button type="button" disabled={locked || (!!effect.bypass && effect.kind === 'delay' && typeof effect.time === 'string' && tempo == null)} class="effect-slot-bypass" aria-label={`${effectName(effect.kind)}: ${t('audioEffects.bypass')}`} aria-pressed={!!effect.bypass} title={effect.kind === 'delay' && typeof effect.time === 'string' && tempo == null ? t('audioEffects.tempoNeeded') : t('audioEffects.bypass')}
          onClick={() => write(t('audioEffects.bypass'), bypassTrackEffectOps(current(), compId, track.id, index, !effect.bypass))}>⏻</button>
      </div>)}
    </div>
    <button ref={addRef} type="button" class="effect-add" disabled={locked} aria-label={t('audioEffects.add')} title={t('audioEffects.add')} onClick={(event) => setOpen({ anchor: event.currentTarget as HTMLElement, index: null })}>+</button>
    {open && <Dialog anchor={open.anchor} title={active ? effectName(active.kind) : t('audioEffects.add')} close={() => setOpen(null)}>
      {active && open.index !== null ? <>
        {effectFields(active.kind).map(({ key, min, max }) => key === 'time' && active.kind === 'delay' ? <div class="effect-field" key={key}>
          <label>{fieldName(key)}<select aria-label={t('audioEffects.timeUnit')} value={typeof active.time === 'number' ? 'ms' : active.time} onChange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            if (value === 'ms') edit(open.index!, { ...active, time: 280 });
            else edit(open.index!, { ...active, time: value as typeof active.time });
          }}><option value="ms">{t('audioEffects.milliseconds')}</option>{DELAY_NOTES.map((note) => <option value={note} disabled={tempo == null}>{note}</option>)}</select></label>
          {typeof active.time === 'number' && <label>{t('audioEffects.milliseconds')}<input type="number" min={min} max={max} step={1} value={active.time} onChange={(event) => { const input = event.currentTarget as HTMLInputElement; if (input.reportValidity()) edit(open.index!, { ...active, time: Number(input.value) }); }} /></label>}
        </div> : <label class="effect-field" key={key}>{fieldName(key)}<input type="number" min={min} max={max} step={key === 'frequency' || key === 'tone' || key === 'midFreq' ? 1 : 0.01}
          value={(active as unknown as Record<string, number>)[key]} onChange={(event) => { const input = event.currentTarget as HTMLInputElement; if (input.reportValidity()) edit(open.index!, { ...active, [key]: Number(input.value) } as AudioEffect); }} /></label>)}
        {active.kind === 'delay' && <label class="effect-field">{t('audioEffects.tempo')}<input type="number" min={SOUND_MIX_SCHEMA.tempo.min} max={SOUND_MIX_SCHEMA.tempo.max} step={1} value={tempo ?? ''} placeholder={t('audioEffects.tempoUnset')}
          onChange={(event) => { const input = event.currentTarget as HTMLInputElement; if (!input.value && typeof active.time === 'string' && !active.bypass) return; if (input.value && !input.reportValidity()) return; write(t('audioEffects.tempo'), [{ op: 'add', path: pointer('compositions', compId, 'sound'), value: { ...(current().sound ?? {}), tempo: input.value ? Number(input.value) : null } }]); }} /></label>}
        <div class="effect-actions"><button type="button" onClick={() => { write(t('audioEffects.remove'), removeTrackEffectOps(current(), compId, track.id, open.index!)); setOpen(null); addRef.current?.focus(); }}>{t('audioEffects.remove')}</button></div>
      </> : <>
        <div class="effect-list-title">{t('audioEffects.presets')}</div>
        <div class="effect-add-list">{Object.keys(EFFECT_PRESETS).map((name) => <button type="button" key={name} onClick={() => { write(t('audioEffects.addPreset'), appendTrackEffectsOps(current(), compId, track.id, EFFECT_PRESETS[name])); setOpen(null); addRef.current?.focus(); }}>{presetName(name)}</button>)}</div>
        <div class="effect-list-title">{t('audioEffects.effects')}</div>
        <div class="effect-add-list">{EFFECT_KINDS.map((kind) => <button type="button" key={kind} onClick={() => { write(t('audioEffects.add'), addTrackEffectOps(current(), compId, track.id, startEffect(kind))); setOpen(null); addRef.current?.focus(); }}>{effectName(kind)}</button>)}</div>
      </>}
    </Dialog>}
  </div>;
}
