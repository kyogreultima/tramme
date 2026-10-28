// The studio's side panel: the notes and the direction. A note is what the
// user wants, written at a moment of the film (maybe on a scene, maybe pinned
// on the picture); under it, the assistant's work: the stages it went through
// (its steps one click away), what it looked at, what it says, and the take
// it proposes, to keep, set aside or do again another way. The thread itself
// is shared with the atelier's assistant (thread.tsx).

import { aiRoute, chats, openChat } from '../ai/index.ts';
import { ago } from '../model.ts';
import { notes, studio } from '../studio.ts';
import { ConversationTools } from './Assistant.tsx';
import { Seg } from './controls.tsx';
import { Direction } from './Direction.tsx';
import { LogoMark } from './Logo.tsx';
import { Icon } from './icons.tsx';
import { Thread } from './thread.tsx';
import { useStatusWatch } from './chat.tsx';
import { t } from '../i18n/index.ts';

/** nothing written yet: how notes work, and the conversations to go back to */
function Empty() {
  return (
    <div class="notes-empty">
      <div class="notes-empty-mark"><LogoMark /></div>
      <b>{t('studio.notesEmptyTitle')}</b>
      <p>{t('studio.notesEmptyText')}</p>
      <ul>
        <li><Icon name="pin" />{t('studio.notesEmptyPin')}</li>
        <li><Icon name="target" />{t('studio.notesEmptyScene')}</li>
        <li><Icon name="shuffle" />{t('studio.notesEmptyTakes')}</li>
      </ul>
      {chats.value.length > 0 && (
        <div class="recent-chats">
          <span class="faint">{t('assistant.resumeAConversation')}</span>
          {chats.value.slice(0, 3).map((c) => <button key={c.id} onClick={() => openChat(c.id)}><Icon name="clock" /><span>{c.title}</span><span class="faint">{ago(c.modified)}</span></button>)}
        </div>
      )}
    </div>
  );
}

export function SidePanel() {
  const panel = studio.panel.value, count = notes.value.length;
  useStatusWatch();
  return (
    <aside class="studio-side" data-tour="notes">
      <div class="side-head">
        <Seg value={panel} role="tablist" ariaLabel={t('studio.notes')}
          options={[
            { value: 'notes', label: t('studio.notes'), count },
            { value: 'direction', label: t('studio.direction.title'), tour: 'direction-tab' },
          ]}
          onChange={(v) => { studio.panel.value = v as 'notes' | 'direction'; }} />
        <span class="grow" />
        <ConversationTools />
      </div>
      {panel === 'notes' ? <Thread empty={<Empty />} /> : <div class="side-body"><Direction /></div>}
    </aside>
  );
}
