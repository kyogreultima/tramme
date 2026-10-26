// The question the editor waits an answer for, shown as a dialog: the import
// of a project carrying code, a generation that costs money. Mounted on the
// editor's page and on the home screen (an import is asked there too);
// questions of the assistant's turn show in the conversation instead.

import { useEffect } from 'preact/hooks';
import { answer, chatShown, question } from '../confirm.ts';
import { attend, away, notify } from '../notify.ts';
import { Modal } from './controls.tsx';
import { Choices } from './chat.tsx';
import { t } from '../i18n/index.ts';

export function QuestionDialog() {
  const q = question.value;
  // asked while the user is elsewhere, in the dialog or in the conversation: the system is told, the window asks for attention until it is focused or the question goes
  useEffect(() => {
    if (!q || !away()) return;
    notify(q.title, q.text, 'info', { attention: true });
    return attend();
  }, [q]);
  // asked during a turn of the assistant: in the conversation, when one is on screen
  if (!q || (q.inChat && chatShown.value > 0)) return null;
  return (
    <Modal title={q.title} onClose={() => answer(false)}>
      <div class="modal-body">
        <p style={{ whiteSpace: 'pre-line' }}>{q.text}</p>
        {q.choices && <Choices q={q} />}
        <div class="modal-foot">
          <button class="btn ghost" onClick={() => answer(false)}>{q.choices ? t('image.keepNone') : t('common.cancel')}</button>
          {!q.choices && <button class="btn primary" onClick={() => answer(true)}>{q.yes}</button>}
        </div>
      </div>
    </Modal>
  );
}
