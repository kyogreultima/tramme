// The studio: the film in front, directed in words. Nothing to operate: the
// user says what they want in the direction bar — about the whole film, a
// scene put in focus on the storyboard, or a point of the picture the note is
// pinned on — and the assistant carries it out. Its work shows as stages over
// the film, its result as a take to compare before and after, to keep, set
// aside or do again another way. The notes and the direction it follows sit
// beside the film; the layers, the timeline and the inspector wait in the
// atelier for the detail.

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Vec2 } from '@tramme/core';
import { aiRoute } from '../ai/index.ts';
import { running, stop, togglePause, turnStart } from '../ai/conversation.ts';
import { paused } from '../ai/calls.ts';
import { draft } from '../attachments.ts';
import { IDEAS } from '../ideas.ts';
import { comp, S, uiTime } from '../state.ts';
import { timecode } from '../model.ts';
import { addRetouch, anchor, direct, focused, focusScene, liveStage, noteSent, sendRetouches, STAGE_LABEL, studio, takes, turns } from '../studio.ts';
import { Composer, join } from './composer.tsx';
import { useSize } from './controls.tsx';
import { Lightbox, progressOf, useElapsed } from './chat.tsx';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';
import { SidePanel } from './Notes.tsx';
import { TakeActions } from './thread.tsx';
import { Overlays, useShortcuts } from './shell.tsx';
import { AreaReview, Marks, PinChips, PinTools, pressPicture, RetouchList } from './Retouch.tsx';
import { Storyboard } from './Storyboard.tsx';
import { TopBar } from './TopBar.tsx';
import { Viewport } from './Viewport.tsx';
import { m, t } from '../i18n/index.ts';

/** a phone: the direction bar at the bottom of the screen, the film above the notes */
const NARROW = '(max-width: 760px)';

/** a suggestion over the direction bar: sent as a note at once, or its words put in the bar to finish */
interface Suggestion { label: string; words: string; fill?: boolean }
const S_ = (label: string, words: string, fill = false): Suggestion => ({ label, words, fill });

/** an empty project: what to start from (the words to finish) */
const STARTERS = IDEAS.map((i) => S_(i.label, i.words, true));
/** the whole film */
const FILM = [
  S_(m('studio.chips.review'), m('studio.chips.reviewWords')),
  S_(m('studio.chips.pace'), m('studio.chips.paceWords')),
  S_(m('studio.chips.palette'), m('studio.chips.paletteWords')),
  S_(m('studio.chips.sound'), m('studio.chips.soundWords')),
  S_(m('studio.chips.vertical'), m('studio.chips.verticalWords')),
];
/** the scene in focus */
const SCENE = [
  S_(m('studio.chips.impact'), m('studio.chips.impactWords')),
  S_(m('studio.chips.calmer'), m('studio.chips.calmerWords')),
  S_(m('studio.chips.layout'), m('studio.chips.layoutWords')),
  S_(m('studio.chips.shorter'), m('studio.chips.shorterWords')),
  S_(m('studio.chips.redo'), m('studio.chips.redoWords'), true),
];

function Chips({ empty }: { empty: boolean }) {
  if (running.value || S.proposal.value?.status === 'pending' || aiRoute.value === null || studio.pins.value.length) return null;
  const list = empty ? STARTERS : focused.value ? SCENE : FILM;
  return (
    <div class="chips">
      {list.map((c) => (
        <button key={c.label} class={`chip${c.fill ? ' fill' : ''}`} title={c.fill ? t('studio.chipFillHint') : t(c.words)}
          onClick={() => { if (c.fill) draft.value = t(c.words); else direct(t(c.words)); }}>
          {t(c.label)}
        </button>
      ))}
    </div>
  );
}

