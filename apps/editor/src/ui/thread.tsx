// The conversation as a thread: the notes (what the user wants, written at a
// moment of the film), and under each one the assistant's work — its stages,
// what it looked at, what it says, and the takes it proposes. Shared by the
// studio's side panel and the atelier's assistant: one thread, one look.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChatItem } from '../api.ts';
import { aiRoute, aiSettings, chat } from '../ai/index.ts';
import { modelLabel } from '@tramme/assistant';
import { decide, lightbox, running, stop, togglePause, turnStart } from '../ai/conversation.ts';
import { paused } from '../ai/calls.ts';
import { S, setTime } from '../state.ts';
import { timecode } from '../model.ts';
import { anotherTake, liveScene, liveStage, notes, STAGE_LABEL, STAGES, stagesOf, studio, takes, turns, type Stage, type Turn } from '../studio.ts';
import { Access, FileChip, Markdown, OpLines, QuestionCard, Thinking, ToolLine, UsageLine, useElapsed } from './chat.tsx';
import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { Seg } from './controls.tsx';
import { LogoMark } from './Logo.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

/** the take on screen: before or after it, set aside or kept; over the film, another one a click away too */
export function TakeActions({ another = false }: { another?: boolean }) {
  const after = S.showProposal.value;
  return (
    <div class="take-actions">
      <Seg value={after ? 'after' : 'before'} options={[['before', t('studio.before')], ['after', t('studio.after')]]} ariaLabel={t('studio.beforeAfter')} onChange={(v) => { S.showProposal.value = v === 'after'; }} />
      <span class="grow" />
      {another && <button class="icon-btn sm" title={t('studio.anotherTakeHint')} onClick={anotherTake}><Icon name="shuffle" /></button>}
      <button class="btn sm" onClick={() => decide(false)}>{t('studio.setAside')}</button>
      <button class="btn sm primary" onClick={() => decide(true)}><Icon name="check" />{t('studio.keep')}</button>
    </div>
  );
}

/** a take the assistant proposed: its number, what it does, and what became of it */
export function TakeCard({ p }: { p: NonNullable<ChatItem['proposal']> }) {
  const live = S.proposal.value?.id === p.id ? S.proposal.value.status : p.status;
  const n = takes.value.get(p.id) ?? 1;
  const here = live === 'pending' && S.proposal.value?.id === p.id;
  return (
    <div class={`take ${live}`}>
      <div class="take-head">
        <span class="take-n"><Icon name="clap" />{t('studio.takeN', { n })}</span>
        <span class="take-label" title={p.label}>{p.label}</span>
        {!here && <span class={`take-state ${live}`}>{live === 'accepted' ? t('studio.kept') : live === 'rejected' ? t('studio.setAsideDone') : t('studio.waiting')}</span>}
      </div>
      {here && <TakeActions />}
      <div class="take-foot">
        <details class="take-ops">
          <summary>{p.count > 1 ? t('assistant.nChanges', { n: p.count }) : t('assistant.n1Change')}</summary>
          <OpLines p={p} />
        </details>
        {here && <button class="take-again" title={t('studio.anotherTakeHint')} onClick={anotherTake}><Icon name="shuffle" />{t('studio.anotherTake')}</button>}
      </div>
    </div>
  );
}

/** the stages of the work, in the order they came */
function Pipeline({ stages, open, steps, onToggle }: { stages: Stage[]; open: boolean; steps: number; onToggle: () => void }) {
  return (
    <button class={`pipeline${open ? ' open' : ''}`} onClick={onToggle} title={open ? t('studio.hideSteps') : t('studio.showSteps')}>
      {stages.map((s) => <span key={s} class="tag"><i />{t(STAGE_LABEL[s])}</span>)}
      <span class="steps">{steps === 1 ? t('studio.oneStep') : t('studio.nSteps', { n: steps })}<Icon name={open ? 'chevronDown' : 'chevron'} /></span>
    </button>
  );
}

/** what the assistant says; a long report (a tool's findings) folded to its first lines */
function Said({ text }: { text: string }) {
  const long = text.length > 700 || text.split('\n').length > 12;
  const [open, setOpen] = useState(false);
  return (
    <div class={`work-text${long && !open ? ' folded' : ''}`}>
      <Markdown text={text} />
      {long && <button class="work-more" onClick={() => setOpen(!open)}>{open ? t('studio.less') : t('studio.more')}</button>}
    </div>
  );
}

