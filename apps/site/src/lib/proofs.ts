// What a feature does, shown on real footage rather than claimed: a picture
// before and after (compared with a slider), the clip it comes from, where
// the tool is in the app, and the source's credit. The features page lists
// them (Proofs.astro); a new proof is one more entry here, its stills in
// src/assets/proofs/ and its clip in src/videos/ (proof-<id>.webm, .mp4, .webp).

import type { ImageMetadata } from 'astro';
import gradingBefore from '../assets/proofs/grading-before.jpg';
import gradingAfter from '../assets/proofs/grading-after.jpg';
import type { Localised } from './i18n';

export interface Proof {
  id: string;
  /** the feature, as the app names it */
  name: Localised<string>;
  /** what the comparison shows */
  text: Localised<string>;
  /** where it is in the app */
  where: Localised<string>;
  before: ImageMetadata;
  after: ImageMetadata;
  /** what each picture is */
  beforeLabel: Localised<string>;
  afterLabel: Localised<string>;
  /** the clip in src/videos (proof-<id>), its size and length */
  video?: { width: number; height: number; duration: number; label: Localised<string> };
  /** the footage's author, page and licence */
  credit: { author: string; url: string; licence: string; licenceUrl: string };
}

export const PROOFS: Proof[] = [
  {
    id: 'grading',
    name: { en: 'Colour grading', fr: 'Étalonnage' },
    text: {
      en: 'An iPhone clip shot in Apple Log, never graded: flat and grey, as the camera records it. Tramme reads the log into scene light, brings it to the screen without clipping, then grades it: highlights held, blacks set, the reds and the blue shadows calmed, a light vignette.',
      fr: 'Un plan d’iPhone filmé en Apple Log, jamais étalonné : plat et gris, tel que la caméra l’enregistre. Tramme lit le log en lumière de scène, le ramène à l’écran sans écrêter, puis l’étalonne : hautes lumières tenues, noirs posés, rouges et ombres bleues calmés, un léger vignettage.',
    },
    where: {
      en: 'Select the clip, then Properties, Effects, +: Colour grading, its footage set to Apple Log. Or one tap on a colour look in the library.',
      fr: 'Sélectionnez le plan, puis Propriétés, Effets, + : Étalonnage, ses images réglées sur Apple Log. Ou un look couleur en un geste dans la bibliothèque.',
    },
    before: gradingBefore,
    after: gradingAfter,
    beforeLabel: { en: 'Apple Log, as shot', fr: 'Apple Log, tel que filmé' },
    afterLabel: { en: 'Graded in Tramme', fr: 'Étalonné dans Tramme' },
    video: { width: 1920, height: 1080, duration: 8, label: { en: 'The log clip and its grade, a line sweeping between them', fr: 'Le plan en log et son étalonnage, une ligne balayant de l’un à l’autre' } },
    credit: { author: 'Baran Robin', url: 'https://www.pexels.com/video/ungraded-apple-prores-log-footage-27814739/', licence: 'Pexels', licenceUrl: 'https://www.pexels.com/license/' },
  },
];

/** the section's name in the features page's index */
export const PROOFS_NAME: Localised<string> = { en: 'Before and after', fr: 'Avant et après' };