/** the assistant at work, over the film: the stage it is at, for how long, and the way to pause or stop it */
function WorkPill() {
  const work = turns.value.at(-1)?.work ?? [];
  const stage = liveStage(work), secs = useElapsed(turnStart.value, true), hold = paused.value;
  const tool = [...work].reverse().find((it) => it.tool && !it.tool.done)?.tool;
  const pct = tool ? progressOf(tool) : null;
  return (
    <div class="pill work-pill" role="status">
      <span class={`mark${hold ? '' : ' working'}`}><LogoMark /></span>
      <span class="stage-name">{hold ? t('studio.paused') : stage ? t(STAGE_LABEL[stage]) : t('studio.working')}</span>
      {tool && !hold && <span class="pill-detail">{tool.summary}</span>}
      {pct !== null && <span class="progress"><i style={{ width: `${pct}%` }} /></span>}
      <span class="mono faint">{secs} s</span>
      <button class="pill-stop pause" title={hold ? t('assistant.resume') : t('assistant.pause')} onClick={togglePause}><Icon name={hold ? 'play' : 'pause'} /></button>
      <button class="pill-stop" title={t('assistant.stop')} onClick={stop}><Icon name="stop" /></button>
    </div>
  );
}

/** the take on screen, over the film: compare it with before, keep it, set it aside, or another */
function TakePill() {
  const p = S.proposal.value!;
  return (
    <div class="pill take-pill">
      <span class="take-n"><Icon name="clap" />{t('studio.takeN', { n: takes.value.get(p.id) ?? 1 })}</span>
      <span class="take-label" title={p.label}>{p.label}</span>
      <TakeActions another />
    </div>
  );
}

/** what the note will be about, and the pin */
function DirectBar({ area }: { area: RefObject<HTMLTextAreaElement> }) {
  const pin = studio.pins.value.length > 0, pinning = studio.pinning.value, f = focused.value, fps = comp.value.fps;
  const placeholder = pin ? t('studio.placeholderPin') : f ? t('studio.placeholderScene', { name: f.name }) : t('studio.placeholder');
  const context = (
    <span class="direct-context">
      {f
        ? <button class="ctx-chip on" title={t('studio.clearFocus')} onClick={() => focusScene(null)}><Icon name="target" /><span>{f.name}</span><Icon name="x" /></button>
        : <span class="ctx-chip" title={t('studio.wholeFilmHint')}><Icon name="film" /><span>{t('studio.wholeFilm')}</span></span>}
      <span class="ctx-chip mono" title={t('studio.momentHint')}>{timecode(uiTime.value, fps)}</span>
      <PinChips />
    </span>
  );
  const tools = <PinTools />;
  const list = { count: studio.retouches.value.length, onAdd: (text: string, voice: boolean) => addRetouch(text, voice), onSendAll: () => { void sendRetouches(); } };
  return (
    <div class={`direct${pinning ? ' pinning' : ''}`} data-tour="direct">
      {pinning && <div class="direct-hint"><Icon name={studio.tool.value === 'point' ? 'pin' : studio.tool.value === 'path' ? 'curve' : 'box'} />{studio.tool.value === 'point' ? t('studio.pinNow') : studio.tool.value === 'path' ? t('studio.pathNow') : t('studio.areaNow')}</div>}
      <Composer placeholder={placeholder} anchor={anchor} tools={tools} context={context} onSent={noteSent} area={area} list={list} />
    </div>
  );
}

/** an empty film: what to do; while the assistant makes the first one, what it is doing */
function Invitation() {
  const busy = running.value;
  const stage = busy ? liveStage(turns.value.at(-1)?.work ?? []) : null;
  return (
    <div class={`invite${busy ? ' making' : ''}`}>
      <div class="invite-mark"><LogoMark size={28} /></div>
      {busy
        ? <><h2>{stage ? t(STAGE_LABEL[stage]) : t('studio.working')}…</h2><p>{t('studio.makingText')}</p></>
        : <><h2>{t('studio.inviteTitle')}</h2><p>{t('studio.inviteText')}</p></>}
    </div>
  );
}

