// Retouching in the studio: several pins, paths and selections, the list of
// retouches and its voice, sent as one turn. Offered from the guided tours menu.

import { inStudio, registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'retouch',
  title: m('tours.retouch.title'),
  summary: m('tours.retouch.summary'),
  page: 'editor',
  order: 6,
  available: inStudio,
  steps: [
    { title: m('tours.retouch.introTitle'), body: m('tours.retouch.introBody') },
    { target: 'pin', side: 'top', align: 'start', title: m('tours.retouch.toolsTitle'), body: m('tours.retouch.toolsBody') },
    { target: 'direct', side: 'top', align: 'center', title: m('tours.retouch.areaTitle'), body: m('tours.retouch.areaBody') },
    { target: 'direct', side: 'top', align: 'center', title: m('tours.retouch.listTitle'), body: m('tours.retouch.listBody') },
    { target: 'direct', side: 'top', align: 'center', title: m('tours.retouch.voiceTitle'), body: m('tours.retouch.voiceBody') },
  ],
});
