# The site for the platform — design

Date: 2026-10-31. Status: agreed in conversation, waiting for review. Supersedes [2026-10-30-site-redesign-design.md](2026-10-30-site-redesign-design.md): what the site says today is a work in progress and is not a reference for content, only for reusable code.

## Intent

Tramme is becoming a hosted platform in the manner of Meshy or Higgsfield: accounts, a personal space, projects public or private, a community gallery, three paid plans (see [2026-10-28-accounts-and-cloud-storage-design.md](2026-10-28-accounts-and-cloud-storage-design.md) for the programme). The site has to sell that platform: convince a visitor who has never heard of Tramme, show what the community makes with it, and lead to an account.

The structure is a hybrid of two references the user named: the top of https://www.framer.com/ to convince (a centred hero with a demo, the product's pillars), the heart of https://higgsfield.ai/ to show (a feed of community projects, "explore the inside of every project"). It is a multi-page site: pricing, FAQ and the gallery each have their own page instead of crowding the landing.

The site is built now, on `develop`, and deployed only when the platform behind it (accounts, payment, gallery) is finished. It describes the platform as available.

## Goals

- A landing page of five sections (below) that says what Tramme is in the first screen and leads to sign-up through a "describe your film" field.
- A pricing page presenting Basic, Plus and Pro, read from one data source the payment will read later.
- A community gallery (`/explore/`) and a page per public project, working today on seed data and ready to serve live data once the gallery backend exists.
- The site in English and French, the language and the theme chosen in the footer.
- Light first: light is the default for every visitor, dark is an opt-in.
- A public roadmap page.

## Non-goals

- The backend: accounts, credits, payment, the gallery's storage and moderation, the watermark, the welcome credit. They are platform projects; this design only fixes what the site needs from them (the contract below).
- Sign-in, sign-up and the personal space: they live in the app, the site links to them.
- Translating the docs: `/docs/` stays English (Starlight), untouched.
- Deploying anything.

## Anti-goals (it fails even if it works)

- **A fragmented page.** The first redesign of 2026-10-30 was rejected for this: every section with its own width, alignment, heading style and effect. Framer and Higgsfield chain many layouts; this site keeps **one grid**: one container width, every section headed by `Head` (centred title and one sentence), the same space between sections, one picture treatment (framed, flat, in the page's theme). No tilt, no floating pieces, no lit-up sentence.
- **Looking like Framer or Higgsfield.** Their structure, not their look: the look is the app's design system (`apps/site/src/styles/theme.css`, the editor's paper and studio themes, Geist, the teal accent, 20 px surfaces, pill buttons).
- **A heavier landing.** No engine on any page of the site; videos load only near the screen (`Media.astro`); weight and Lighthouse scores measured before and after, not worse.
- **Invented proof or invented people.** No fake creators, fake counts, testimonials or customer logos. The gallery's seed is the repository's examples and the user's own films, credited truthfully.
- **A bait hero.** The prompt field must not lead to a paywall: it leads to an account whose welcome credit makes the first film (see Pricing).
- What the project's memory forbids: a colour outside the theme tokens; gradients, glows, sparkles; small labels above titles, step numbers, connector dashes; a "New" pill above the title.

## Site map

| Page | Role | Content |
|---|---|---|
| `/` | landing | the five sections below |
| `/explore/` | the community | every public project in a grid, sorted recent or popular; the repository's examples featured at first. Replaces `/examples/` (a redirect stays) |
| `/p/<id>/` | one public project | its video large, title, author, description, the author's other projects, "Open in Tramme" |
| `/pricing/` | plans | Basic, Plus, Pro side by side, a monthly/yearly switch, the full comparison table, the FAQ (billing, credits, cancelling, the watermark, the first film, data, offline) |
| `/features/` | the pillars in detail | rewritten for the platform: Studio, Atelier, Assistant, Export, and the cloud services |
| `/roadmap/` | what is coming | items grouped by horizon (now, next, later), each a title and a sentence |
| `/download/` | the desktop app | kept, restyled |
| `/about/` | the project | kept, rewritten |
| `/terms/` | terms of use and sale | new: required once subscriptions are sold |
| `/privacy/` | what is kept where | rewritten for accounts and the cloud |
| `/docs/` | the docs | Starlight, untouched |

