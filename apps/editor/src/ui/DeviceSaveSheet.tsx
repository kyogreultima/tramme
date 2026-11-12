// What a finished file does on the phone: saved to the gallery or the downloads,
// or handed to the share sheet (device.ts, the plugin in apps/desktop/plugin-device).
// Asked after any save the editor makes (download.ts saveBlob).

import { useState } from 'preact/hooks';
import { applyChoice, savePrompt, type SaveChoice } from '../device.ts';
import { t } from '../i18n/index.ts';
import { toast } from '../state.ts';
import { Modal } from './controls.tsx';
import { Icon } from './icons.tsx';

export function DeviceSaveSheet() {
  const p = savePrompt.value;
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const choose = async (choice: SaveChoice) => {
    setBusy(true);
    try {
      await applyChoice(p, choice);
      // the share sheet is its own confirmation
      if (choice !== 'share') toast(t('device.saved'));
      p.done(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const label = { gallery: t('device.saveToGallery'), downloads: t('device.saveToDownloads'), share: t('device.share') };
  const icon = { gallery: 'download', downloads: 'download', share: 'upload' } as const;
  return (
    <Modal title={t('device.ready')} onClose={() => p.done(false)} above>
      <div class="modal-body">
        <p class="mono">{p.name}</p>
        <div class="modal-foot">
          {p.choices.map((c, i) => (
            <button key={c} class={`btn${i === 0 ? ' primary' : ''}`} disabled={busy} onClick={() => choose(c)}><Icon name={icon[c]} />{label[c]}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
