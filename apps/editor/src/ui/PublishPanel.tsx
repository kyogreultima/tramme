// The guided publication, at the top of the export: where the film is going
// (a preset), what stands between it and that place, each with its fix, and
// the format the export then asks for. The file is the deliverable.

import { useState } from 'preact/hooks';
import { chapterList, chaptersOf, type Composition } from '@tramme/core';
import { commit, S, toast } from '../state.ts';
import { send } from '../ai/conversation.ts';
import { fixOps, presetIssues, PUBLISH_PRESETS, type PublishIssue, type PublishPreset } from '../publish.ts';
import { m, t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';
import type { WebFormat } from '../formats.ts';

const ISSUE_TEXT: Record<PublishIssue['code'], string> = {
  long: m('publish.issue.long'), aspect: m('publish.issue.aspect'), size: m('publish.issue.size'), fps: m('publish.issue.fps'), loudness: m('publish.issue.loudness'),
};

/** an issue said in words: a loudness not aimed at is "as mixed" */
const said = (i: PublishIssue) => t(ISSUE_TEXT[i.code], { ...i.params, ...(i.code === 'loudness' && i.params.from === null ? { from: t('timeline.asMixed') } : {}) } as Record<string, string | number>);

export function PublishPanel({ c, compId, disabled, onFormat }: { c: Composition; compId: string; disabled: boolean; onFormat: (f: WebFormat) => void }) {
  const [id, setId] = useState<string | null>(null);
  const preset = PUBLISH_PRESETS.find((p) => p.id === id);
  const issues = preset ? presetIssues(c, preset) : [];
  const chapters = chaptersOf(c.markers);
  const choose = (p: PublishPreset) => { setId(p.id === id ? null : p.id); if (p.id !== id) onFormat(p.format); };
  const fix = (p: PublishPreset, i: PublishIssue) => {
    if (i.fix === 'vertical') { void send(t('studio.chips.verticalWords')); return; }
    if (i.fix) commit(said(i), fixOps(S.doc.peek().compositions[compId], compId, p, i.fix));
  };
  const fixAll = (p: PublishPreset) => {
    // one after another, each on the film the one before left (the document is the same one)
    const ops = issues.filter((i) => i.fix && i.fix !== 'vertical').flatMap((i) => fixOps(S.doc.peek().compositions[compId], compId, p, i.fix!));
    if (ops.length) commit(t('publish.fixAll'), ops);
  };
  return (
    <div class="publish">
      <div class="publish-head">{t('publish.title')}</div>
      <div class="publish-presets">
        {PUBLISH_PRESETS.map((p) => <button key={p.id} class={`chip${p.id === id ? ' on' : ''}`} disabled={disabled} onClick={() => choose(p)}>{t(p.label)}</button>)}
      </div>
      {preset && (issues.length === 0
        ? <div class="publish-ok"><Icon name="check" size={13} />{t('publish.ready')}</div>
        : <ul class="publish-issues">
            {issues.map((i) => (
              <li key={i.code}>
                <span>{said(i)}</span>
                {i.fix && <button class="btn sm" disabled={disabled} onClick={() => fix(preset, i)}>{i.fix === 'vertical' ? t('publish.askVertical') : t('publish.fix')}</button>}
              </li>
            ))}
            {issues.filter((i) => i.fix && i.fix !== 'vertical').length > 1 && <li><span /><button class="btn sm primary" disabled={disabled} onClick={() => fixAll(preset)}>{t('publish.fixAll')}</button></li>}
          </ul>)}
      {preset && chapters.length > 0 && (
        <div class="publish-chapters">
          <span class="faint">{t('publish.chaptersNote')}</span>
          <button class="btn sm" onClick={() => { void navigator.clipboard?.writeText(chapterList(chapters)); toast(t('timeline.chaptersCopied', { n: chapters.length }), 'info', 1500); }}>{t('publish.copyChapters')}</button>
        </div>
      )}
    </div>
  );
}
