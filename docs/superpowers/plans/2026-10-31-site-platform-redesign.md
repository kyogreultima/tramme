# The site for the platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-page site into the bilingual, multi-page site of the hosted platform (landing, explore, project pages, pricing, features, roadmap, terms, privacy), built on data files the backend will later replace.

**Architecture:** Astro in `apps/site`, pages shared by both languages through one optional `[...lang]` route segment (English without prefix, French under `/fr/`), interface strings in JSON catalogs read by `lib/i18n.ts`. Site data lives in `lib/`: `links.ts` (app addresses), `plans.ts`, `gallery.ts` (seed today, API later), `roadmap.ts`, `nav.ts`. One component per repeated piece. The Cloudflare adapter is added last of the structural work; every page stays prerendered.

**Tech Stack:** Astro 7, Starlight (docs untouched), `@astrojs/cloudflare`, Geist, Phosphor icons, vitest (`apps/site/test`), `puppeteer-core` for screenshots.

**Spec:** [docs/superpowers/specs/2026-10-31-site-platform-redesign-design.md](../specs/2026-10-31-site-platform-redesign-design.md). Supersedes the content of [2026-10-30-site-redesign.md](2026-10-30-site-redesign.md); code of the previous site is reused where the spec says so.

## Global Constraints

- Theme tokens only (`apps/site/src/styles/theme.css`); no gradient, glow, sparkle; no small labels above titles, step numbers, connector dashes, "New" pill.
- One grid: one container width, every section headed by `Head` (centred title and one sentence), same spacing between sections, one picture treatment. No tilt, floating pieces, lit-up sentence.
- Light first: `light` for every visitor; theme choice has two options (Light, Dark), no "system"; key `starlight-theme` shared with the docs.
- No engine on any page; videos load near the screen only (`Media.astro`); landing weight and Lighthouse not worse than the baseline of Task 0.
- No invented proof: no fake creators, counts (`views` unset in the seed), testimonials, logos. Seed projects credited to the author "Tramme".
- Euro everywhere, in both languages. Plans exactly as the spec's table (Basic free; Plus 12 € / 10 € yearly; Pro 35 € / 29 € yearly; 1 000 and 4 000 credits a month).
- English at `/`, French at `/fr/` (`defaultLocale: 'en'`); `/docs/` stays English; no automatic redirect by browser language; each page has `hreflang` alternates and its `lang`.
- Menus and FAQ work without script; the language choice is two plain links; the theme choice is the only script.
- DRY: components the new pages replace are removed; `test/landing.test.ts` is rewritten.
- Checks run on `astro preview --port 4329` (or a copy on 4331), never on the user's 4321/8787 servers.
- Work on `develop`, no new branch. Commit messages `feat(site): …`, with no Claude attribution trailer (project memory overrides the harness reminder).
- The live site is not deployed before launch: the release workflow's "Deploy the site" job is gated behind the repository variable `SITE_DEPLOY=on`.
- Never say "open source": the licence is FSL-1.1-ALv2, "source available".
- `/terms/` carries visible placeholders for the seller's identity and the merchant of record, marked "to be reviewed legally before launch".

## Review Focus

1. A gallery returning zero projects: landing community section and `/explore/` render an empty state, no broken grid (Task 5, 7).
2. A project with no poster or a missing French string: card shows a tint, text falls back to English (Task 1, 4).
3. 360 px phone: folded menu holds both buttons, no horizontal scroll, comparison table scrolls inside its own frame (Task 3, 6).
4. French pages: every internal link keeps `/fr/`, links to the app carry `lang`, language links point to the same page in the other language (Task 1, 3).
5. `__RELEASE__` null (offline build): download page still builds (Task 9).

---

### Task 0: Baseline and deploy switch

**Files:**
- Modify: `.github/workflows/desktop.yml` (job `site`)

