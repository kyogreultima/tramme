// The compositions open in the timeline, as tabs beside the transport (shown
// once a second one is open): a click goes to one, a cross closes it.

import { effect, signal } from '@preact/signals';
import { S, select } from '../../state.ts';
import { t } from '../../i18n/index.ts';
import { Icon } from '../icons.tsx';
import { closeTab, openTab, pruneTabs } from './tabs.ts';

const open = signal<string[]>([]);

// every composition shown joins the tabs; one that is gone leaves them
effect(() => {
  const doc = S.doc.value, id = S.compId.value;
  if (!doc) return;
  open.value = pruneTabs(id && doc.compositions[id] ? openTab(open.peek(), id) : open.peek(), doc.compositions, doc.root);
});

export function Tabs() {
  const tabs = open.value, doc = S.doc.value, active = S.compId.value;
  if (tabs.length < 2) return null;
  const go = (id: string) => { S.compId.value = id; select([]); };
  return (
    <div class="tl-tabs" role="tablist">
      {tabs.map((id) => (
        <div key={id} role="tab" aria-selected={id === active} class={`tl-tab${id === active ? ' on' : ''}`} onClick={() => go(id)}>
          <span class="name">{doc.compositions[id]?.name ?? id}</span>
          <button class="tbtn" title={t('timeline.closeTab')} onClick={(e) => { e.stopPropagation(); const r = closeTab(tabs, active, id); open.value = r.tabs; if (r.active !== active) go(r.active); }}><Icon name="x" size={10} /></button>
        </div>
      ))}
    </div>
  );
}
