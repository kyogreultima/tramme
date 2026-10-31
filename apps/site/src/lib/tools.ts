// What a motion designer looks for first, before any detail, by what it is for
// (Tools.astro). Each group points to the docs page that holds it.

import type { Localised } from './i18n';

export interface ToolGroup { name: Localised<string>; text: Localised<string>; doc: string; tools: Localised<string[]> }

export const TOOL_GROUPS: ToolGroup[] = [
  {
    name: { en: 'Motion', fr: 'Mouvement' },
    text: { en: 'Set a key, shape its ease, let the usual behaviours do the rest.', fr: 'Posez une clé, façonnez son accélération, laissez les comportements usuels faire le reste.' },
    doc: 'editor',
    tools: {
      en: ['Keyframes', 'Graph editor', 'Wiggle, loop, spring', 'Time displacement', 'Frame-by-frame drawing'],
      fr: ['Images clés', 'Éditeur de courbes', 'Wiggle, boucle, ressort', 'Déplacement du temps', 'Dessin image par image'],
    },
  },
  {
    name: { en: 'Building', fr: 'Construction' },
    text: { en: 'Films inside films, parts reused, shapes that draw themselves.', fr: 'Des films dans des films, des pièces réutilisées, des formes qui se dessinent seules.' },
    doc: 'editor',
    tools: {
      en: ['Precompositions', 'Components', 'Masks and mattes', 'Self-drawing strokes'],
      fr: ['Précompositions', 'Composants', 'Masques et caches', 'Tracés qui se dessinent'],
    },
  },
  {
    name: { en: 'The picture', fr: 'L\'image' },
    text: { en: 'A camera with depth, the look of the frame, effects that stay the same on every render.', fr: 'Une caméra avec de la profondeur, le rendu de l\'image, des effets identiques à chaque rendu.' },
    doc: 'editor',
    tools: {
      en: ['2.5D camera', 'Motion blur', 'Colour grading', 'Chroma key', 'Shaders', 'Particles', 'Transitions'],
      fr: ['Caméra 2.5D', 'Flou de mouvement', 'Étalonnage', 'Incrustation sur fond vert', 'Shaders', 'Particules', 'Transitions'],
    },
  },
  {
    name: { en: 'Sound and speech', fr: 'Son et parole' },
    text: { en: 'Cut a talk on its words, caption it, put the sound under the picture.', fr: 'Montez une prise de parole sur ses mots, sous-titrez-la, placez le son sous l\'image.' },
    doc: 'montage',
    tools: { en: ['Captions from speech', 'Sound library'], fr: ['Sous-titres depuis la parole', 'Bibliothèque de sons'] },
  },
  {
    name: { en: 'Delivery', fr: 'Livraison' },
    text: { en: 'The film in the format it is going to.', fr: 'Le film dans le format où il va.' },
    doc: 'editor',
    tools: { en: ['Transparent video', 'Lottie'], fr: ['Vidéo transparente', 'Lottie'] },
  },
];
