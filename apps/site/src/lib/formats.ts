import type { Localised } from './i18n';

/** what Tramme writes: `tramme render` (video, frames) and `tramme export`
 *  (vectors, sound); the editor writes them all in the browser but MOV */
export const FORMATS: { name: string; what: Localised<string> }[] = [
  { name: 'MP4', what: { en: 'H.264, or H.265 in 10 bits', fr: 'H.264, ou H.265 en 10 bits' } },
  { name: 'MOV', what: { en: 'ProRes 4444, from the command line', fr: 'ProRes 4444, en ligne de commande' } },
  { name: 'WebM', what: { en: 'VP9, with alpha', fr: 'VP9, avec alpha' } },
  { name: 'GIF', what: { en: 'Animated image', fr: 'Image animée' } },
  { name: 'PNG', what: { en: 'A still or every frame, up to 16 bits', fr: 'Une image fixe ou chaque image, jusqu\'à 16 bits' } },
  { name: 'Lottie', what: { en: 'Vectors for web and apps', fr: 'Vectoriel pour le web et les applications' } },
  { name: 'SVG', what: { en: 'A frame as vectors', fr: 'Une image en vectoriel' } },
  { name: 'WAV', what: { en: 'The sound mix alone', fr: 'Le mixage sonore seul' } },
];