const Step = ({ it }: { it: ChatItem }) => (it.tool ? <ToolLine tool={it.tool} /> : <Thinking th={it.thinking!} />);

/** the turn under way: what it does now and for how long, the model, how far through the stages, its last steps, and the way to pause or stop it */
function Run({ work, steps, open, onToggle }: { work: ChatItem[]; steps: ChatItem[]; open: boolean; onToggle: () => void }) {
  const secs = useElapsed(turnStart.value, true), hold = paused.value;
  const now = liveStage(work), seen = stagesOf(work), scene = liveScene(work);
  const doing = [...work].reverse().find((it) => it.tool && !it.tool.done)?.tool;
  const head = hold ? t('studio.paused') : doing?.summary ?? (now ? t(STAGE_LABEL[now]) : t('studio.working'));
  const n = now ? STAGES.indexOf(now) + 1 : 0;
  return (
    <div class={`run${hold ? ' paused' : ''}`} role="status">
      <div class="run-head">
        <span class={`mark${hold ? '' : ' working'}`}><LogoMark /></span>
        <span class="run-now" title={head}>{head}</span>
        <span class="mono">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      </div>
      <div class="run-meta">
        <span>{modelLabel(aiSettings.value.model)}</span>
        {scene && <span>{t('studio.building', { scene })}</span>}
        {now && <span>{t(STAGE_LABEL[now])} · {t('studio.stageNofM', { n, total: STAGES.length })}</span>}
      </div>
      <div class="run-bar">{STAGES.map((s) => <i key={s} class={s === now ? 'now' : seen.includes(s) ? 'done' : ''} />)}</div>
      {steps.length > 0 && <div class="run-steps">{(open ? steps : steps.slice(-3)).map((it) => <Step key={it.id} it={it} />)}</div>}
      <div class="run-actions">
        <button class="btn sm outline" onClick={togglePause}><Icon name={hold ? 'play' : 'pause'} />{hold ? t('assistant.resume') : t('assistant.pause')}</button>
        <button class="btn sm outline" onClick={stop}><Icon name="stop" />{t('assistant.stop')}</button>
        <span class="grow" />
        {steps.length > 3 && <button class="btn sm ghost" onClick={onToggle}>{open ? t('studio.hideSteps') : t('studio.allSteps', { n: steps.length })}<Icon name={open ? 'chevronDown' : 'chevron'} /></button>}
      </div>
    </div>
  );
}

/** the work cut where the scene it was made for changes: plain stretches, and scenes built apart */
function segments(work: ChatItem[]): { building?: string; items: ChatItem[] }[] {
  const out: { building?: string; items: ChatItem[] }[] = [];
  for (const it of work) { const last = out.at(-1); if (last && last.building === it.building) last.items.push(it); else out.push({ building: it.building, items: [it] }); }
  return out;
}

/** one scene built apart: its name, the stages it went through, what it said and what it cost */
function SceneWork({ name, items }: { name: string; items: ChatItem[] }) {
  const [open, setOpen] = useState(false);
  const stages = stagesOf(items), steps = items.filter((it) => it.tool || it.thinking), usage = items.find((it) => it.usage)?.usage;
  return (
    <div class="work scene">
      <div class="scene-name">{name}</div>
      {stages.length > 0 && <Pipeline stages={stages} open={open} steps={steps.length} onToggle={() => setOpen(!open)} />}
      {open && <div class="work-steps">{steps.map((it) => <Step key={it.id} it={it} />)}</div>}
      {items.map((it) => (it.text !== undefined && !it.tool && !it.thinking && it.text.trim() ? <Said key={it.id} text={it.text} /> : null))}
      {usage && <UsageLine u={usage} />}
    </div>
  );
}

/** what the assistant did after a note; the scenes built apart each under their own name */
export function Work({ work, live }: { work: ChatItem[]; live: boolean }) {
  if (live || !work.some((it) => it.building)) return <Plain work={work} live={live} />;
  return <>{segments(work).map((s, i) => (s.building ? <SceneWork key={i} name={s.building} items={s.items} /> : <Plain key={i} work={s.items} live={false} />))}</>;
}

