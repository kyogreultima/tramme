// The hesitations cut from a voice, one line each with its moment and a button
// to put it back (a word cut by mistake): the fillers tool's restore, by number.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { S, toast } from '../state.ts';
import { api } from '../api.ts';
import { runCommand } from '../ai/conversation.ts';
import { listCommands } from '../ai/commands.ts';
import { cutsOf, restoreInput, type FillerCut } from '../fillercuts.ts';
import { timecode } from '../model.ts';
import { t } from '../i18n/index.ts';
import { Icon } from './icons.tsx';

/** the fillers list (an asset of the project) being reviewed, if any */
export const fillerCuts = signal<string | null>(null);

export function FillerCutsPanel() {
  const id = fillerCuts.value, doc = S.doc.value, a = id ? doc.assets[id] : undefined;
  const [list, setList] = useState<{ asset: string; cuts: FillerCut[] } | null>(null);
  useEffect(() => {
    setList(null);
    if (!a) return;
    let live = true;
    api.readText(S.project.peek().id, a.src).then((r) => { if (live) setList(r ? cutsOf(r.text) : null); }).catch(() => {});
    return () => { live = false; };
  }, [a?.src]);
  if (!id || !a) return null;
  const fps = doc.compositions[S.compId.value]?.fps ?? 30;
  const back = (n: number) => {
    const cmd = listCommands(S.registry.peek()).find((x) => x.name === 'fillers');
    if (!cmd || !list) { toast(t('fillers.noTool'), 'error'); return; }
    void runCommand(cmd, restoreInput(list.asset, n));
  };
  return (
    <div class="filler-cuts" role="dialog" aria-label={t('fillers.reviewTitle')}>
      <div class="source-head"><Icon name="cutTail" size={13} /><span class="name">{t('fillers.reviewTitle')}</span><button class="icon-btn xs" title={t('source.close')} onClick={() => { fillerCuts.value = null; }}><Icon name="x" /></button></div>
      {!list || !list.cuts.length
        ? <div class="faint">{t('fillers.noCuts')}</div>
        : <ul>{list.cuts.map((c) => (
            <li key={c.n}>
              <span class="mono">#{c.n}</span>
              <span class="mono">{timecode(c.from, fps)}</span>
              <span class="name">{c.word ?? t('fillers.heard')} · {(c.to - c.from).toFixed(2)} s</span>
              <button class="btn sm" onClick={() => back(c.n)}>{t('fillers.putBack')}</button>
            </li>
          ))}</ul>}
    </div>
  );
}