- [ ] **Step 1:** `npm run site:build`, `npx astro preview --port 4329` from `apps/site` in the background. With a scratch puppeteer script in the scratchpad, load `/` at 1440×900 (`networkidle0`) in light and dark (`localStorage['starlight-theme']`), record request count and transferred bytes. Keep the four numbers for Task 12.
- [ ] **Step 2:** Add `if: vars.SITE_DEPLOY == 'on'` to the `site` job with a comment: the site is deployed at launch only; set the repository variable `SITE_DEPLOY=on` then. Check that no other job `needs: site`.
- [ ] **Step 3:** Commit `chore(ci): deploy the site only when SITE_DEPLOY is on`.

### Task 1: Languages

**Files:**
- Create: `apps/site/src/i18n/en.json`, `apps/site/src/i18n/fr.json`, `apps/site/src/lib/i18n.ts`
- Modify: `apps/site/astro.config.mjs` (`i18n: { defaultLocale: 'en', locales: ['en','fr'], routing: { prefixDefaultLocale: false } }`), `apps/site/src/layouts/Base.astro`
- Test: `apps/site/test/i18n.test.ts`

**Interfaces:**
- Produces in `lib/i18n.ts`:
  - `type Locale = 'en' | 'fr'`; `const LOCALES: Locale[]`
  - `localeOf(astroLocale: string | undefined): Locale`
  - `t(locale: Locale, key: string, vars?: Record<string, string | number>): string` (falls back to `en`, then to the key)
  - `pathIn(locale: Locale, path: string): string` (`pathIn('fr','/pricing/')` → `/fr/pricing/`; docs and external addresses unchanged; anchors kept)
  - `localePaths(): { params: { lang: string | undefined } }[]` for `getStaticPaths` of every `[...lang]` page
  - `type Localised<T> = Record<Locale, T>`; `pick<T>(locale: Locale, v: Localised<T>): T`
- Catalog groups to create now: `nav`, `footer`, `common` (log in, start for free, language and theme labels), others added by later tasks.
- `Base.astro` takes `locale: Locale` and `alternates` from the current path: sets `<html lang>`, `og:locale`, `<link rel="alternate" hreflang>` for `en`, `fr`, `x-default`.

