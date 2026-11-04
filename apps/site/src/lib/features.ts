// The five things Tramme does, as the landing page shows them (Tabs.astro)
// and as the features page details them (its sections, with these ids). The
// pictures of the studio and the atelier are written here once: their
// sections read them from here too.

import type { ImageMetadata } from 'astro';
import { pick, type Locale, type Localised } from './i18n';
import studioShot from '../assets/film-studio.webp';
import editorShot from '../assets/film-atelier.webp';
import showreelStill from '../videos/showreel.webp';
import launchStill from '../videos/launch-film.webp';

/** a screen of the app, taken from the launch film */
export interface ShotPicture { shot: ImageMetadata; alt: Localised<string> }
/** a still of a film */
export interface StillPicture { still: ImageMetadata; alt: Localised<string> }

export interface Feature {
  /** the id of its section on the features page */
  id: 'studio' | 'editor' | 'assistant' | 'packs' | 'render';
  name: Localised<string>;
  line: Localised<string>;
  picture: ShotPicture | StillPicture;
}

export const FEATURES: Feature[] = [
  {
    id: 'studio',
    name: { en: 'Studio', fr: 'Studio' },
    line: { en: 'Direct the film in words. Leave a note, get a take back on the picture, keep the ones you like.', fr: 'Dirigez le film avec des mots. Laissez une note, recevez une prise sur l’image, gardez celles qui vous plaisent.' },
    picture: {
      shot: studioShot,
      alt: { en: 'The Tramme studio: the Showreel example in front, its storyboard below, and the notes panel beside the film.', fr: 'Le studio de Tramme : l’exemple Showreel au premier plan, son storyboard dessous et le panneau de notes à côté du film.' },
    },
  },
  {
    id: 'editor',
    name: { en: 'Atelier', fr: 'Atelier' },
    line: { en: 'Every layer, key and curve, one switch away from the studio, on the same film.', fr: 'Chaque calque, image clé et courbe, à un bouton du studio, sur le même film.' },
    picture: {
      shot: editorShot,
      alt: { en: 'The Tramme atelier: the layers of the Showreel example on the left, the frame in the viewport, the timeline below and the inspector on the right.', fr: 'L’atelier de Tramme : les calques de l’exemple Showreel à gauche, l’image dans la vue, la timeline dessous et l’inspecteur à droite.' },
    },
  },
  {
    id: 'assistant',
    name: { en: 'Assistant', fr: 'Assistant' },
    line: { en: 'The AI edits with your tools: it looks at its own frames, shows a take, and asks before it spends.', fr: 'L’IA monte avec vos outils : elle regarde ses propres images, montre une prise et demande avant de dépenser.' },
    picture: {
      shot: editorShot,
      alt: { en: 'The assistant beside the Showreel example in the Tramme atelier, with its tools and direction field.', fr: 'L’assistant à côté de l’exemple Showreel dans l’atelier Tramme, avec ses outils et son champ de direction.' },
    },
  },
  {
    id: 'packs',
    name: { en: 'Packs', fr: 'Packs' },
    line: { en: 'Icons, diagrams, charts, kinetic type and physics, added to a project in a click.', fr: 'Icônes, schémas, graphiques, typographie animée et physique, ajoutés à un projet en un clic.' },
    picture: { still: showreelStill, alt: { en: 'The Showreel example: kinetic type, shapes and a counter, made by the assistant.', fr: 'L’exemple Showreel : typographie animée, formes et compteur, faits par l’assistant.' } },
  },
  {
    id: 'render',
    name: { en: 'Export', fr: 'Export' },
    line: { en: 'The preview and the export are drawn by the same engine, frame for frame: MP4, WebM, GIF, Lottie and more.', fr: 'L’aperçu et l’export sont dessinés par le même moteur, image par image : MP4, WebM, GIF, Lottie et plus.' },
    picture: { still: launchStill, alt: { en: 'The launch film, cut on the beat: compositions inside compositions and a 2.5D camera.', fr: 'Le film de lancement, monté sur le rythme : des compositions dans des compositions et une caméra 2.5D.' } },
  },
];

/** the picture of a feature that is the app itself (the studio, the atelier) */
export function shotOf(id: Feature['id']): ShotPicture {
  const { picture } = FEATURES.find((f) => f.id === id)!;
  if (!('shot' in picture)) throw new Error(`the ${id} feature is not shown by a picture of the app`);
  return picture;
}

/** a feature’s words in a language */
export const wordsOf = (f: Feature, locale: Locale) => ({ name: pick(locale, f.name), line: pick(locale, f.line), alt: pick(locale, f.picture.alt) });
