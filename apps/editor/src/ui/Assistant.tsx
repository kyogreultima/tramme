// The AI assistant of the atelier: a conversation saved with the project. The
// agent sees the selection and the current time, reads the document, renders
// stills to check itself, and proposes its edits as a batch of ops: previewed
// in the viewport, applied or refused here, undoable like any edit. The turns
// themselves (ai/conversation.ts) and the pieces of the conversation
// (chat.tsx, composer.tsx) are the studio's too.

import { useState } from 'preact/hooks';
import { ENGINE_MODELS, ENGINES, providerOf } from '@tramme/assistant';
import { ModelPicker } from './ModelPicker.tsx';
import { aiRoute, aiSettings, aiStatus, routeLabel, chat, chatId, chats, deleteChat, newChat, openChat, refreshStatus, remoteProviders, serverName, setAiSettings, statusLabels, type ChatMeta } from '../ai/index.ts';
import { contextLine, running, send } from '../ai/conversation.ts';
import { openSettings } from '../settings.ts';
import { S, toast } from '../state.ts';
import { ago } from '../model.ts';
import { Icon } from './icons.tsx';
import { Access, CompanionCommand, Lightbox, useStatusWatch } from './chat.tsx';
import { Composer, join } from './composer.tsx';
import { Popover, Seg } from './controls.tsx';
import { LogoMark } from './Logo.tsx';
import { Thread } from './thread.tsx';
import { m, t } from '../i18n/index.ts';

export { chat };

const SUGGESTIONS = [
  t('assistant.describeTheSceneAt'),
  t('assistant.makeTheSelectedLayer'),
  t('assistant.addATitleThat'),
  t('assistant.checkTheCompositionS'),
];

/** the project's conversations: reopen one to continue it, or delete it */
export function History({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const list = chats.value, current = chatId.value;
  const [confirm, setConfirm] = useState<string | null>(null);
  const open = async (c: ChatMeta) => {
    try { await openChat(c.id); onClose(); } catch (e) { toast(t('assistant.unreadableConversationError', { error: (e as Error).message }), 'error'); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} class="chat-history" align="right">
      <div class="history-head">
        <span style={{ fontWeight: 600 }}>{t('common.conversations')}</span>
        <button class="btn sm" onClick={() => { newChat(); onClose(); }}><Icon name="plus" />{t('assistant.new')}</button>
      </div>
      {!list.length && <div class="faint" style={{ padding: '6px 2px' }}>{t('assistant.noConversationSavedIn')}</div>}
      <div class="history-list">
        {list.map((c) => (
          <div key={c.id} class={`history-item${c.id === current ? ' on' : ''}`} role="button" tabIndex={0}
            onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
            <div class="history-text">
              <span class="history-title" title={c.title}>{c.title}</span>
              <span class="faint">{ago(c.modified)} · {c.count} message{c.count > 1 ? 's' : ''}</span>
            </div>
            {confirm === c.id
              ? <button class="btn sm danger solid" onClick={(e) => { e.stopPropagation(); deleteChat(c.id).catch((x) => toast((x as Error).message, 'error')); setConfirm(null); }}>{t('common.delete')}</button>
              : <button class="icon-btn sm" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); setConfirm(c.id); }}><Icon name="trash" /></button>}
          </div>
        ))}
      </div>
    </Popover>
  );
}

/** where the assistant runs: the AI accounts connected first, then the local companion and local models for those who run them */
export function AccessSettings({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const st = aiStatus.value, set = aiSettings.value;
  const [token, setToken] = useState(set.token);
  const [url, setUrl] = useState(set.companionUrl);
  const [localUrl, setLocalUrl] = useState(set.localUrl);
  const labels = statusLabels(st);
  const account = (on: boolean) => (on ? t('common.keySet') : t('common.noKey'));
  return (
    <Popover anchor={anchor} onClose={onClose} class="ai-settings" align="right">
      <div style={{ fontWeight: 600 }}>{t('assistant.aiAccess')}</div>
      <div class="ai-line"><span class={`dot ${st.server ? 'ok' : 'off'}`} /><b>Claude (Anthropic)</b><span class="faint">{account(!!st.server)}</span></div>
      {remoteProviders.value.map((p) => <div key={p.slot} class="ai-line"><span class={`dot ${st.remote[p.slot] ? 'ok' : 'off'}`} /><b>{p.label}</b><span class="faint">{account(!!st.remote[p.slot])}</span></div>)}
      <button class="btn sm" onClick={() => { onClose(); openSettings('providers'); }}><Icon name="link" />{t('assistant.manageProviders')}</button>
      <details open={set.prefer === 'companion' || st.companion === 'ok' || st.companion === 'unpaired'}>
        <summary class="faint">{t('assistant.companionAdvanced')}</summary>
        <div class="ai-more">
          <div class="ai-line"><span class={`dot ${st.companion === 'ok' ? 'ok' : st.companion === 'checking' ? '' : 'off'}`} /><b>{t('assistant.localCompanion')}</b><span class="faint">{labels.companion}</span></div>
          {st.companion === 'ok' && <div class="faint">{t('assistant.companionAgents', { list: ENGINES.filter((e) => st.engines[e]).map((e) => ENGINE_MODELS[e].label).join(', ') })}</div>}
          <Seg value={set.prefer} options={[['auto', t('common.automatic')], ['companion', t('common.companion')], ['server', serverName()]]} onChange={(v) => setAiSettings({ prefer: v as typeof set.prefer })} />
          <div class="faint">{t('assistant.automaticTheLocalCompanion')}</div>
          {st.companion !== 'ok' && <div class="faint">{t('assistant.inTheTrammeFolder')} <CompanionCommand /></div>}
          <label class="lbl">{t('assistant.tokenShownByThe')}</label>
          <div class="field"><input type="password" value={token} placeholder={t('common.pairingToken')} onInput={(e) => setToken((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ token })} /></div>
          <label class="lbl">{t('assistant.companionAddress')}</label>
          <div class="field"><input value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ companionUrl: url })} /></div>
        </div>
      </details>
      <details open={providerOf(set.model) === 'local'}>
        <summary class="faint">{t('assistant.localModelsOllamaLm')}</summary>
        <div class="ai-more">
          <div class="field"><input value={localUrl} placeholder="http://127.0.0.1:11434/v1" onInput={(e) => setLocalUrl((e.target as HTMLInputElement).value.trim())} onChange={() => setAiSettings({ localUrl })} /></div>
          <div class="faint">{t('assistant.ollama11434LmStudio')}</div>
        </div>
      </details>
      <button class="btn sm" onClick={() => { setAiSettings({ token, companionUrl: url, localUrl }); refreshStatus(); }}><Icon name="loop" />{t('common.check')}</button>
    </Popover>
  );
}

