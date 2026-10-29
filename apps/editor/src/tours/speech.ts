// What is said: nothing is transcribed on its own, the user starts it, then
// the captions and the assistant work on the words. In the studio (the
// material of the film) and in the atelier (the inspector of a sound or video
// layer, the assets).

import { comp, S, select } from '../state.ts';
import { studio } from '../studio.ts';
import { mediaOf } from '../ui/Transcribe.tsx';
import { composer, inAtelier, inStudio, press, registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

/** the first layer of the open composition playing a sound or a video of the project */
const firstMedia = () => Object.entries(comp.peek().layers).find(([, l]) => mediaOf(l))?.[0];
const selectMedia = () => { press('left-tab-layers'); const id = firstMedia(); if (id) select([id]); };
/** the layer selected, its Speech section scrolled into the inspector's view */
const showSpeech = async () => {
  selectMedia();
  await new Promise((r) => requestAnimationFrame(r));
  document.querySelector('[data-tour="speech"]')?.closest('.section')?.scrollIntoView({ block: 'center' });
};

registerTour({
  id: 'speech',
  title: m('tours.speech.title'),
  summary: m('tours.speech.summary'),
  page: 'editor',
  order: 25,
  available: () => S.ready.value,
  steps: [
    {
      title: m('tours.speech.intro'),
      body: m('tours.speech.introBody'),
    },
    {
      target: 'material', side: 'left', align: 'start',
      before: () => { studio.panel.value = 'direction'; },
      when: inStudio,
      title: m('tours.speech.material'),
      body: m('tours.speech.materialBody'),
    },
    {
      target: 'speech', side: 'left', align: 'start',
      before: showSpeech,
      when: () => inAtelier() && !!firstMedia(),
      title: m('tours.speech.inspector'),
      body: m('tours.speech.inspectorBody'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-assets'),
      when: inAtelier,
      title: m('tours.speech.assets'),
      body: m('tours.speech.assetsBody'),
    },
    {
      target: composer, side: 'top', align: 'center',
      before: () => { if (inStudio()) studio.panel.value = 'notes'; else press('left-tab-layers'); },
      title: m('tours.speech.files'),
      body: m('tours.speech.filesBody'),
    },
    {
      title: m('tours.speech.words'),
      body: m('tours.speech.wordsBody'),
    },
  ],
});
