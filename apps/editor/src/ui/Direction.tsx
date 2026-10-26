// What the assistant follows, in front of the user: the brief (what the piece is
// about, its tone, its rules: written here as well as by the assistant, it
// wins over the assistant's defaults), the palette and the type of the
// project, and the material it was made from. Changing the direction is a
// note away: the buttons put the words in the direction bar.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { running } from '../ai/conversation.ts';
import { attachFiles, draft } from '../attachments.ts';
import { BRIEF_PATH, briefOf, briefOp, parseBrief, type Brief, type BriefInput } from '../brief.ts';
import { commit, S, toast } from '../state.ts';
import { sourcesOf, type Source } from '../sources.ts';
import { studio } from '../studio.ts';
import { ATTACHABLE } from './composer.tsx';
import { resolveColor } from './controls.tsx';
import { Icon } from './icons.tsx';
import { TranscribeButton } from './Transcribe.tsx';
import { t } from '../i18n/index.ts';

/** words to finish in the direction bar */
function prefill(words: string) { studio.panel.value = 'notes'; draft.value = words; }

/** a field of the brief: the words are the field's own while written, saved when it loses the focus */
function BriefField({ label, hint, value, rows, onSave }: { label: string; hint: string; value: string; rows: number; onSave: (v: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  // the brief read again (the assistant wrote it): shown, unless the user is writing there
  useEffect(() => { const el = area.current; if (el && document.activeElement !== el) el.value = value; }, [value]);
  return (
    <label class="dir-field">
      <span class="dir-label">{label}</span>
      <textarea ref={area} rows={rows} defaultValue={value} placeholder={hint} spellcheck
        onBlur={(e) => { const v = (e.currentTarget as HTMLTextAreaElement).value.trim(); if (v !== value.trim()) onSave(v); }} />
    </label>
  );
}

export function Direction() {
  const doc = S.doc.value, project = S.project.value.id, busy = running.value;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [saved, setSaved] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  // read again when the assistant is done (it may have written the brief)
  useEffect(() => {
    if (busy) return;
    api.readText(project, BRIEF_PATH).then((f) => setBrief(parseBrief(f?.text))).catch(() => setBrief(null));
    api.info(project).then((i) => setSources(sourcesOf(S.doc.peek(), i.files))).catch(() => setSources([]));
  }, [busy, project, doc.assets]);

  const save = async (input: BriefInput) => {
    try {
      const prev = parseBrief((await api.readText(project, BRIEF_PATH))?.text);
      const next = briefOf(S.doc.peek(), prev, input);
      await api.write(project, BRIEF_PATH, JSON.stringify(next, null, 1), { type: 'application/json' });
      if (!S.doc.peek().assets.brief) commit(t('brief.written'), [briefOp(S.doc.peek(), BRIEF_PATH)]);
      setBrief(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) { toast(t('studio.direction.notSaved', { error: (e as Error).message }), 'error'); }
  };

  const colors = Object.entries(doc.tokens ?? {}).filter(([, tk]) => tk.type === 'color').map(([name, tk]) => [name, resolveColor(String(tk.value), doc.tokens)] as const);
  const fonts = [...new Set(Object.values(doc.assets).filter((a) => a.type === 'font').map((a) => String((a as { family?: string }).family ?? a.name ?? '')).filter(Boolean))];

  return (
    <div class="direction">
      <section class="dir-section">
        <div class="dir-head"><h4>{t('studio.direction.brief')}</h4>{saved && <span class="dir-saved"><Icon name="check" />{t('topbar.saved')}</span>}</div>
        <p class="dir-hint">{t('studio.direction.briefHint')}</p>
        <BriefField label={t('studio.direction.about')} hint={t('studio.direction.aboutHint')} rows={4} value={brief?.about ?? ''} onSave={(v) => save({ about: v })} />
        <BriefField label={t('studio.direction.tone')} hint={t('studio.direction.toneHint')} rows={2} value={brief?.tone ?? ''} onSave={(v) => save({ tone: v })} />
        <BriefField label={t('studio.direction.rules')} hint={t('studio.direction.rulesHint')} rows={4} value={(brief?.rules ?? []).join('\n')}
          onSave={(v) => save({ rules: v.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean) })} />
      </section>

      {(colors.length > 0 || fonts.length > 0) && (
        <section class="dir-section">
          <div class="dir-head"><h4>{t('studio.direction.look')}</h4></div>
          {colors.length > 0 && <div class="dir-swatches">{colors.map(([name, value]) => <span key={name} class="dir-swatch" title={`${name} · ${value}`}><i style={{ background: value }} /><span>{name}</span></span>)}</div>}
          {fonts.length > 0 && <div class="dir-fonts">{fonts.map((f) => <span key={f} style={{ fontFamily: `"${f}"` }}>{f}</span>)}</div>}
        </section>
      )}

      <section class="dir-section" data-tour="material">
        <div class="dir-head"><h4>{t('studio.direction.material')}</h4><span class="faint">{sources.length || ''}</span></div>
        {sources.length > 0
          ? <div class="dir-sources">{sources.map((s) => (
            <span key={s.ref} class={`dir-source ${s.kind}`} title={s.path}>
              {s.kind === 'image' ? <img src={api.fileUrl(project, s.path)} alt="" loading="lazy" /> : <Icon name={s.kind === 'video' ? 'film' : s.kind === 'audio' ? 'audio' : 'doc'} />}
              <span>{s.name}</span>
              {(s.kind === 'audio' || s.kind === 'video') && s.asset && <TranscribeButton asset={s.asset} small />}
            </span>
          ))}</div>
          : <p class="dir-hint">{t('studio.direction.noMaterial')}</p>}
        <div class="dir-actions">
          <button class="btn sm" onClick={() => files.current?.click()}><Icon name="attach" />{t('studio.direction.addMaterial')}</button>
          <input ref={files} type="file" multiple hidden accept={ATTACHABLE} onChange={(e) => { const list = Array.from((e.target as HTMLInputElement).files ?? []); (e.target as HTMLInputElement).value = ''; if (list.length) { attachFiles(list); studio.panel.value = 'notes'; } }} />
        </div>
      </section>
    </div>
  );
}