const ROUTE_TITLE = {
  companion: m('assistant.localCompanionYourClaude'),
  server: m('assistant.serverTheDeploymentS'),
  remote: m('assistant.throughTheServerWith'),
  local: m('assistant.localModelOnThis'),
};

/** the conversation's controls: where the assistant runs and its model, how it is reached, the conversations, a new one */
export function ConversationTools() {
  const route = aiRoute.value, available = route !== null, busy = running.value;
  const [access, setAccess] = useState<HTMLElement | null>(null);
  const [history, setHistory] = useState<HTMLElement | null>(null);
  return (
    <>
      {route && <span class={`route ${route}`} title={t(ROUTE_TITLE[route])}>{routeLabel(route, aiSettings.value.model)}</span>}
      <ModelPicker />
      <button data-tour="assistant-access" class={`icon-btn sm${available ? '' : ' on'}`} title={t('common.accessToClaude')} onClick={(e) => setAccess(access ? null : (e.currentTarget as HTMLElement))}><Icon name="sliders" /></button>
      <button data-tour="assistant-history" class={`icon-btn sm${history ? ' on' : ''}`} title={t('common.conversations')} disabled={busy} onClick={(e) => setHistory(history ? null : (e.currentTarget as HTMLElement))}><Icon name="clock" /></button>
      <button class="icon-btn sm" title={t('assistant.newConversationTheOthers')} disabled={busy || !chat.value.length} onClick={() => newChat()}><Icon name="plus" /></button>
      {access && <AccessSettings anchor={access} onClose={() => setAccess(null)} />}
      {history && <History anchor={history} onClose={() => setHistory(null)} />}
    </>
  );
}

export function Assistant({ style }: { style?: Record<string, string | number> }) {
  const busy = running.value, full = S.assistantFull.value;
  const available = aiRoute.value !== null;
  useStatusWatch();
  const ctx = contextLine(true);
  const [dropping, setDropping] = useState(false);
  const empty = (
    <div class="notes-empty">
      <div class="notes-empty-mark"><LogoMark /></div>
      <b>{t('common.assistant')}</b>
      {available && <div class="suggest">{SUGGESTIONS.map((s) => <button key={s} class="chip" onClick={() => send(s)}>{s}</button>)}</div>}
      <div class="faint">{t('assistant.slashHint')}</div>
      {chats.value.length > 0 && (
        <div class="recent-chats">
          <span class="faint">{t('assistant.resumeAConversation')}</span>
          {chats.value.slice(0, 3).map((c) => <button key={c.id} onClick={() => openChat(c.id)}><Icon name="clock" /><span>{c.title}</span><span class="faint">{ago(c.modified)}</span></button>)}
        </div>
      )}
      {!available && <Access />}
    </div>
  );
  return (
    <div class={`assistant${full ? ' full' : ''}${dropping ? ' dropping' : ''}`} data-tour="assistant" style={full ? undefined : style}
      onDragOver={(e) => { if (available && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDropping(false); }}
      onDrop={(e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); e.stopPropagation(); setDropping(false); join(e.dataTransfer.files); }}>
      <div class="panel-head">
        <span class="mark"><LogoMark /></span>
        <span class="title">{t('common.assistant')}</span>
        <span class="grow" />
        <ConversationTools />
        <button class="icon-btn sm" title={full ? t('assistant.collapse') : t('assistant.fullScreen')} onClick={() => { S.assistantFull.value = !full; }}><Icon name={full ? 'collapse' : 'expand'} /></button>
      </div>
      <Thread empty={empty} />
      <Composer placeholder={t('assistant.askForAChange2')} tour="assistant-composer"
        context={<span class="chip label" title={t('assistant.contextSentWithThe')}><Icon name="target" />{ctx.text}</span>} />
      <Lightbox />
    </div>
  );
}
