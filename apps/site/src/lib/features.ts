// The five things Tramme does, as the landing page shows them (Tabs.astro)
// and as the features page details them (its sections, with these ids). The
// pictures of the studio and the atelier are written here once: their
// sections read them from here too.

import type { ImageMetadata } from 'astro';
import studioLight from '../assets/studio-light.png';
import studioDark from '../assets/studio-dark.png';
import editorLight from '../assets/editor-light.png';
import editorDark from '../assets/editor-dark.png';
import assistantStill from '../videos/assistant.webp';
import showreelStill from '../videos/showreel.webp';
import launchStill from '../videos/launch-film.webp';

/** the app in the page's theme: paper on the light page, studio on the dark one */
export interface ShotPicture { shot: [light: ImageMetadata, dark: ImageMetadata]; alt: string }
/** a still of a film */
export interface StillPicture { still: ImageMetadata; alt: string }

export interface Feature {
  /** the id of its section on the features page */
  id: 'studio' | 'editor' | 'assistant' | 'packs' | 'render';
  name: string;
  line: string;
  picture: ShotPicture | StillPicture;
}

export const FEATURES: Feature[] = [
  {
    id: 'studio',
    name: 'Studio',
    line: 'Direct the film in words. Leave a note, get a take back on the picture, keep the ones you like.',
    picture: {
      shot: [studioLight, studioDark],
      alt: 'The Tramme studio: the Showreel example in front, its storyboard below, and the Direction panel with the brief, the palette and the material.',
    },
  },
  {
    id: 'editor',
    name: 'Atelier',
    line: 'Every layer, key and curve, one switch away from the studio, on the same film.',
    picture: {
      shot: [editorLight, editorDark],
      alt: 'The Tramme atelier: the layers of the Showreel example on the left, the frame in the viewport, the timeline below and the inspector on the right.',
    },
  },
  {
    id: 'assistant',
    name: 'Assistant',
    line: 'The AI edits with your tools: it looks at its own frames, shows a take, and asks before it spends.',
    picture: { still: assistantStill, alt: 'A film the assistant made from a few lines of direction.' },
  },
  {
    id: 'packs',
    name: 'Packs',
    line: 'Icons, diagrams, charts, kinetic type and physics, added to a project in a click.',
    picture: { still: showreelStill, alt: 'The Showreel example: kinetic type, shapes and a counter, made by the assistant.' },
  },
  {
    id: 'render',
    name: 'Export',
    line: 'The preview and the export are drawn by the same engine, frame for frame: MP4, WebM, GIF, Lottie and more.',
    picture: { still: launchStill, alt: 'The launch film, cut on the beat: compositions inside compositions and a 2.5D camera.' },
  },
];

/** the picture of a feature that is the app itself (the studio, the atelier) */
export function shotOf(id: Feature['id']): ShotPicture {
  const { picture } = FEATURES.find((f) => f.id === id)!;
  if (!('shot' in picture)) throw new Error(`the ${id} feature is not shown by a picture of the app`);
  return picture;
}