/** the studio's own keys: N writes a note, P pins the next one, Escape lets go of the pin and the focus */
function useStudioKeys(area: RefObject<HTMLTextAreaElement>) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) {
        if (e.key === 'Escape' && el === area.current && (studio.pins.peek().length || studio.pinning.peek() || studio.review.peek())) { noteSent(); }
        return;
      }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); area.current?.focus(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); studio.pinning.value = !studio.pinning.peek(); S.playing.value = false; }
      else if (e.key === 'Escape') {
        if (studio.pins.peek().length || studio.pinning.peek() || studio.review.peek()) noteSent();
        else focusScene(null);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
}

export function Studio() {
  useShortcuts();
  const area = useRef<HTMLTextAreaElement>(null);
  useStudioKeys(area);
  const busy = running.value, pending = S.proposal.value?.status === 'pending';
  const root = S.doc.value.compositions[S.doc.value.root];
  const empty = !root || Object.keys(root.layers).length === 0;
  // the room the direction bar takes over the bottom of the film (on a phone it sits at the bottom of the screen instead)
  const foot = useRef<HTMLDivElement>(null);
  const [footH, setFootH] = useState(110);
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useLayoutEffect(() => {
    // the film keeps the room of the box at its tallest: the words neither shrink it nor cover it
    const measure = () => {
      const el = area.current, box = el?.offsetHeight ?? 0;
      const tallest = el ? parseFloat(getComputedStyle(el).maxHeight) || box : 0;
      setFootH(Math.round(foot.current!.offsetHeight + Math.max(0, tallest - box)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(foot.current!);
    if (area.current) ro.observe(area.current);
    const mq = matchMedia(NARROW), change = () => setNarrow(mq.matches);
    mq.addEventListener('change', change);
    return () => { ro.disconnect(); mq.removeEventListener('change', change); };
  }, []);
  // a press on the picture draws with the tool in hand: a point, a path to follow, a group to select
  const press = (p: Vec2, e: PointerEvent, hit: () => string | null, toComp: (e: { clientX: number; clientY: number }) => Vec2) => pressPicture(p, e, hit, toComp, area);
  // the notes beside the film widen or narrow like the atelier's panels
  const [sideW, sideHandle] = useSize('studio-side', 384, 330, 640);
  const [dropping, setDropping] = useState(false);
  // a turn starting on an empty film, or a note left: the notes in front
  useEffect(() => { if (busy) studio.panel.value = 'notes'; }, [busy]);
  return (
    <div class={`studio${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => { if (aiRoute.peek() && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget || !(e.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={(e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); setDropping(false); join(e.dataTransfer.files); requestAnimationFrame(() => area.current?.focus()); }}>
      <TopBar />
      <div class="studio-body" style={{ '--side-w': `${sideW}px` }}>
        <main class="studio-main">
          <section class={`studio-stage${busy ? ' working' : ''}${pending ? ' has-take' : ''}${studio.pinning.value ? ' pinning' : ''}${empty ? ' is-empty' : ''}`} data-tour="stage">
            <Viewport bare inset={narrow ? [52, 12, 14, 12] : [60, 32, footH + 22, 32]} overlay={<Marks />} intercept={press} />
            {empty && <Invitation />}
            <div class="stage-top">{busy ? <WorkPill /> : pending ? <TakePill /> : null}</div>
            <div class="stage-foot" ref={foot}>
              <AreaReview />
              <RetouchList />
              <Chips empty={empty} />
              <DirectBar area={area} />
            </div>
          </section>
          <Storyboard />
        </main>
        <div class="resizer v" {...sideHandle('x', -1)} />
        <SidePanel />
      </div>
      {dropping && <div class="drop-hint"><Icon name="upload" /><span>{t('studio.dropHint')}</span></div>}
      <Lightbox />
      <Overlays />
    </div>
  );
}
