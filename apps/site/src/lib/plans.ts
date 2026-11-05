// The three plans, as data: what the pricing page, the landing's closing line
// and the FAQ show, and what the payment will read. The table is the spec's
// (docs/superpowers/specs/2026-10-31-site-platform-redesign-design.md, Pricing).
// Paid features are services the platform runs, not switches in the app's code.

import type { Locale, Localised } from './i18n';
// the figures (prices, credits) are the platform's: one source (packages/plans), read by the payment too
import { PLAN_TERMS, termsOf, type PlanId } from '@tramme/plans';

export type { PlanId };
export const PLAN_IDS: PlanId[] = PLAN_TERMS.map((p) => p.id);

export interface Plan {
  id: PlanId;
  /** euros a month; `year` is the monthly price when billed yearly */
  price: { month: number; year: number };
  /** credits included each month (0: none) */
  credits: number;
  /** the plan's line under its name */
  line: Localised<string>;
}

const LINES: Record<PlanId, Localised<string>> = {
  basic: { en: 'To try Tramme and make public films.', fr: 'Pour essayer Tramme et publier des films.' },
  plus: { en: 'For the films you make every month.', fr: 'Pour les films que vous faites chaque mois.' },
  pro: { en: 'For studios and freelancers who deliver.', fr: 'Pour les studios et les indépendants qui livrent.' },
};

export const PLANS: Plan[] = PLAN_TERMS.map((t) => ({ id: t.id, price: t.price, credits: t.credits, line: LINES[t.id] }));

export const plan = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

/** a cell of the table: yes, no, or a few words */
export type Cell = boolean | Localised<string>;

export interface Row {
  id: string;
  label: Localised<string>;
  values: Record<PlanId, Cell>;
}

const same = (en: string, fr: string): Localised<string> => ({ en, fr });
const monthly = (n: number, en: string, fr: string): Localised<string> => ({ en: `${formatCredits('en', n)} ${en}`, fr: `${formatCredits('fr', n)} ${fr}` });
const row = (id: string, en: string, fr: string, basic: Cell, plus: Cell, pro: Cell): Row => ({ id, label: same(en, fr), values: { basic, plus, pro } });

export const ROWS: Row[] = [
  row('ai', 'AI included', 'IA incluse', same('The first film, offered once', 'Le premier film, offert une fois'), monthly(termsOf('plus').credits, 'credits a month', 'crédits par mois'), monthly(4000, 'credits a month, the best models', 'crédits par mois, les meilleurs modèles')),
  row('key', 'Your own AI provider key (Anthropic, OpenAI, Gemini…)', 'Votre propre clé de fournisseur d\'IA (Anthropic, OpenAI, Gemini…)', true, true, true),
  row('cloud', 'Projects in the cloud', 'Projets dans le cloud', same('3', '3'), same('Unlimited', 'Illimités'), same('Unlimited', 'Illimités')),
  row('private', 'Private projects', 'Projets privés', same('No, public only', 'Non, publics uniquement'), true, true),
  row('history', 'Version history', 'Historique des versions', same('7 days', '7 jours'), same('30 days', '30 jours'), same('Unlimited', 'Illimité')),
  row('watermark', 'Watermark (the Tramme logo in a corner)', 'Filigrane (le logo Tramme dans un coin)', same('Always', 'Toujours'), same('On by default, can be turned off', 'Activé par défaut, désactivable'), same('On by default, can be turned off', 'Activé par défaut, désactivable')),
  row('brand', 'Brand kit (logos, palettes, fonts shared across projects)', 'Kit de marque (logos, palettes, polices partagés entre projets)', false, true, true),
  row('share', 'Share pages', 'Pages de partage', same('With the Tramme badge', 'Avec le badge Tramme'), same('Badge removable', 'Badge retirable'), same('Badge removable', 'Badge retirable')),
  row('review', 'Client review links with comments', 'Liens de relecture client avec commentaires', false, true, true),
  row('voice', 'Voice-over and dubbing, automatic subtitles', 'Voix off et doublage, sous-titres automatiques', false, same('In credits', 'En crédits'), same('In credits', 'En crédits')),
  row('export', 'Cloud export', 'Export cloud', same('1080p', '1080p'), same('1080p', '1080p'), same('4K, in batches', '4K, par lots')),
  row('versions', 'Automatic 16:9, 9:16 and 1:1 versions', 'Versions 16:9, 9:16 et 1:1 automatiques', false, false, true),
  row('licensed', 'Licensed music, sounds and fonts', 'Musiques, sons et polices sous licence', false, false, true),
  row('stats', 'Statistics of public projects (views, reuses)', 'Statistiques des projets publics (vues, réutilisations)', false, false, true),
  row('queue', 'Priority export queue', 'File d\'export prioritaire', false, false, true),
  row('api', 'Cloud export by API or CLI', 'Export cloud par API ou CLI', false, false, true),
  row('reference', 'Start from a reference (see the roadmap)', 'Partir d\'une référence (voir la feuille de route)', false, false, same('Yes, once shipped', 'Oui, dès sa sortie')),
  row('support', 'Support', 'Assistance', same('Community', 'Communauté'), same('Email', 'E-mail'), same('Priority', 'Prioritaire')),
];

/** what all three plans include */
export const IN_ALL: Localised<string> = same(
  'The web app, the desktop app, the CLI, the atelier, the engine, local export.',
  'L\'application web, l\'application de bureau, la CLI, l\'atelier, le moteur, l\'export local.',
);

/** a price in euros, in the language's habit: 12 € (the figure, a no-break space, the sign) */
export function formatPrice(locale: Locale, euros: number): string {
  return `${new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB').format(euros)} €`;
}

/** credits as people write numbers: 1 000, the thousands apart by a no-break space */
export function formatCredits(_locale: Locale, n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
