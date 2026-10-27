// The messages waiting for the end of the turn, above the message box (the
// conversation's, the studio's direction bar, the notes): each can be taken
// back until it leaves.

import { dequeue, flushQueue, queue, queueWaits } from '../ai/queue.ts';
import { FileChip } from './chat.tsx';
import { Icon } from './icons.tsx';
import { t } from '../i18n/index.ts';

export function QueueList() {
  const list = queue.value, why = queueWaits.value;
  if (!list.length) return null;
  return (
    <div class="queue" role="list" aria-label={t('assistant.queueTitle')}>
      {list.map((q) => (
        <div key={q.id} class="queue-row" role="listitem">
          <span class="queue-text" title={q.text}>{q.text}</span>
          {q.attachments.length > 0 && <span class="queue-files">{q.attachments.map((a) => <FileChip key={a.path} a={a} />)}</span>}
          <button class="icon-btn xs" title={t('common.remove')} onClick={() => dequeue(q.id)}><Icon name="x" /></button>
        </div>
      ))}
      <div class="queue-note">
        <span>{why === 'decision' ? t('assistant.queueWaitsDecision') : why === 'stopped' ? t('assistant.queueStopped') : t('assistant.queueWaitsTurn')}</span>
        {why === 'stopped' && <button class="btn sm" onClick={() => { flushQueue(); }}>{t('assistant.sendNow')}</button>}
      </div>
    </div>
  );
}