function Plain({ work, live }: { work: ChatItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const stages = stagesOf(work);
  const steps = work.filter((it) => it.tool || it.thinking);
  const shots = work.filter((it) => it.image);
  const usage = work.find((it) => it.usage)?.usage;
  return (
    <div class={`work${live ? ' live' : ''}`}>
      {live ? <Run work={work} steps={steps} open={open} onToggle={() => setOpen(!open)} /> : (
        <>
          <div class="work-head">
            <span class="mark"><LogoMark /></span>
            <b>Tramme</b>
          </div>
          {stages.length > 0 && <Pipeline stages={stages} open={open} steps={steps.length} onToggle={() => setOpen(!open)} />}
          {open && <div class="work-steps">{steps.map((it) => <Step key={it.id} it={it} />)}</div>}
        </>
      )}
      {shots.length > 0 && (
        <div class="work-shots">
          {shots.slice(-6).map((it) => <button key={it.id} class="work-shot" title={it.image!.caption} onClick={() => { lightbox.value = it.image!.url; }}><img src={it.image!.url} alt={it.image!.caption} loading="lazy" /></button>)}
        </div>
      )}
      {work.map((it) => (it.text !== undefined && !it.tool && !it.thinking && it.text.trim() ? <Said key={it.id} text={it.text} /> : null))}
      {work.map((it) => (it.proposal ? <TakeCard key={it.id} p={it.proposal} /> : null))}
      {usage && <UsageLine u={usage} />}
    </div>
  );
}

/** a note: its number, when and where it was left, its words */
export function Note({ note, n }: { note: ChatItem; n: number }) {
  const fps = S.doc.value.compositions[S.compId.value]?.fps ?? 30;
  return (
    <div class={`note${studio.flash.value === note.id ? ' flash' : ''}`} data-note={note.id}>
      <div class="note-head">
        <span class="note-n">{n}</span>
        <span class="note-who">{t('studio.you')}</span>
        {note.at !== undefined && <button class="note-tc" title={t('studio.goThere')} onClick={() => setTime(note.at!)}>{timecode(note.at, fps)}</button>}
        {note.scene && <span class="note-scene" title={t('studio.aboutScene')}><Icon name="target" />{note.scene}</span>}
        {note.pin && <span class="note-pin" title={t('studio.pinnedHere')}><Icon name="pin" /></span>}
      </div>
      {note.attachments?.length ? <div class="msg-files">{note.attachments.map((a) => <FileChip key={a.path} a={a} />)}</div> : null}
      <div class="note-text">{note.text}</div>
    </div>
  );
}

/** a turn, drawn again only when it changed (a turn object is kept while its items are: see studio.ts) */
export const TurnView = memo(function TurnView({ turn, live }: { turn: Turn; live: boolean }) {
  return (
    <article class="turn">
      {turn.note && <Note note={turn.note} n={turn.n} />}
      {(turn.work.length > 0 || live) && <Work work={turn.work} live={live} />}
    </article>
  );
});

/** the thread itself: the turns, the access when there is none, the question being asked */
export function Thread({ empty }: { empty?: ComponentChildren }) {
  const list = turns.value, busy = running.value, available = aiRoute.value !== null;
  const scroller = useRef<HTMLDivElement>(null);
  const items = chat.value;
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length, items.at(-1)?.text]);
  // a note asked from the storyboard or a pin: brought into view, lit for a moment
  const flash = studio.flash.value;
  useFlash(flash, scroller);
  return (
    <div class="thread" ref={scroller}>
      {!list.length && (empty ?? null)}
      {list.map((turn, i) => <TurnView key={turn.note?.id ?? turn.work[0]?.id ?? i} turn={turn} live={busy && i === list.length - 1} />)}
      {!available && !busy && <Access />}
      <QuestionCard />
    </div>
  );
}

/** a note asked from elsewhere: brought into view, lit for a moment */
function useFlash(flash: string | null, scroller: { current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    if (!flash) return;
    scroller.current?.querySelector(`[data-note="${flash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => { studio.flash.value = null; }, 1600);
    return () => clearTimeout(timer);
  }, [flash]);
}

/** how many notes the thread holds (the studio's tab shows it) */
export const noteCount = () => notes.value.length;
