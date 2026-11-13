// The reading of a reference as an outline the user corrects before their
// video is made the same way: one row per scene with a still of the
// reference, its length and its cut on the music, what it does in words, and
// each place where content sits with the asset of the user chosen for it.
// A scene is removed or merged with the next; the outline accepted is the
// reading the film follows. Shown in the conversation's card and the dialog.

import { useState } from 'preact/hooks';
import { dropScene, mergeScenes, type Reading, type Slot, type SlotRole } from '@tramme/core';
import { answer, type Question } from '../confirm.ts';
import { m, t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

/** what fills a slot, as the user reads it: their asset's name, their words, drawn, or nothing yet */
function fillLabel(slot: Slot, assets: { id: string; name: string }[]): string {
  if (slot.fill === 'words') return t('reading.words');
  if (slot.fill === 'build') return t('reading.built');
  return assets.find((a) => a.id === slot.asset)?.name ?? t('reading.missing');
}

const CONTENT = new Set(['logo', 'screenshot', 'photo', 'video', 'product', 'person']);
/** what each role of a slot is called to the user */
const ROLE: Record<SlotRole, string> = {
  logo: m('reading.role.logo'), headline: m('reading.role.headline'), text: m('reading.role.text'), screenshot: m('reading.role.screenshot'), photo: m('reading.role.photo'),
  video: m('reading.role.video'), product: m('reading.role.product'), person: m('reading.role.person'), figure: m('reading.role.figure'), shape: m('reading.role.shape'),
};

export function ReadingOutline({ q }: { q: Question }) {
  const outline = q.outline!;
  const [draft, setDraft] = useState<Reading>(outline.reading);
  // the stills follow the scenes they show, through the removals and merges
  const [stills, setStills] = useState<Record<string, string>>(() => Object.fromEntries(outline.reading.scenes.map((s, i) => [s.id, outline.stills[i]]).filter(([, u]) => !!u)));
  const scenes = draft.scenes;
  const edit = (id: string, change: (s: Reading['scenes'][number]) => Reading['scenes'][number]) => setDraft({ ...draft, scenes: scenes.map((s) => (s.id === id ? change(s) : s)) });
  const setAsset = (sceneId: string, slotId: string, asset: string) => edit(sceneId, (s) => ({ ...s, slots: s.slots.map((sl) => (sl.id === slotId ? { ...sl, asset: asset || undefined, fill: asset ? 'asset' : 'missing' } : sl)) }));
  return (
    <div class="reading-outline">
      <p class="question-text">{t('reading.text')}</p>
      <ol class="reading-scenes">
        {scenes.map((s, i) => (
          <li key={s.id} class="reading-scene">
            {stills[s.id] && <img class="reading-still" src={stills[s.id]} alt="" />}
            <div class="reading-body">
              <div class="reading-meta">
                <span>{t('reading.seconds', { s: (s.end - s.start).toFixed(1) })}</span>
                {s.onBeat && <span>{t('reading.onBeat', { bar: s.onBeat.bar + 1 })}</span>}
                <span class="grow" />
                {i + 1 < scenes.length && (
                  <button class="btn sm ghost" title={t('reading.merge')} onClick={() => { setDraft(mergeScenes(draft, s.id)); }}>
                    <Icon name="link" />{t('reading.merge')}
                  </button>
                )}
                {scenes.length > 1 && (
                  <button class="btn sm ghost" title={t('reading.remove')} onClick={() => { setDraft(dropScene(draft, s.id)); setStills(({ [s.id]: _, ...rest }) => rest); }}>
                    <Icon name="trash" />{t('reading.remove')}
                  </button>
                )}
              </div>
              <textarea class="reading-what" aria-label={t('reading.what')} rows={2} value={s.what} onInput={(e) => { const what = (e.currentTarget as HTMLTextAreaElement).value; edit(s.id, (x) => ({ ...x, what: what.slice(0, 400) || x.what })); }} />
              {s.slots.length > 0 && (
                <ul class="reading-slots">
                  {s.slots.map((sl) => (
                    <li key={sl.id}>
                      <span class="reading-role">{t(ROLE[sl.role])}</span>
                      {CONTENT.has(sl.role) ? (
                        <select value={sl.asset ?? ''} onChange={(e) => setAsset(s.id, sl.id, (e.currentTarget as HTMLSelectElement).value)}>
                          <option value="">{t('reading.missing')}</option>
                          {outline.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      ) : <span class="reading-fill">{fillLabel(sl, outline.assets)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div class="proposal-actions">
        <span class="grow" />
        <button class="btn sm" onClick={() => answer(false)}>{t('common.cancel')}</button>
        <button class="btn sm primary" onClick={() => q.keep?.(draft)}><Icon name="check" />{t('reading.accept')}</button>
      </div>
    </div>
  );
}
