// The picture's look: the scopes that measure it, matching one shot to
// another, the export that keeps it.

import { registerTour, inAtelier } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'look',
  title: m('tours.look.title'),
  summary: m('tours.look.summary'),
  page: 'editor',
  order: 24,
  available: inAtelier,
  steps: [
    { title: m('tours.look.introTitle'), body: m('tours.look.introBody') },
    {
      target: 'viewport', side: 'left', align: 'center',
      title: m('tours.look.scopesTitle'), body: m('tours.look.scopesBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.look.matchTitle'), body: m('tours.look.matchBody'),
    },
    {
      target: 'export', side: 'bottom', align: 'end',
      title: m('tours.look.exportTitle'), body: m('tours.look.exportBody'),
    },
  ],
});
