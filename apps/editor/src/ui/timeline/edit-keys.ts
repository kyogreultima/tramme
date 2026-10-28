// The editing keys at work: the key handler of the project (shell.tsx) hands
// each key here; a key that comes to nothing is left to the browser.

import { signal } from '@preact/signals';
import { comp, commit, S, select, toast } from '../../state.ts';
import { snap } from '../../model.ts';
import { fileLength } from '../../preview.ts';
import { t } from '../../i18n/index.ts';
import { commandFor, editPlan, type Clipboard, type EditCommand } from './shortcuts.ts';
import { placeAsset } from './place.ts';
import { defaultTrackOf } from './tracks.ts';
import { chosenAsset } from './assets-drag.ts';

/** the clips copied (of this session: it is not the system's clipboard) */
export const clipboard = signal<Clipboard | null>(null);

function run(cmd: EditCommand): boolean {
  if (cmd === 'insertSource' || cmd === 'overwriteSource') {
    const c = comp.peek(), id = chosenAsset.peek(), a = id ? S.doc.peek().assets[id] : undefined;
    if (!id || !a || !c.tracks) return false;
    const track = defaultTrackOf(c, a.type === 'audio', S.selection.peek()[0]);
    if (!track) return false;
    void placeAsset(id, S.time.peek(), track, cmd === 'insertSource' ? 'insert' : 'overwrite');
    return true;
  }
  const c = comp.peek(), plan = editPlan(cmd, { doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek(), time: snap(S.time.peek(), c.fps), clipboard: clipboard.peek(), fileLength });
  if (!plan) return false;
  if (plan.copied) { clipboard.value = plan.copied; toast(t('timeline.copied', { n: plan.copied.ids.length }), 'info', 1500); return true; }
  if (commit(plan.label, plan.ops) && plan.select?.length) select(plan.select);
  return true;
}

/** an editing key: true when it did something (and the browser's own action is held back) */
export function runEditKey(e: KeyboardEvent): boolean {
  const cmd = commandFor(e);
  if (!cmd || !run(cmd)) return false;
  e.preventDefault();
  return true;
}

/** Delete on clips of a magnetic track closes the gap behind them; false when the selection is not of that kind */
export function rippleOnMagnetic(): boolean {
  const c = comp.peek(), sel = S.selection.peek();
  const magnetic = sel.length > 0 && sel.every((id) => c.tracks?.find((x) => x.id === c.layers[id]?.track)?.magnetic);
  return magnetic && run('rippleDelete');
}