- [ ] **Step 1:** Write `test/i18n.test.ts`: `it('has the same keys in both catalogs')` (flatten both, sets equal); `it('falls back to English for a missing key')` (`t('fr', 'nope.x')` returns the key; a key present only in en returns en text, using a stubbed catalog param or an exported `translate(catalogs, ...)` core); `it('prefixes French paths only')` with assertions: `pathIn('en','/pricing/')==='/pricing/'`, `pathIn('fr','/pricing/')==='/fr/pricing/'`, `pathIn('fr','/')==='/fr/'`, `pathIn('fr','/docs/')==='/docs/'`, `pathIn('fr','https://app.tramme.dev')==='https://app.tramme.dev'`, `pathIn('fr','/features/#studio')==='/fr/features/#studio'`.
- [ ] **Step 2:** Run `npx vitest run apps/site/test/i18n.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement `lib/i18n.ts` and the two catalogs (flat-group JSON as in `docs/i18n.md`); wire `astro.config.mjs` and `Base.astro`. Add a short "Site" paragraph to `docs/i18n.md` pointing at the site catalogs.
- [ ] **Step 4:** Run the test; expect PASS. `npm run site:build` still passes.
- [ ] **Step 5:** Commit `feat(site): languages, English and French`.

### Task 2: Data files

**Files:**
- Modify: `apps/site/src/lib/links.ts`
- Create: `apps/site/src/lib/plans.ts`, `apps/site/src/lib/gallery.ts`, `apps/site/src/lib/roadmap.ts`
- Modify: `apps/site/src/lib/faq.ts` (becomes per-locale, platform-true), delete the use of `lib/examples.ts` COPY where `gallery.ts` replaces it
- Test: `apps/site/test/links.test.ts` (extend), `apps/site/test/plans.test.ts`, `apps/site/test/gallery.test.ts`

**Interfaces:**
- `links.ts` adds: `signUp(opts?: { prompt?: string; lang?: Locale }): string` (`${APP}/signup?prompt=…&lang=…`), `logIn(lang?)` (`${APP}/login`), `space(lang?)` (`${APP}/space`), `appProject(id: string, lang?)` (`${APP}/p/${id}`). Query values URL-encoded; no `prompt` key when empty.
- `plans.ts`: `type PlanId = 'basic'|'plus'|'pro'`; `PLANS: { id; price: { month: number; year: number } /* euros per month, year = per month billed yearly */; credits: number | 0 }[]` with the spec's figures; `ROWS: { id: string; label: Localised<string>; values: Record<PlanId, boolean | Localised<string>> }[]` covering every row of the spec's table in order; `formatPrice(locale, euros)` → `12 €` / `12 €` with locale spacing, `free`/`gratuit` handled by `price === 0`. 
- `gallery.ts`: `interface PublicProject { id; title; description; author: { name; handle; avatar?: string }; video: { mp4: string; webm: string }; poster: string; width; height; duration; reusable: boolean; publishedAt: string; views?: number }`; `listProjects(opts?: { sort?: 'recent'|'popular'; limit?: number }): Promise<PublicProject[]>`; `getProject(id): Promise<PublicProject | undefined>`. Seed: the three examples (`launch-film`, `anime`, `showreel`) read from `examples/*/tramme.json` and `src/videos/*`, author `{ name: 'Tramme', handle: 'tramme' }`, `reusable: true`, `views` unset, `popular` sort falls back to recent while no view counts.
- `roadmap.ts`: `ROADMAP: { id; horizon: 'now'|'next'|'later'; title: Localised<string>; text: Localised<string> }[]` with the three first entries of the spec (desktop signed in, marketplace, start from a reference crediting reanimate, MIT).
- `faq.ts`: `faq(locale): Question[]`, answers consistent with the pricing (accounts exist, Basic free, own key everywhere, welcome credit, watermark, offline, data, desktop/CLI watermark until sign-in), reading numbers from `plans.ts`.

- [ ] **Step 1:** Tests: `plans.test.ts` — `it('prices follow the spec')` (plus 12/10, pro 35/29, basic 0), `it('has a value for every plan in every row')`, `it('has both languages for every label')`; `gallery.test.ts` — `it('lists the seed projects, most recent first')`, `it('honours limit')`, `it('returns undefined for an unknown id')`, `it('invents no view count')` (`views` undefined for every seed); `links.test.ts` — `signUp({prompt:'a launch film', lang:'fr'})` equals `${APP}/signup?prompt=a%20launch%20film&lang=fr`; `signUp()` has no `prompt`.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Implement the five modules as specified. Poster for the seed: the existing `.webp` next to each video.
- [ ] **Step 4:** Run `npx vitest run apps/site`; expect all PASS (existing `faq.test.ts`/`examples.test.ts` adapted to the new signatures).
- [ ] **Step 5:** Commit `feat(site): plans, gallery, roadmap and links as data`.

### Task 3: Top bar, footer, theme and language choices

**Files:**
- Modify: `apps/site/src/lib/nav.ts`, `src/components/Nav.astro`, `src/components/Menu.astro`, `src/components/Footer.astro`
- Create: `src/components/ThemeChoice.astro`, `src/components/LanguageChoice.astro`
- Keep `ThemeToggle.astro` for the docs only (Starlight `ThemeSelect`).
- Test: `apps/site/test/nav.test.ts` (extend)

**Interfaces:**
- `nav.ts` exports locale-aware: `menus(locale)`, `barLinks(locale)`, `footerColumns(locale)` returning `NavMenu[]`/`NavLink[]` with labels from the catalog (`nav.*`, `footer.*` keys). Bar: menus Product, Features; links Explore `/explore/`, Pricing `/pricing/`, Docs; buttons Log in (`logIn(lang)`, ghost), Start for free (`signUp({lang})`, primary). Footer columns: Product, Community, Resources (docs, changelog, roadmap, pricing), Company (about, terms, privacy, security, licence, repository).
- `ThemeChoice.astro`: two buttons Light/Dark (`aria-pressed`), writes `starlight-theme`, no "system".
- `LanguageChoice.astro` props `{ locale: Locale; path: string }`: two links to the same page in each language, current one `aria-current`.
- `Nav`/`Footer` props `{ locale: Locale; path: string }`. Under 960 px everything, buttons included, folds into one menu.

- [ ] **Step 1:** Extend `nav.test.ts`: for each locale, every internal link resolves to an existing page file (`src/pages/**/<name>.astro`, including `[...lang]/`) or a docs address; fragments exist as `id=` in `src/components/*.astro` or `src/views/*.astro`; the French links all begin `/fr/` except docs; `it('has no script in the bar or the menus')` (Nav and Menu sources contain no `<script`); `it('the theme choice offers exactly light and dark')`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement. Footer bottom row: copyright left, `LanguageChoice` + `ThemeChoice` right. Remove the theme toggle and repository link from the bar.
- [ ] **Step 4:** Run the tests; PASS. Screenshot check at 360 and 1440 px in both themes on the preview 4329.
- [ ] **Step 5:** Commit `feat(site): top bar and footer for the platform`.

### Task 4: Shared components

**Files:**
- Create: `src/components/ProjectCard.astro`, `src/components/PlanCard.astro`, `src/components/PlanTable.astro`, `src/components/Page.astro` (layout wrapper: `Base` + `Nav` + `<main>` + `Footer`, props `{ locale; path; title; description }`)
- Modify: `src/components/Faq.astro` (props `{ locale }`), `Head.astro` if needed
- Test: `apps/site/test/components.test.ts`

**Interfaces:**
- `ProjectCard` props `{ project: PublicProject; locale: Locale }`: link to `pathIn(locale,'/p/'+id+'/')`, poster (a `Media` slot, video on `:hover`/`:focus-visible`, no script), title, author initial avatar and name. Used by landing, `/explore/`, `/p/<id>/`.
- `PlanCard` props `{ planId; period: 'month'|'year'; locale }`; `PlanTable` props `{ locale }` reading `ROWS`; wrapped in a scroll frame at narrow widths.
- Monthly/yearly switch is two radio inputs and CSS (no script), shared by cards.

- [ ] **Step 1:** Test: components sources contain no `<script`; every `*.astro` of `src/components` and `src/views` that is not imported anywhere is reported (`it('leaves no component unused')`, excluding Starlight overrides in `docs/` and `ThemeToggle`).
- [ ] **Step 2:** Run; FAIL (unused old components still present until Task 5).
- [ ] **Step 3:** Implement the components within tokens and existing `Head`/`Media`/`Shot`.
- [ ] **Step 4:** Leave the unused test failing only for old landing components, resolved in Task 5; run the other assertions green.
- [ ] **Step 5:** Commit `feat(site): project card, plan card and plan table`.

### Task 5: The landing

**Files:**
- Create: `src/pages/[...lang]/index.astro` (replaces `pages/index.astro`), `src/components/Hero.astro` (rewritten), `src/components/Community.astro`, `src/components/Bento.astro`, `src/components/Closing.astro` (rewritten)
- Modify: `Tabs.astro` (locale, pillars Studio/Atelier/Assistant/Export)
- Delete: `Made.astro`, `Cards.astro`, `ExampleTile.astro` and any other component left unused
- Test: `apps/site/test/landing.test.ts` (rewritten)

**Interfaces:**
- Page sections in order: `Hero`, `Tabs`, `Community`, `Bento`, `Closing` (all with `{ locale }`).
- Hero: `<form method="get" action={signUp().split('?')[0]}>` with a `prompt` textarea/input, hidden `lang`, send button; three or four idea links each `signUp({ prompt, lang })`; a line saying the first film is offered (`hero.firstFilm`); the demo video below via `Media`. No script.
- Community: `listProjects({ limit: 8 })` cards, link to `/explore/`; an empty list renders only the link and a sentence.
- Bento: tiles projects on every device, public or private, cloud export to 4K, transcription and subtitles, voice-over, packs; each links to `/features/`.
- Closing: "Your next film starts with a sentence" (catalog), primary button `signUp`, quiet line "Basic is free — see the plans" to `/pricing/`.

- [ ] **Step 1:** Rewrite `landing.test.ts`: `it('has five sections: hero, pillars, community, platform, closing')` (parse `<main>` of the page as the old test did); one width (no `wrap-wide`); tabs without script; every section but the hero takes its heading from `Head`; `it('sends the hero field to the sign-up address without script')` (Hero source has `<form`, `method="get"`, the `signUp` import, no `<script`); `it('has no invented figure')` (no `testimonial`, no digit-with-"users"/"creators" pattern in the catalogs' landing group).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement; delete replaced components; give `index` the structured data via Task 11's function later (keep the current call until then).
- [ ] **Step 4:** Run `npx vitest run apps/site`; PASS including the unused-component test.
- [ ] **Step 5:** Commit `feat(site): the platform landing page`.

### Task 6: Pricing

**Files:**
- Create: `src/pages/[...lang]/pricing.astro` (replaces `pages/pricing.astro`)
- Test: `apps/site/test/pricing.test.ts`

**Interfaces:** page = `Head`, the period switch, three `PlanCard`s, `PlanTable`, FAQ (billing, credits, cancelling, watermark, first film, data, offline) via `faq(locale)` filtered by a `topic` field added in Task 2.

- [ ] **Step 1:** Test builds nothing: it checks the page source uses `PLANS`/`PlanCard`/`PlanTable`/`Faq`, contains no price literal (`/\d+ ?€/`), and that the FAQ's answers mention no number differing from `plans.ts` (credits figures 1 000 / 4 000 only via the data).
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** PASS; screenshot both locales and themes.
- [ ] **Step 5:** Commit `feat(site): pricing page`.

### Task 7: Explore and project pages

**Files:**
- Create: `src/pages/[...lang]/explore.astro`, `src/pages/[...lang]/p/[id].astro`
- Modify: `src/pages/examples.astro` → redirect to `/explore/` (Astro `redirects` in config, delete the page)
- Test: `apps/site/test/explore.test.ts`

**Interfaces:** `/explore/`: all projects from `listProjects()` in a grid, only the "recent" sort offered; empty state. `/p/<id>/`: `getStaticPaths` from `listProjects()` × locales; large video, title, author, description, author's other projects, "Open in Tramme" → `appProject(id, lang)` shown when `reusable`. Unknown id impossible at build.

- [ ] **Step 1:** Test: pages import `listProjects`/`getProject` from `lib/gallery`; neither page reads `examples/` directly; config redirects `/examples` to `/explore/`; `/p/[id].astro` exports `getStaticPaths` covering both locales.
- [ ] **Step 2–4:** Run FAIL, implement, PASS; build and open `/p/launch-film/` and `/fr/explore/` in the preview.
- [ ] **Step 5:** Commit `feat(site): explore the community and public project pages`.

### Task 8: Features

**Files:**
- Modify/move: `src/pages/features.astro` → `src/pages/[...lang]/features.astro`; `lib/features.ts` per locale, rewritten for Studio, Atelier, Assistant, Export and the cloud services; section components made locale-aware (`Studio`, `Editor`, `Assistant`, `Packs`, `Inside`, `Render`), ids kept so menu fragments resolve.
- Test: `nav.test.ts` fragment check covers it.

- [ ] **Step 1:** Add to `nav.test.ts` an assertion that every `#fragment` in menus exists in the features view in both locales. FAIL until moved.
- [ ] **Step 2:** Implement with French copy. **Step 3:** run `npx vitest run apps/site`; PASS.
- [ ] **Step 4:** Commit `feat(site): features page for the platform`.

### Task 9: Download, About, Roadmap, Terms, Privacy

**Files:**
- Move to `src/pages/[...lang]/`: `download.astro`, `about.astro`, `privacy.astro`; create `roadmap.astro`, `terms.astro`
- Test: `apps/site/test/pages.test.ts`

**Interfaces:** roadmap groups `ROADMAP` by horizon (now, next, later); download says the desktop app and CLI keep the watermark until the desktop can sign in; terms has marked placeholders `[SELLER IDENTITY]`, `[MERCHANT OF RECORD: Paddle or Lemon Squeezy, to be decided]` and a visible "to be reviewed legally before launch" note; privacy rewritten for accounts and the cloud.

- [ ] **Step 1:** Test: every page under `pages/[...lang]/` uses the `Page` wrapper and `getStaticPaths = localePaths`; terms source contains both placeholders; roadmap page renders from `ROADMAP` only; no page contains "open source" (case-insensitive) in sources or catalogs.
- [ ] **Step 2–4:** FAIL, implement (French copy included), PASS; check download builds with `__RELEASE__` null.
- [ ] **Step 5:** Commit `feat(site): roadmap, terms and privacy, download and about in both languages`.

### Task 10: Cloudflare adapter

**Files:**
- Modify: `apps/site/package.json` (`@astrojs/cloudflare`), `apps/site/astro.config.mjs`, `apps/site/wrangler.jsonc`, root `package.json` script `site:deploy` if the output folder changes, `docs/deploy.md` if it describes the site

- [ ] **Step 1:** `npm i -w apps/site @astrojs/cloudflare`; set `adapter: cloudflare()` with `output: 'static'` (all pages prerendered); update `wrangler.jsonc` to the adapter's output; comment in `explore.astro` and `p/[id].astro` how to switch to `export const prerender = false` once the gallery API exists.
- [ ] **Step 2:** `npm run site:build` passes and `npx wrangler deploy --dry-run -c apps/site/wrangler.jsonc` accepts the output. If the adapter cannot build with Starlight, report the exact error, keep the static build, and record it in the task's commit message.
- [ ] **Step 3:** Commit `feat(site): Cloudflare adapter, pages still prerendered`.

### Task 11: Search engines and docs

**Files:**
- Modify: `lib/site.ts` (`landingData(site, preview, systems, locale)` with `inLanguage`, `offers` for the three plans from `plans.ts`), `pages/llms.txt.ts`, `pages/robots.txt.ts`, `astro.config.mjs` sitemap i18n; `README`/docs mentions of the site; `docs/i18n.md`
- Test: `apps/site/test/site.test.ts`

- [ ] **Step 1:** Test: `landingData` offers match `PLANS` prices; `inLanguage` follows the locale; `llms.txt` lists `/explore/`, `/pricing/`, `/roadmap/`.
- [ ] **Step 2–4:** FAIL, implement, PASS. Add the "Start from a reference" entry to `docs/generation-roadmap.md` only when implemented (not now).
- [ ] **Step 5:** Commit `feat(site): structured data, llms.txt and sitemap for both languages`.

### Task 12: Verification

- [ ] **Step 1:** `npx vitest run` (whole repo) and `npx tsc --noEmit -p apps/site` (or the repo's check script); all green.
- [ ] **Step 2:** `npm run site:build`; preview on 4329; with puppeteer, for `/`, `/fr/`, `/explore/`, `/p/launch-film/`, `/pricing/`, `/fr/pricing/`, `/features/`, `/roadmap/`, `/download/`, `/terms/`: both themes, 360 and 1440 px, no horizontal scroll, no console error; screenshots reviewed. Re-measure the landing as in Task 0: requests and bytes not worse.
- [ ] **Step 3:** Confirm menus and FAQ open with JavaScript disabled (built HTML has `<details>`, no script besides the theme choice).
- [ ] **Step 4:** Fix whatever the checks show; commit `fix(site): …` per fix. Remove nothing the docs depend on.
