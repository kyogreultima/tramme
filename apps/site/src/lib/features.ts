// The five things Tramme does, as the landing page lists them (Materials.astro)
// and as the features page details them (its sections, with these ids): a name
// and one line each, written here once.

import { pick, type Locale, type Localised } from './i18n';

export interface Feature {
  /** the id of its section on the features page */
  id: 'studio' | 'editor' | 'assistant' | 'packs' | 'render';
  name: Localised<string>;
  line: Localised<string>;
}

export const FEATURES: Feature[] = [
  {
    id: 'studio',
    name: { en: 'Studio', fr: 'Studio' },
    line: { en: 'Direct the film in words. Leave a note, get a take back on the picture, keep the ones you like.', fr: 'Dirigez le film avec des mots. Laissez une note, recevez une prise sur l’image, gardez celles qui vous plaisent.' },
  },
  {
    id: 'editor',
    name: { en: 'Atelier', fr: 'Atelier' },
    line: { en: 'Every layer, key and curve, one switch away from the studio, on the same film.', fr: 'Chaque calque, image clé et courbe, à un bouton du studio, sur le même film.' },
  },
  {
    id: 'assistant',
    name: { en: 'Assistant', fr: 'Assistant' },
    line: { en: 'The AI edits with your tools: it looks at its own frames, shows a take, and asks before it spends.', fr: 'L’IA monte avec vos outils : elle regarde ses propres images, montre une prise et demande avant de dépenser.' },
  },
  {
    id: 'packs',
    name: { en: 'Packs', fr: 'Packs' },
    line: { en: 'Icons, diagrams, charts, kinetic type and physics, added to a project in a click.', fr: 'Icônes, schémas, graphiques, typographie animée et physique, ajoutés à un projet en un clic.' },
  },
  {
    id: 'render',
    name: { en: 'Export', fr: 'Export' },
    line: { en: 'The preview and the export are drawn by the same engine, frame for frame: MP4, WebM, GIF, Lottie and more.', fr: 'L’aperçu et l’export sont dessinés par le même moteur, image par image : MP4, WebM, GIF, Lottie et plus.' },
  },
];

/** a feature’s words in a language */
export const wordsOf = (f: Feature, locale: Locale) => ({ name: pick(locale, f.name), line: pick(locale, f.line) });
