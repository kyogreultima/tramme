// The question the editor waits an answer for, shown as a dialog: the import
// of a project carrying code, a generation that costs money. Mounted on the
// editor's page and on the home screen (an import is asked there too);
// questions of the assistant's turn show in the conversation instead.

import { useEffect } from 'preact/hooks';
import { answer, chatShown, question } from '../confirm.ts';
import { away, notify } from '../notify.ts';
import { Modal } from './controls.tsx';
import { t } from '../i18n/index.ts';

export function QuestionDialog() {
  const q = question.value;
  useEffect(() => { if (q && away()) notify(q.title, q.text); }, [q]);
  // asked during a turn of the assistant: in the conversation, when one is on screen
  if (!q || (q.inChat && chatShown.value > 0)) return null;
  return (
    <Modal title={q.title} onClose={() => answer(false)}>
      <div class="modal-body">
        <p style={{ whiteSpace: 'pre-line' }}>{q.text}</p>
        <div class="modal-foot">
          <button class="btn ghost" onClick={() => answer(false)}>{t('common.cancel')}</button>
          <button class="btn primary" onClick={() => answer(true)}>{q.yes}</button>
        </div>
      </div>
    </Modal>
  );
}
