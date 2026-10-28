// The top of the media panel: a search over the media (names, files, bins,
// tags and what is said in them), the bins and tags as filters, and the line
// where a new bin or tag is named.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { isTranscript, transcriptIdOf, transcriptText, type TrammeDoc } from '@tramme/core';
import { commit, S } from '../state.ts';
import { api } from '../api.ts';
import { addTagsOps, binsOf, normTag, setBinOps, tagsOf, type AssetFilter } from '../bins.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

/** a bin or a tag being named for these media (set by the media's menu) */
export const naming = signal<{ kind: 'bin' | 'tag'; ids: string[] } | null>(null);

/** what is said in each transcribed clip, read once and kept (by the transcript's file) */
const said = new Map<string, string>();

/** the words said in the clips, loaded while a search is typed: a clip's id gives its text once its transcript is read */
export function useSpoken(doc: TrammeDoc, active: boolean): (id: string) => string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const project = S.project.peek()?.id;
    for (const id of Object.keys(doc.assets)) {
      const tr = doc.assets[transcriptIdOf(id)];
      if (!tr || said.has(tr.src) || !project) continue;
      said.set(tr.src, '');
      api.readText(project, tr.src).then((r) => {
        if (!r) return;
        const json = JSON.parse(r.text);
        said.set(tr.src, isTranscript(json) ? transcriptText(json) : '');
        if (live) bump((n) => n + 1);
      }).catch(() => { /* a transcript that cannot be read is not searched */ });
    }
    return () => { live = false; };
  }, [doc.assets, active]);
  return (id) => { const tr = doc.assets[transcriptIdOf(id)]; return tr ? said.get(tr.src) || undefined : undefined; };
}

export function MediaBar({ doc, filter, onChange }: { doc: TrammeDoc; filter: AssetFilter; onChange: (f: AssetFilter) => void }) {
  const bins = binsOf(doc), tags = tagsOf(doc), asking = naming.value;
  const [name, setName] = useState('');
  const loose = Object.values(doc.assets).some((a) => !a.bin);
  const done = (ok: boolean) => {
    const text = name.trim();
    if (ok && text && asking) commit(asking.kind === 'bin' ? t('panel.moveToBin') : t('panel.addTag'), asking.kind === 'bin' ? setBinOps(S.doc.peek(), asking.ids, text) : addTagsOps(S.doc.peek(), asking.ids, [normTag(text)]));
    naming.value = null; setName('');
  };
  return (
    <div>
      <div class="tree-filter">
        <Icon name="search" size={12} />
        <input value={filter.text ?? ''} placeholder={t('panel.findMedia')} spellcheck={false}
          onInput={(e) => onChange({ ...filter, text: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { onChange({ ...filter, text: '' }); (e.target as HTMLInputElement).blur(); } }} />
        {filter.text && <button class="icon-btn xs" title={t('panel.clearFilter')} onClick={() => onChange({ ...filter, text: '' })}><Icon name="x" /></button>}
      </div>
      {(bins.length > 0 || tags.length > 0) && (
        <div class="media-chips">
          {bins.length > 0 && <button class={`chip${filter.bin === undefined ? ' on' : ''}`} onClick={() => onChange({ ...filter, bin: undefined })}>{t('panel.allMedia')}</button>}
          {bins.map((b) => <button key={b} class={`chip${filter.bin === b ? ' on' : ''}`} onClick={() => onChange({ ...filter, bin: filter.bin === b ? undefined : b })}><Icon name="folder" />{b}</button>)}
          {bins.length > 0 && loose && <button class={`chip${filter.bin === '' ? ' on' : ''}`} onClick={() => onChange({ ...filter, bin: filter.bin === '' ? undefined : '' })}>{t('panel.noBin')}</button>}
          {tags.map(([tag, n]) => <button key={tag} class={`chip${filter.tag === tag ? ' on' : ''}`} title={String(n)} onClick={() => onChange({ ...filter, tag: filter.tag === tag ? undefined : tag })}>#{tag}</button>)}
        </div>
      )}
      {asking && (
        <div class="tree-filter">
          <Icon name={asking.kind === 'bin' ? 'folder' : 'marker'} size={12} />
          <input value={name} autoFocus placeholder={asking.kind === 'bin' ? t('panel.binName') : t('panel.tagName')} spellcheck={false}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }} onBlur={() => done(false)} />
        </div>
      )}
    </div>
  );
}