Every page exists in English at its path and in French under `/fr/` (`/fr/pricing/`…), except `/docs/`.

## The top bar and the footer

**Top bar**: the app's floating pill, kept. Left the logo; in the middle the menus **Product** and **Features** (as today, `<details>`, no script) and the links **Explore**, **Pricing**, **Docs**; right **Log in** (ghost) and **Start for free** (primary). The theme toggle and the repository link leave the bar. Under 960 px everything folds into one menu, the two buttons included.

**Footer**: the site map in columns (Product, Community, Resources with docs, changelog, roadmap and pricing, Company with about, terms, privacy, security, licence, repository), then a bottom row: the copyright on the left, on the right the **language** choice (English, Français) and the **theme** choice (Light, Dark).

- The language choice is two links to the same page in the other language: no script.
- The theme choice reuses today's mechanism (`ThemeProvider.astro`, the `starlight-theme` key shared with the docs), shown as a two-option control instead of the toggle icon. Two options only, no "system": the site is light first even for a visitor whose computer is dark.
- The docs keep Starlight's header and their toggle in it (Starlight's layout is not replaced); the choice is shared, so it holds on both sides.

## The landing page, section by section

1. **Hero.** The title, one sentence, then a field "Describe your film…" with a send button, and under it three or four ideas (product launch, explainer, social clip…). Under them the app's demo video, large. The field is a plain HTML form sending the text to the app's sign-up address (contract, point 1); each idea is a link to the same address with its sentence filled in. No script. A line near the field says the first film is offered.
2. **The pillars.** Today's tabs component (`Tabs.astro`: radio inputs and CSS, no script): Studio, Atelier, Assistant, Export, one frame whose picture and sentence change.
3. **The community.** "Explore the inside of every project": eight cards of public projects (still or video on hover/focus, title, author's avatar and name), and a link to `/explore/`. Higgsfield's card anatomy, in the site's look. Data from the contract's point 2.
4. **The platform.** A bento grid of the cloud services: projects on every device, public or private, cloud export up to 4K, transcription and subtitles, voice-over, packs. Each tile a short sentence and a picture or nothing; links to `/features/`.
5. **Closing.** The call once more ("Your next film starts with a sentence"), the primary button, and a quiet line "Basic is free — see the plans" to `/pricing/`.

## Pricing

What the plans contain, as decided with the user. The pricing page shows it; the platform implements it.

| | Basic | Plus | Pro |
|---|---|---|---|
| Price, monthly | free | 12 € | 35 € |
| Price, yearly (per month) | free | 10 € | 29 € |
| AI included | the first film, offered once | 1 000 credits a month | 4 000 credits a month, the best models |
| Your own AI provider key (Anthropic, OpenAI, Gemini…) | yes | yes | yes |
| Projects in the cloud | 3 | unlimited | unlimited |
| Private projects | no, public only | yes | yes |
| Version history | 7 days | 30 days | unlimited |
| Watermark (the Tramme logo in a corner) | always | on by default, can be turned off | on by default, can be turned off |
| Brand kit (logos, palettes, fonts shared across projects) | | yes | yes |
| Share pages | with the Tramme badge | badge removable | badge removable |
| Client review links with comments | | yes | yes |
| Voice-over and dubbing, automatic subtitles | | in credits | in credits |
| Cloud export | 1080p | 1080p | 4K, in batches |
| Automatic 16:9, 9:16 and 1:1 versions | | | yes |
| Licensed music, sounds and fonts | | | yes |
| Statistics of public projects (views, reuses) | | | yes |
| Priority export queue | | | yes |
| Cloud export by API or CLI | | | yes |
| Start from a reference (see Roadmap) | | | yes, once shipped |
| Support | community | email | priority |
| In all three | the web app, the desktop app, the CLI, the atelier, the engine, local export | | |

Rules behind it, from the conversation:

- **Paid features are services the platform runs** (storage, hosting, AI, cloud export, licences), not switches in the app's code: the source is available and anyone can rebuild the app without a switch. The watermark is the accepted exception (power users can rebuild; the others are the market).
- **Everyone can connect their own AI provider key**, Basic and use without an account included: the provider bills its user, not Tramme; the desktop app, which cannot sign in at launch, has no other way to the assistant; and a restriction in the app's code would not hold. Plus and Pro sell the AI ready to use (credits included, no key to create), not the right to use AI.
- **Basic includes no AI paid by Tramme**, except the **welcome credit**: every new account with a verified email gets enough for one short first film, once (limits per IP against multiple accounts). This is what makes the hero's field honest.
- **The watermark** is the Tramme logo in a corner of the exported film. Basic: always there, no setting. Plus and Pro: on by default, a switch in the settings, and a hint on the first export saying it can be turned off. The same rule in the web app, the desktop app and the CLI.
- **Without an account**, Tramme follows Basic's rules (watermark included). The **desktop app and the CLI** keep the watermark until the desktop can sign in to an account (a later platform project); the site says so where it presents them (`/download/`, the pricing FAQ).
- **Euro everywhere**, in both languages.
- **A marketplace** (creators selling film templates and packs, Tramme taking a commission) is a revenue stream apart from the plans: listed on the roadmap, not on the pricing page.

## Roadmap

`/roadmap/` lists what is coming, from one data file, and only what is still ahead at launch (what ships before launch is simply part of the site; *my call*). First entries: the desktop app signed in to an account, the marketplace, and **Start from a reference**: drop a video, a gif, a Lottie or a URL, and the assistant rebuilds the animation as editable Tramme layers, then compares its copy with the original until they match. Inspired by [reanimate](https://github.com/NiazMorshed2007/reanimate) (MIT, a Claude Code skill: record, spec, build, verify, repeat); any code taken from it keeps its licence notice. The entry also goes into `docs/generation-roadmap.md` when it is implemented.

## The contract with the backend

The site depends on the platform at four points, fixed now so the site can be built first:

1. **The app's addresses**, in one place (`lib/links.ts`): sign-up (accepting `prompt` and `lang`, carried through sign-up into a new project whose prompt goes to the studio), log-in, the personal space, a public project in the app (`/p/<id>` opened for reuse).
2. **The shape of a public project**: `id`, `title`, `description`, `author` (`name`, `handle`, `avatar`), `video` (mp4 and webm), `poster`, `width`, `height`, `duration`, `reusable` (whether "Open in Tramme" copies its `.tramme`), `publishedAt`, `views`. The site reads them through one function (`lib/gallery.ts`), which today returns the repository's examples in this shape and later calls the gallery API. *My calls on the seed:* the examples (`examples/*/tramme.json`, plus the demo clips in `src/videos`) are credited to a "Tramme" author; no `views` are invented, so `/explore/` offers only the "recent" sort until real counts exist; the landing's community section shows as many cards as there are projects, up to eight (the seed has a handful, the live gallery will fill it).
3. **The plans**, as data in one file (`lib/plans.ts`): ids, prices per period in one currency, credits, what one credit buys in plain words (a figure set by the credits design; until then the FAQ's answer on credits reads it from here and stays general), and every row of the table above with its value per plan. The pricing page, the landing's closing line and the FAQ read it; the payment reads it later (or it moves to the backend and the site reads it from there).
4. **Rendering**: the site stays Astro and gains the Cloudflare adapter, so a page can be rendered on the server. Today every page is prerendered; `/explore/` and `/p/<id>/` switch to server rendering when the gallery API exists, without being rewritten.

A public project is a `.tramme` project, and the platform renders a video of it when it is published: the video is what the site shows, the `.tramme` is what "Open in Tramme" copies.

## Languages

- English at `/`, French at `/fr/`, with Astro's i18n routing (`defaultLocale: 'en'`, the default locale without prefix).
- Interface strings in catalogs `apps/site/src/i18n/en.json` and `fr.json`, the same format and rules as the editor's (`docs/i18n.md`): keys grouped by area, `en.json` the reference, a missing key falls back to English; a test checks both catalogs have the same keys. Long texts (terms, privacy, roadmap entries, FAQ answers, plan rows) are per-language data or content, not catalog keys, when that reads better.
- Each page carries `hreflang` alternates and its `lang`; the structured data (`lib/site.ts`) and `llms.txt` follow.
- No automatic redirect by the browser's language: the URL is the language. The links to the app carry `lang`.

## Constraints

- Theme tokens only (`theme.css`), both themes on every page, 360 px to wide screens, keyboard, the menus and the FAQ without script.
- No engine on the site; lazy videos; scripts only where a behaviour needs one (the theme choice; cards playing on hover may use a few lines or none, with `:hover` and a poster).
- DRY: one component per repeated section (`Head`, `Media`, `Shot`, `Tabs`, `Nav`, `Footer`, `Menu`, the FAQ, a project card shared by the landing, `/explore/` and `/p/<id>/`, a plan card); the components the new pages replace are removed, not left unused; the tests that describe the old landing (`test/landing.test.ts`) are rewritten to describe this one.
- Every claim on the site matches the platform as specified here; nothing contradicts the pricing data.
- The user keeps `npm run site` on 4321: checks run on `astro preview --port 4329` or a copy on 4331 (see the project memory), never on the user's server.
- Work on `develop`, no new branch; commits without any Claude attribution.
- **The live site does not change before launch.** The release workflow deploys the site after every release from `main` (`.github/workflows/desktop.yml`, job "Deploy the site", `npm run site:deploy`). That job is switched off at the start of this work, behind a repository variable (for instance `SITE_DEPLOY=on`), so releases go on and the site in production stays the one deployed last. It is switched back on at launch. *My call.*

## What was decided

- **By the user:** the Framer + Higgsfield hybrid (option C of the mockups), multi-page with pricing and FAQ off the landing; light first; language and theme in the footer; three plans Basic, Plus, Pro shown as available; Basic without AI; the welcome credit; projects public or private; a personal space; a gallery on the landing; the watermark as the Tramme logo, on by default and switchable in the settings; every paid feature proposed above; reanimate on a roadmap; the prices and credits of the table; Basic public-only with 3 cloud projects; euro everywhere; everyone's own AI key in every plan; use without an account under Basic's rules, and the watermark kept on the desktop and the CLI until the desktop can sign in; the site first, with the four-point contract, the backend right after; the site may stop being static; nothing deployed before the platform is finished.
- ***My call*, to correct on review:** the five landing sections and their order; the FAQ on the pricing page; `/explore/` and `/p/<id>/` on the site (server-rendered later) rather than in the app; the watermark rule per plan (Basic always, Plus and Pro switchable); English and French with `/fr/`; docs left in English; two theme options, no "system"; no language redirect; a `/roadmap/` page; `/terms/` drafted from the facts, with marked placeholders for the seller's identity and the merchant of record (Paddle or Lemon Squeezy, still undecided), and marked for legal review before launch; the footer's columns.

## Left to the builder

- The copy of every page, in both languages, within the facts above: plain, short sentences, a motion designer's words.
- Which videos and stills go where; placeholders (`Media`'s tints) until the clips exist.
- The look of the plan cards, the comparison table and the project cards, within the tokens and existing components.
- The order of the work, as long as the shared pieces (top bar, footer, i18n, data files) come first.

## Open

- What one credit buys (the credits design decides; see the contract, point 3).
- Whether every public project is reusable, or the author chooses "video only" or "reusable" (belongs to the gallery's design).
