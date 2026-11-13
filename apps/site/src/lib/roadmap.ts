// What is coming, and only what is still ahead at launch: what ships before
// launch is simply part of the site. Shown by pages/[...lang]/roadmap.astro.

import type { Localised } from './i18n';

export type Horizon = 'now' | 'next' | 'later';
export const HORIZONS: Horizon[] = ['now', 'next', 'later'];

export interface RoadmapItem {
  id: string;
  horizon: Horizon;
  title: Localised<string>;
  text: Localised<string>;
}

export const ROADMAP: RoadmapItem[] = [
  {
    id: 'safe-projects',
    horizon: 'now',
    title: { en: 'Open projects with confidence', fr: 'Ouvrir les projets sereinement' },
    text: {
      en: 'An isolated environment for opening, playing and exporting projects, including their animations and plugins, without a general code-execution question. Extra access, such as sending media to an external service, will require a specific permission. The current question stays until these protections are validated.',
      fr: 'Un environnement isolé pour ouvrir, lire et exporter les projets, animations et plugins compris, sans autorisation générale d’exécuter du code. Un accès supplémentaire, comme envoyer un média à un service externe, demandera une permission précise. La question actuelle reste en place jusqu’à la validation de ces protections.',
    },
  },
  {
    id: 'desktop-account',
    horizon: 'now',
    title: { en: 'The desktop app, signed in', fr: 'L\'application de bureau, connectée' },
    text: {
      en: 'Sign in from the desktop app to reach your cloud projects and your plan. Until then the desktop app and the CLI follow the Basic rules, watermark included.',
      fr: 'Connectez-vous depuis l\'application de bureau pour retrouver vos projets cloud et votre offre. D\'ici là, l\'application de bureau et la CLI suivent les règles de Basic, filigrane compris.',
    },
  },
  {
    id: 'start-from-a-reference',
    horizon: 'next',
    title: { en: 'Start from a reference', fr: 'Partir d\'une référence' },
    text: {
      en: 'Drop a video, a gif or a Lottie you like next to your brief. The assistant reads how it is built (its scenes, its pace, its cuts on the music, its moves) and makes your film the same way, with your words, your brand and your footage, as editable layers. Inspired by reanimate (MIT).',
      fr: 'Déposez une vidéo, un gif ou un Lottie qui vous plaît à côté de votre brief. L\'assistant lit comment il est construit (ses scènes, son rythme, ses coupes sur la musique, ses mouvements) et fait votre film de la même manière, avec vos mots, votre marque et vos images, en calques modifiables. Inspiré de reanimate (MIT).',
    },
  },
  {
    id: 'marketplace',
    horizon: 'later',
    title: { en: 'A marketplace', fr: 'Une place de marché' },
    text: {
      en: 'Creators sell film templates and packs; Tramme takes a commission. It is separate from the plans.',
      fr: 'Les créateurs vendent des modèles de films et des packs ; Tramme prend une commission. Elle est distincte des offres.',
    },
  },
];
