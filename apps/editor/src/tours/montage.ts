// Cutting a film on tracks: the lanes, the keys that cut, the gestures that
// move a cut, the cameras, the adjustment clips, the chapters, the media
// panel, the mixer, publishing.

import { marker, press, registerTour, inAtelier } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'montage',
  title: m('tours.montage.title'),
  summary: m('tours.montage.summary'),
  page: 'editor',
  order: 22,
  available: inAtelier,
  steps: [
    { title: m('tours.montage.welcomeTitle'), body: m('tours.montage.welcomeBody') },
    {
      target: 'timeline', side: 'top', align: 'start',
      before: () => press('bottom-tab-timeline'),
      title: m('tours.montage.lanesTitle'), body: m('tours.montage.lanesBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.montage.keysTitle'), body: m('tours.montage.keysBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'end',
      title: m('tours.montage.gesturesTitle'), body: m('tours.montage.gesturesBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      title: m('tours.montage.camerasTitle'), body: m('tours.montage.camerasBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'start',
      title: m('tours.montage.adjustmentTitle'), body: m('tours.montage.adjustmentBody'),
    },
    {
      target: 'timeline', side: 'top', align: 'end',
      title: m('tours.montage.chaptersTitle'), body: m('tours.montage.chaptersBody'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-assets'),
      title: m('tours.montage.mediaTitle'), body: m('tours.montage.mediaBody'),
    },
    {
      // the Mixer tab shows once a sound track exists: until then the step points at the tabs
      target: () => marker('bottom-tab-mixer') ?? marker('bottom-tab-timeline'), side: 'top', align: 'end',
      title: m('tours.montage.mixerTitle'), body: m('tours.montage.mixerBody'),
    },
    {
      target: 'export', side: 'bottom', align: 'end',
      title: m('tours.montage.publishTitle'), body: m('tours.montage.publishBody'),
    },
  ],
});
