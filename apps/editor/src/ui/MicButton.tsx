// The microphone of a message box: click to start, click to stop and have what
// was said written into the box (Escape drops the recording). It only gives
// the text to `onText`; the user reads it and sends it.

import { useEffect, useState } from 'preact/hooks';
import { cancelDictation, insertAtCursor, modelLoad, recording, startDictation, stopDictation } from '../dictation.ts';
import { toast } from '../state.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

/** what was said, written where the cursor is in a box (its words are the box's own, read live: they may have changed while the text was made) */
export function writeInto(area: HTMLTextAreaElement | null, set: (value: string) => void, add: string) {
  const value = area?.value ?? '';
  const { value: next, caret } = insertAtCursor(value, area?.selectionStart ?? value.length, area?.selectionEnd ?? value.length, add);
  set(next);
  requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(caret, caret); });
}

/** m:ss of a recording's length (never below zero: the clock's last tick may predate the recording's start) */
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [writing, setWriting] = useState(false);
  const rec = recording.value;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rec) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 250);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancelDictation(); } };
    addEventListener('keydown', key, true);
    return () => { clearInterval(tick); removeEventListener('keydown', key, true); };
  }, [!!rec]);
  // a recording left running when the box goes away is dropped
  useEffect(() => () => cancelDictation(), []);
  const click = async () => {
    if (writing) return;
    if (!rec) { await startDictation(); return; }
    setWriting(true);
    try {
      const text = await stopDictation();
      if (text) onText(text);
    } catch (e) {
      toast(t('dictation.failed', { error: (e as Error).message }), 'error');
    } finally { setWriting(false); }
  };
  const load = writing ? modelLoad.value : null;
  return (
    <>
      {rec && <span class="mic-time mono" title={t('dictation.recordingHint')}>{clock(now - rec.since)}</span>}
      {load && load.total > 0 && <span class="mic-time mono" title={t('dictation.downloading')}>{Math.floor((100 * load.loaded) / load.total)} %</span>}
      <button type="button" class={`icon-btn sm mic${rec ? ' on' : ''}`} disabled={disabled || writing}
        title={writing ? t('dictation.writing') : rec ? t('dictation.stop') : t('dictation.start')} aria-pressed={!!rec} onClick={click}>
        {writing ? <Icon name="spinner" /> : <Icon name="mic" />}
        {rec && <i class="mic-level" style={{ transform: `scaleY(${0.15 + rec.level * 0.85})` }} />}
      </button>
    </>
  );
}
