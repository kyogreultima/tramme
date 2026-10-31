// The questions people ask first, with answers checked against the README, the
// docs, the code and the plans (lib/plans.ts). Shown by components/Faq.astro
// and told to the search engines (lib/site.ts). Plain text: no markup.

import { FORMATS } from './formats';
import type { Locale, Localised } from './i18n';
import { formatCredits, formatPrice, plan } from './plans';

export type Topic = 'billing' | 'credits' | 'cancelling' | 'watermark' | 'firstFilm' | 'data' | 'offline' | 'general';

export interface Question { q: string; a: string }
interface Entry { topic: Topic; q: Localised<string>; a: (locale: Locale) => string }

const formats = FORMATS.map((f) => f.name).join(', ');
const both = (en: string, fr: string) => (locale: Locale) => (locale === 'fr' ? fr : en);
const q = (en: string, fr: string): Localised<string> => ({ en, fr });

const ENTRIES: Entry[] = [
  {
    topic: 'general',
    q: q('Is Tramme free?', 'Tramme est-il gratuit ?'),
    a: both(
      'Basic is free, with no time limit. The apps, the engine and the atelier are the same in every plan; the paid plans sell services we run for you: storage, hosting, AI ready to use, cloud export. The source is available under the Functional Source License, so you can also read it, run it and change it.',
      'Basic est gratuit, sans limite de durée. Les applications, le moteur et l\'atelier sont les mêmes dans toutes les offres ; les offres payantes vendent des services que nous faisons tourner pour vous : stockage, hébergement, IA prête à l\'emploi, export cloud. Le code source est disponible sous la Functional Source License : vous pouvez aussi le lire, l\'exécuter et le modifier.',
    ),
  },
  {
    topic: 'general',
    q: q('Can I use Tramme for client work?', 'Puis-je utiliser Tramme pour des commandes clients ?'),
    a: both(
      'Yes. The films you make with Tramme are yours, and making them for clients or inside your company is a normal use. The licence reserves one thing: offering Tramme itself, or a product with substantially the same functions, to others as a commercial product or service. Each version becomes Apache-2.0 two years after its release.',
      'Oui. Les films que vous faites avec Tramme sont les vôtres, et les réaliser pour des clients ou dans votre entreprise est un usage normal. La licence réserve une seule chose : proposer Tramme lui-même, ou un produit aux fonctions substantiellement identiques, à des tiers comme produit ou service commercial. Chaque version passe sous Apache-2.0 deux ans après sa sortie.',
    ),
  },
  {
    topic: 'billing',
    q: q('How much do the plans cost, and what changes with a yearly plan?', 'Combien coûtent les offres, et que change l\'abonnement annuel ?'),
    a: (locale) => {
      const plus = plan('plus').price;
      const pro = plan('pro').price;
      return locale === 'fr'
        ? `Basic est gratuit. Plus coûte ${formatPrice(locale, plus.month)} par mois, ou ${formatPrice(locale, plus.year)} par mois en payant à l'année. Pro coûte ${formatPrice(locale, pro.month)} par mois, ou ${formatPrice(locale, pro.year)} par mois en payant à l'année. Tous les prix sont en euros.`
        : `Basic is free. Plus costs ${formatPrice(locale, plus.month)} a month, or ${formatPrice(locale, plus.year)} a month when billed yearly. Pro costs ${formatPrice(locale, pro.month)} a month, or ${formatPrice(locale, pro.year)} a month when billed yearly. Every price is in euros.`;
    },
  },
  {
    topic: 'credits',
    q: q('What are credits?', 'Que sont les crédits ?'),
    a: (locale) => {
      const plus = formatCredits(locale, plan('plus').credits);
      const pro = formatCredits(locale, plan('pro').credits);
      return locale === 'fr'
        ? `Les crédits paient l'IA que nous faisons tourner pour vous : l'assistant, la voix off, les sous-titres automatiques. Plus en inclut ${plus} par mois, Pro en inclut ${pro}, avec les meilleurs modèles. Avec votre propre clé de fournisseur, vous n'en dépensez pas : le fournisseur vous facture directement.`
        : `Credits pay for the AI we run for you: the assistant, voice-over, automatic subtitles. Plus includes ${plus} a month, Pro includes ${pro}, with the best models. With your own provider key you spend none: the provider bills you directly.`;
    },
  },
  {
    topic: 'general',
    q: q('Which AI does the assistant use?', 'Quelle IA utilise l\'assistant ?'),
    a: both(
      'Claude, or models from OpenAI, Gemini, OpenRouter and Z.AI. In every plan you can connect your own key; Plus and Pro also come with the AI ready to use, no key to create. The assistant shows each change as a take you keep or set aside, and asks before anything that costs money, such as a transcription.',
      'Claude, ou des modèles d\'OpenAI, Gemini, OpenRouter et Z.AI. Dans toutes les offres, vous pouvez brancher votre propre clé ; Plus et Pro incluent aussi l\'IA prête à l\'emploi, sans clé à créer. L\'assistant montre chaque changement comme une prise que vous gardez ou écartez, et demande avant tout ce qui coûte de l\'argent, comme une transcription.',
    ),
  },
  {
    topic: 'firstFilm',
    q: q('What is the first film offered?', 'Qu\'est-ce que le premier film offert ?'),
    a: both(
      'Every new account with a verified email gets enough AI for one short first film, once. It is how the "Describe your film" field on the home page works: you sign up, and the film starts from your sentence. After that, Basic uses your own provider key, or you choose a paid plan.',
      'Chaque nouveau compte dont l\'e-mail est vérifié reçoit assez d\'IA pour un premier film court, une seule fois. C\'est ainsi que fonctionne le champ « Décrivez votre film » de l\'accueil : vous créez un compte, et le film part de votre phrase. Ensuite, Basic utilise votre propre clé de fournisseur, ou vous choisissez une offre payante.',
    ),
  },
  {
    topic: 'watermark',
    q: q('What is the watermark?', 'Qu\'est-ce que le filigrane ?'),
    a: both(
      'The Tramme logo, in a corner of the exported film. On Basic it is always there. On Plus and Pro it is on by default, and a switch in the settings turns it off; the first export tells you so. Without an account, Tramme follows the Basic rules. The desktop app and the CLI keep the watermark until the desktop app can sign in to an account.',
      'Le logo Tramme, dans un coin du film exporté. Avec Basic, il est toujours là. Avec Plus et Pro, il est activé par défaut, et un réglage permet de le retirer ; le premier export vous le dit. Sans compte, Tramme suit les règles de Basic. L\'application de bureau et la CLI gardent le filigrane tant que l\'application de bureau ne peut pas se connecter à un compte.',
    ),
  },
  {
    topic: 'cancelling',
    q: q('Can I cancel?', 'Puis-je résilier ?'),
    a: both(
      'Yes, at any time, from your space. You keep the plan until the end of the period you paid for, then you return to Basic. Your projects stay yours: you can export them as .tramme archives at any time.',
      'Oui, à tout moment, depuis votre espace. Vous gardez l\'offre jusqu\'à la fin de la période payée, puis vous revenez à Basic. Vos projets restent à vous : vous pouvez les exporter en archives .tramme à tout moment.',
    ),
  },
  {
    topic: 'data',
    q: q('Where do my projects live?', 'Où vivent mes projets ?'),
    a: both(
      'In the cloud once you have an account, public or private depending on your plan, on every device. On the desktop, a project can also live in a folder of your computer. A project is a file you can export, keep and open again: a .tramme archive. Your provider keys stay in a key vault the editor cannot read.',
      'Dans le cloud dès que vous avez un compte, publics ou privés selon votre offre, sur tous vos appareils. Sur le bureau, un projet peut aussi vivre dans un dossier de votre ordinateur. Un projet est un fichier que vous pouvez exporter, conserver et rouvrir : une archive .tramme. Vos clés de fournisseur restent dans un coffre que l\'éditeur ne peut pas lire.',
    ),
  },
  {
    topic: 'offline',
    q: q('Does it work offline?', 'Cela fonctionne-t-il hors ligne ?'),
    a: both(
      'The desktop app does, and so does the web app once your browser has installed it. Only the assistant needs a connection, to reach the AI provider, and the cloud services need one too: cloud projects, cloud export, sharing.',
      'L\'application de bureau, oui, et l\'application web aussi une fois installée par votre navigateur. Seul l\'assistant a besoin d\'une connexion, pour joindre le fournisseur d\'IA, ainsi que les services cloud : projets cloud, export cloud, partage.',
    ),
  },
  {
    topic: 'general',
    q: q('Which formats can I export?', 'Quels formats puis-je exporter ?'),
    a: both(
      `${formats}. The preview and the export are drawn by the same engine, so what you see is what you get. MOV comes from the command line. Cloud export is 1080p on Basic and Plus, 4K on Pro.`,
      `${formats}. L'aperçu et l'export sont dessinés par le même moteur : ce que vous voyez est ce que vous obtenez. Le MOV vient de la ligne de commande. L'export cloud est en 1080p avec Basic et Plus, en 4K avec Pro.`,
    ),
  },
  {
    topic: 'general',
    q: q('Can I add my own effects and layers?', 'Puis-je ajouter mes propres effets et calques ?'),
    a: both(
      'Yes. A project can bring its own layer types, effects and modifiers as plugins, small JavaScript modules, and the assistant can write one for your project when something is missing.',
      'Oui. Un projet peut apporter ses propres types de calques, effets et modificateurs sous forme de plugins, de petits modules JavaScript, et l\'assistant peut en écrire un pour votre projet quand il manque quelque chose.',
    ),
  },
  {
    topic: 'general',
    q: q('Which systems does the desktop app run on?', 'Sur quels systèmes tourne l\'application de bureau ?'),
    a: both(
      'Windows, macOS and Linux. The installers are not signed by a known publisher yet, so the system may ask you to confirm the first launch: the download page says how.',
      'Windows, macOS et Linux. Les installateurs ne sont pas encore signés par un éditeur connu : le système peut demander de confirmer le premier lancement, la page de téléchargement explique comment.',
    ),
  },
];

/** the questions in a language, all of them or those of some topics */
export function faq(locale: Locale, topics?: Topic[]): Question[] {
  return ENTRIES.filter((e) => !topics || topics.includes(e.topic)).map((e) => ({ q: e.q[locale], a: e.a(locale) }));
}

/** the topics the pricing page answers, the others being the landing's */
export const PRICING_TOPICS: Topic[] = ['billing', 'credits', 'cancelling', 'watermark', 'firstFilm', 'data', 'offline'];
