// The pieces of a conversation with the assistant, shared by the assistant
// panel of the atelier and the notes of the studio: the words (light
// markdown), what the assistant thinks, its activity, the files joined to a
// message, what a turn cost, the question asked during a turn, and how to
// reach a model when none answers.

import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChatItem, TurnUsage } from '../api.ts';
import { engineOf, modelLabel, providerOf } from '@tramme/assistant';
import { aiSettings, aiStatus, CLI_SETUP, cliUnavailable, providerLabel, refreshStatus, setAiSettings } from '../ai/index.ts';
import { lightbox, running } from '../ai/conversation.ts';
import { openSettings } from '../settings.ts';
import { S, toast } from '../state.ts';
import { answer, chatShown, choose, question, type Question } from '../confirm.ts';
import { attachmentUrl, type Attachment } from '../attachments.ts';
import { Icon } from './icons.tsx';
import { TranscribeButton } from './Transcribe.tsx';
import { locale, t } from '../i18n/index.ts';

// ── light markdown: paragraphs, lists, code, bold, inline code ──
function inline(s: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[0][0] === '`' ? <code>{m[0].slice(1, -1)}</code> : <strong>{m[0].slice(2, -2)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const blocks: ComponentChildren[] = [];
  const parts = text.split(/```[\w-]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2) { blocks.push(<pre key={i}>{part.replace(/\n$/, '')}</pre>); return; }
    for (const [j, para] of part.split(/\n{2,}/).entries()) {
      const lines = para.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) blocks.push(<ul key={`${i}.${j}`}>{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>)}</ul>);
      else blocks.push(<p key={`${i}.${j}`}>{lines.map((l, k) => <>{k > 0 && <br />}{inline(l)}</>)}</p>);
    }
  });
  return <div class="text">{blocks}</div>;
}

/** the changes of a proposal, one line each: added, removed or changed */
export function OpLines({ p }: { p: NonNullable<ChatItem['proposal']> }) {
  return (
    <ul class="op-lines">
      {p.lines.map((l, i) => { const [op, what] = l.split('\t'); return <li key={i}><span class={`op ${op}`}>{op === 'add' ? '+' : op === 'remove' ? '−' : '~'}</span><span class="what" title={what}>{what}</span></li>; })}
      {p.count > p.lines.length && <li class="faint">{t('assistant.nMore', { n: p.count - p.lines.length })}</li>}
    </ul>
  );
}

/** how far a running tool is, in percent; null when it does not say (a plugin may report a total it does not know: 0, NaN) */
export function progressOf(tool: NonNullable<ChatItem['tool']>): number | null {
  const p = tool.done ? undefined : tool.progress;
  return p && p.total > 0 && Number.isFinite(p.done / p.total) ? Math.max(0, Math.min(100, Math.round((100 * p.done) / p.total))) : null;
}

/** the pictures of a choice (the takes of a generation), one click keeps one: in the conversation's card and in the dialog */
export function Choices({ q }: { q: Question }) {
  return (
    <div class="question-choices">
      {(q.choices ?? []).map((c, i) => (
        <button key={i} class="question-choice" title={c.label} onClick={() => choose(i)}>
          <img src={c.url} alt={c.label} />
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** a question asked during the turn (a generation that costs money, a take to keep): answered here */
export function QuestionCard() {
  const q = question.value;
  useEffect(() => { chatShown.value++; return () => { chatShown.value--; }; }, []);
  if (!q?.inChat) return null;
  return (
    <div class="proposal question">
      <div class="proposal-head"><Icon name="alert" /><span class="ptitle">{q.title}</span></div>
      <p class="question-text">{q.text}</p>
      {q.choices && <Choices q={q} />}
      <div class="proposal-actions">
        <span class="grow" />
        <button class="btn sm" onClick={() => answer(false)}>{q.choices ? t('image.keepNone') : t('common.cancel')}</button>
        {!q.choices && <button class="btn sm primary" onClick={() => answer(true)}><Icon name="check" />{q.yes}</button>}
      </div>
    </div>
  );
}

/** seconds since a moment, refreshed every second while shown */
export function useElapsed(since: number, live: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, Math.round((Date.now() - since) / 1000));
}

/** what the assistant thinks: live while it thinks, folded once done */
export function Thinking({ th }: { th: NonNullable<ChatItem['thinking']> }) {
  const live = !th.done && running.value;
  const [open, setOpen] = useState(false);
  const secs = useElapsed(th.start ?? Date.now(), live);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = body.current; if (el && live) el.scrollTop = el.scrollHeight; }, [th.text, live]);
  const took = th.ms !== undefined ? Math.max(1, Math.round(th.ms / 1000)) : secs;
  const text = th.text.trim();
  return (
    <div class={`thinking${live ? ' live' : ''}${open ? ' open' : ''}`}>
      <button class="thinking-head" disabled={!text} onClick={() => setOpen(!open)}>
        <Icon name={live ? 'spinner' : 'more'} />
        <span>{live ? t('assistant.thinking') : t('assistant.thought')}</span>
        <span class="faint mono">{live ? `${secs} s` : `${took} s`}</span>
        {text && !live && <Icon name={open ? 'chevronDown' : 'chevron'} />}
      </button>
      {text && (live || open) && <div class="thinking-body" ref={body}>{text}</div>}
    </div>
  );
}

/** a duration as the activity lines show it: tenths under ten seconds */
export const duration = (ms: number) => `${(ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))).replace('.', locale === 'fr' ? ',' : '.')} s`;

/** a tool the assistant runs: its line, how far it is while it runs, how long it took once done */
export function ToolLine({ tool }: { tool: NonNullable<ChatItem['tool']> }) {
  const run = !tool.done;
  const p = run ? tool.progress : undefined, pct = progressOf(tool);
  return (
    <div class={`activity${run ? ' running' : ''}`}>
      <Icon name={run ? 'spinner' : tool.error ? 'alert' : 'check'} />{tool.summary}
      {!run && tool.ms !== undefined && <span class="tool-took mono">{duration(tool.ms)}</span>}
      {tool.detail && <span class={`tool-detail${tool.error ? ' error' : ''}`} title={tool.detail}>{tool.detail}</span>}
      {p && <span class="tool-progress">{pct !== null && <span class="progress"><i style={{ width: `${pct}%` }} /></span>}<span class="mono">{[p.step, pct !== null ? `${pct} %` : ''].filter(Boolean).join(' ')}</span></span>}
    </div>
  );
}

/** a file joined to a message: a thumbnail for an image, its kind and name otherwise */
export function FileChip({ a, onRemove }: { a: { path: string; name: string; kind: string; asset?: string }; onRemove?: () => void }) {
  const url = attachmentUrl(a as Attachment);
  return (
    <span class={`file-chip ${a.kind}`} title={a.path}>
      {a.kind === 'image'
        ? <img src={url} alt="" onClick={() => { lightbox.value = url; }} />
        : <Icon name={a.kind === 'video' ? 'film' : a.kind === 'audio' ? 'audio' : a.kind === 'document' ? 'doc' : 'code'} />}
      <span class="file-name">{a.name}</span>
      {(a.kind === 'audio' || a.kind === 'video') && a.asset && S.doc.value.assets[a.asset] && <TranscribeButton asset={a.asset} small />}
      {onRemove && <button class="icon-btn xs" title={t('common.remove')} onClick={onRemove}><Icon name="x" /></button>}
    </span>
  );
}

/** a count of tokens, short: 950, 182 k, 1.4 M */
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n)).replace('.', locale === 'fr' ? ',' : '.');
const minutes = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; };

/** what a turn cost: its tool calls, the pictures the model looked at, its tokens when the path reports them, its length */
export function UsageLine({ u }: { u: TurnUsage }) {
  const read = u.input + u.cacheRead + u.cacheWrite;
  const parts = [
    u.tools === 1 ? t('assistant.usageCall1') : t('assistant.usageCalls', { n: u.tools }),
    ...(u.images ? [u.images === 1 ? t('assistant.usageImage1') : t('assistant.usageImages', { n: u.images })] : []),
    ...(read || u.output ? [t('assistant.usageTokens', { read: short(read), cached: read ? Math.round((100 * u.cacheRead) / read) : 0, written: short(u.output) })] : []),
    minutes(u.ms),
  ];
  return <div class="activity usage" title={`${t('assistant.usageTitle')} · ${modelLabel(u.model)}`}><Icon name="clock" />{parts.join(' · ')}</div>;
}

/** the pictures of the conversation, shown large on a click */
export function Lightbox() {
  return lightbox.value ? <div class="lightbox" onClick={() => { lightbox.value = null; }}><img src={lightbox.value} alt="" /></div> : null;
}

/** a phone or a tablet: nothing to start a companion with */
const handheld = () => matchMedia('(pointer: coarse)').matches;

/** a command to type in a terminal, copied on click */
export function Command({ text }: { text: string }) {
  return <code class="cmd" onClick={() => navigator.clipboard?.writeText(text).then(() => toast(t('common.commandCopied')))} title={t('common.copy')}>{text}</code>;
}

/** the command that starts the local companion for this editor */
export const CompanionCommand = () => <Command text={/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'npm run dev' : `npm run tramme -- agent --origin ${location.origin}`} />;

/** how to reach a model, right in the conversation when the assistant cannot answer: an AI account first, the companion for those who run one */
export function Access() {
  const st = aiStatus.value, set = aiSettings.value;
  const [token, setToken] = useState('');
  if (st.companion === 'checking') return null;
  const provider = providerOf(set.model);
  if (provider === 'local') {
    if (st.local === 'unknown') return null;
    const online = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    return (
      <div class="access">
        <b>{t('assistant.noLocalModelFound', { url: set.localUrl })}</b>
        <span>{t('assistant.startOllamaOrLm')}</span>
        {online && <span>{t('assistant.ollamaMustAcceptThis')} <Command text={`OLLAMA_ORIGINS=${location.origin}`} /></span>}
        <span class="faint">{t('assistant.theAddressCanBe')}</span>
      </div>
    );
  }
  const connect = <button class="btn sm primary" onClick={() => openSettings('providers')}><Icon name="link" />{t('assistant.connectAnAi')}</button>;
  // Codex or Antigravity: the companion, the command line installed and signed in
  const engine = engineOf(set.model);
  if (engine && engine !== 'claude') {
    const setup = CLI_SETUP[engine];
    return (
      <div class="access">
        <b>{cliUnavailable(set.model)}</b>
        {st.companion !== 'ok' ? <CompanionCommand /> : <><Command text={setup.install} /><Command text={setup.login} /></>}
        <button class="btn sm" onClick={() => refreshStatus()}><Icon name="loop" />{t('assistant.retry')}</button>
      </div>
    );
  }
  if (provider !== 'anthropic' || set.prefer === 'server') return (
    <div class="access">
      <b>{t('ai.providerNotConnected', { provider: provider === 'anthropic' ? 'Anthropic' : providerLabel(set.model) })}</b>
      {connect}
    </div>
  );
  if (st.companion === 'unpaired') return (
    <form class="access" onSubmit={(e) => { e.preventDefault(); if (token) setAiSettings({ token }); }}>
      <b>{t('assistant.theLocalCompanionIs')}</b>
      <span>{t('assistant.inTheCompanionS')}</span>
      <div class="access-row">
        <div class="field"><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} /></div>
        <button class="btn sm primary" type="submit" disabled={!token}>{t('assistant.connect')}</button>
      </div>
    </form>
  );
  return (
    <div class="access">
      <b>{t('assistant.noAiConnected')}</b>
      <span>{t('assistant.connectAnAiHint')}</span>
      {connect}
      {!handheld() && (
        <details class="access-more">
          <summary>{t('assistant.orTheCompanion')}</summary>
          <span>{t('assistant.itRunsClaudeWith')}</span>
          <CompanionCommand />
          <span class="faint">{t('assistant.itConnectsToThisEditor')}</span>
          <button class="btn sm" onClick={() => refreshStatus()}><Icon name="loop" />{t('assistant.retry')}</button>
        </details>
      )}
    </div>
  );
}

/** the first look at the routes when a panel opens; the companion is then watched by the app (watchCompanion) */
export function useStatusWatch() {
  useEffect(() => { refreshStatus(); }, []);
}
