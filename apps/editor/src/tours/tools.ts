// The tools of the / menu, by what they do: footage, voice, the material read,
// whole motion pieces, following an object, pictures and clips by a provider,
// what is reused, the checks. The assistant uses the same ones.

import { composer, registerTour } from './engine.ts';
import { S } from '../state.ts';
import { m } from '../i18n/index.ts';

const at = { target: composer, side: 'top', align: 'center' } as const;

registerTour({
  id: 'tools',
  title: m('tours.tools.title'),
  summary: m('tours.tools.summary'),
  page: 'editor',
  order: 28,
  available: () => S.ready.value,
  steps: [
    { ...at, title: m('tours.tools.introTitle'), body: m('tours.tools.introBody') },
    { ...at, title: m('tours.tools.footageTitle'), body: m('tours.tools.footageBody') },
    { ...at, title: m('tours.tools.voiceTitle'), body: m('tours.tools.voiceBody') },
    { ...at, title: m('tours.tools.materialTitle'), body: m('tours.tools.materialBody') },
    { ...at, title: m('tours.tools.piecesTitle'), body: m('tours.tools.piecesBody') },
    { ...at, title: m('tours.tools.followTitle'), body: m('tours.tools.followBody') },
    { ...at, title: m('tours.tools.madeTitle'), body: m('tours.tools.madeBody') },
    { ...at, title: m('tours.tools.reuseTitle'), body: m('tours.tools.reuseBody') },
    { ...at, title: m('tours.tools.checkTitle'), body: m('tours.tools.checkBody') },
  ],
});
