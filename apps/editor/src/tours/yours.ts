// Making the editor one's own: the project's tokens, the plugins and packs,
// the tours a plugin brings.

import { press, registerTour, inAtelier } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'yours',
  title: m('tours.yours.title'),
  summary: m('tours.yours.summary'),
  page: 'editor',
  order: 35,
  available: inAtelier,
  steps: [
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-tokens'),
      title: m('tours.yours.tokensTitle'), body: m('tours.yours.tokensBody'),
    },
    {
      target: 'settings', side: 'bottom', align: 'end',
      title: m('tours.yours.pluginsTitle'), body: m('tours.yours.pluginsBody'),
    },
    {
      target: 'help', side: 'bottom', align: 'end',
      before: () => press('left-tab-layers'),
      title: m('tours.yours.toursTitle'), body: m('tours.yours.toursBody'),
    },
  ],
});
