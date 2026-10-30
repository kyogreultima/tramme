# Site redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-page site into a multi-page site (menus, features, examples, pricing, about, privacy, changelog, columned footer) with a reshaped landing page, in the app's own theme.

**Architecture:** Static Astro (`apps/site`), as today. Site-wide data (menus, features, FAQ, tool groups) lives in small `lib/` modules that the top bar, the footer, the landing page and the pages all read, so a link or a question is written once. The landing page's detailed sections (Studio, Editor, Assistant, Packs, Inside, Render) become the `/features/` page unchanged; the landing page gets compact pillars. The changelog is one more Starlight docs page made from `CHANGELOG.md` (served at `/docs/changelog/`).

**Tech Stack:** Astro 7, Starlight, Geist, Phosphor icons, `sharp`, vitest (`apps/site/test`, picked up by the root `vitest.config.ts`), `puppeteer-core` (already in `node_modules`) with Chrome for screenshots.

**Spec:** [docs/superpowers/specs/2026-10-30-site-redesign-design.md](../specs/2026-10-30-site-redesign-design.md). One change to it, decided while planning: the changelog is served at `/docs/changelog/` (a docs page, no new rendering code), not `/changelog/`.

## Global Constraints

- Tokens only, from `apps/site/src/styles/theme.css`: no colour, font or shape of the site's own. Geist, weights and sizes for hierarchy; display type may reach about 7 rem (`clamp`), never condensed, never all capitals.
- Shapes as the app's: 20 px surfaces (`--r-lg`), 14 px pictures (`--r`), pill buttons.
- Forbidden: gradients, glows, sparkles, small labels above titles, step numbers, connector dashes, the same layout for every section.
- No invented proof: no testimonials, download counts, ratings or partner logos. Counts come from the code at build time.
- English only; `<html lang="en">` as in `layouts/Base.astro`.
- No script for the look; menus and the FAQ work without JavaScript (`<details>`/popover); reveals stay scroll-driven CSS (`data-reveal`).
- The landing page runs no engine; videos and large pictures lazy. Its transfer size and request count at load are not worse than the baseline of Task 0.
- DRY: reuse `Head`, `Cards`, `Shot`, `Media`, `AppLink`, `DownloadLink`, `Nav`, `Footer`; delete a section component the redesign replaces; nothing left unused.
- Both themes (`:root[data-theme='dark']`), a 360 px phone to a wide screen, keyboard operable, `prefers-reduced-motion` respected.
- Claims on a page are checked against the code or the docs. Accounts, credits and subscriptions are a design under review ([accounts spec](../specs/2026-10-28-accounts-and-cloud-storage-design.md)): no page announces them.
- Commits: no Claude attribution trailer. Messages in the repo's style (`feat(site): …`).

## Review Focus

1. JavaScript disabled: the top bar's menus and the FAQ still open and close (Task 3, Task 6 check the built HTML uses `<details>` and no script for them).
2. A 360 px phone: the folded menu opens, every link is reachable, the page has no horizontal scroll (Tasks 3, 11).
3. No release found (`__RELEASE__` is `null`, e.g. offline build): download buttons and the platforms fact disappear, every page still builds (Tasks 5, 11).
4. A menu link to `/features/#studio` lands under the sticky bar without hiding the heading; a link to a page or a docs slug that does not exist is caught by a test (Tasks 1, 8).
5. Light theme contrast of the quiet text (`--ink-3`) on surfaces in the new sections, and reduced motion on the manifesto (Tasks 4, 11).

---

### Task 0: Baseline of the landing page

**Files:** none changed. The numbers go in the Task 5 and Task 11 commit messages.

- [ ] **Step 1:** `npm run site:build`, then `npx astro preview --port 4399` from `apps/site` in the background.
- [ ] **Step 2:** With a scratch script (in the scratchpad, `puppeteer-core` imported by its absolute file URL, Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`), load `http://localhost:4399/` at 1440×900, wait for `networkidle0`, and record the number of requests and the total transferred bytes (sum of `response.headers()['content-length']` or the CDP `Network.loadingFinished` `encodedDataLength`). Do it once with `starlight-theme=light` and once with `dark` in `localStorage`. Write both pairs of numbers down.
- [ ] **Step 3:** Stop the preview server. No commit.

### Task 1: The site map as data

**Files:**
- Create: `apps/site/src/lib/nav.ts`
- Test: `apps/site/test/nav.test.ts`

**Interfaces:**
- Produces:
  - `interface NavLink { label: string; href: string; hint?: string }`
  - `interface NavMenu { id: string; label: string; links: NavLink[] }`
  - `export const MENUS: NavMenu[]`: `product` (Open the app → `APP`, Download → `/download/`, The assistant → `/features/#assistant`) and `features` (Studio `/features/#studio`, Atelier `/features/#editor`, Assistant `/features/#assistant`, Packs `/features/#packs`, Export `/features/#render`), each link with a one-line `hint`.
  - `export const BAR_LINKS: NavLink[]`: Examples `/examples/`, Docs `docHref('')`, Pricing `/pricing/`.
  - `export const FOOTER: NavMenu[]`: Product, Features (the two menus above), Resources (Docs, Changelog `docHref('changelog')`, Examples, Pricing), Project (About `/about/`, Repository `REPO`, Licence `repoFile('LICENSE')`, Privacy `/privacy/`, Security `repoFile('SECURITY.md')`).
- Consumes: `APP`, `REPO`, `repoFile` from `lib/links.ts`; `docHref` from `lib/docs.ts`.

- [ ] **Step 1: Write the failing test** `apps/site/test/nav.test.ts` with `it('every internal link leads to a page that exists')`: for each link of `MENUS`, `BAR_LINKS`, `FOOTER` that does not start with `https://`, split at `#`; the path must be `/`, or `/<name>/` with a `src/pages/<name>.astro` file, or a docs address (`/docs/…/`) equal to `docHref(p.slug)` of some `PAGES` entry of `lib/docs.ts`; a fragment must appear as `id="<fragment>"` in some file of `src/components/*.astro`. Add `it('has no two links of one menu to the same place')`. Read files with `node:fs` relative to `import.meta.dirname`.
- [ ] **Step 2:** `npx vitest run apps/site` → FAIL (`nav.ts` missing).
- [ ] **Step 3:** Implement `lib/nav.ts` with the interfaces above. Add to `lib/docs.ts` a page `{ slug: 'changelog', label: 'Changelog', file: 'CHANGELOG.md' }` in a new sidebar group `Project` placed after `Reference`, so `docHref('changelog')` exists.
- [ ] **Step 4:** The test still fails on pages that Tasks 5–9 create. Mark those links' targets as expected-missing in the test through a constant `PENDING = ['/features/', '/examples/', '/pricing/', '/about/', '/privacy/']` that each later task removes its page from; the test passes now.
- [ ] **Step 5:** `npm run site:build` and open `/docs/changelog/` in the preview: it renders (title "Changelog", links rewritten).
- [ ] **Step 6: Commit** `feat(site): the site map as data, and the changelog as a docs page`.

### Task 2: Type scale, page chrome and the brand's variables

**Files:**
- Modify: `apps/site/src/styles/global.css` (display scale, `.prose`), `apps/site/src/components/Brand.astro`
- Create: `apps/site/src/components/PageHead.astro`

**Interfaces:**
- Produces:
  - `PageHead.astro` props `{ title: string; lead?: string }`: a page's `<h1>` (up to 4.5 rem `clamp`) and a quiet lead sentence, in a `.wrap`, top padding as the hero's.
  - global classes `.display` (the hero/manifesto size: `clamp(2.75rem, 7.4vw, 7rem)`, weight 600, letter-spacing as `h1`) and `.prose` (a readable column, 68ch, headings, lists, links in `--accent-text`) for the text pages.
  - `Brand.astro` reads `--brand-ink` (default `var(--ink)`) and `--brand-mark` (default `var(--accent)`) so a parent can recolour it.

- [ ] **Step 1:** Add the CSS to `global.css`; keep it in the file's voice (short comments, tokens only).
- [ ] **Step 2:** Write `PageHead.astro` and change `Brand.astro`'s two fill rules to the variables.
- [ ] **Step 3:** `npm run site:build` passes; the landing page and the docs look unchanged (compare with a screenshot of the top bar in both themes).
- [ ] **Step 4: Commit** `feat(site): a display size, a page header and a text style`.

### Task 3: The top bar with menus, the footer in columns

**Files:**
- Modify: `apps/site/src/components/Nav.astro`, `apps/site/src/components/Footer.astro`
- Create: `apps/site/src/components/Menu.astro`

**Interfaces:**
- Produces: `Menu.astro` props `{ menu: NavMenu }`: a `<details class="menu">` whose `<summary>` is the label with a caret and whose panel (a 20 px surface under the pill, one link per line with its `hint` beneath in `--ink-3`) lists `menu.links`; closes on Escape and when a link inside is followed (the only script allowed: a few lines, `<script>` in `Menu.astro`, optional enhancement; the menu works without it).
- Consumes: `MENUS`, `BAR_LINKS`, `FOOTER` from Task 1; `PageHead` not needed.

- [ ] **Step 1:** `Nav.astro`: pill as today; links are the `MENUS` as `<Menu>`s, then `BAR_LINKS` as plain links, then the theme toggle, `RepoLink` and `AppLink`. Under 960 px the bar shows the brand, the toggle, `AppLink` and one `<details>` "Menu" holding all links, grouped by menu label.
- [ ] **Step 2:** `Footer.astro`: the `FOOTER` columns (a `<nav aria-label="Footer">`, one `<h2>`-less column per menu with its label as a `<strong>`), the "© 2026 Aziz Chanou" line, and above them the giant wordmark: `<div class="mark"><Brand /></div>` with `font-size: clamp(5rem, 22vw, 20rem)`, `--brand-ink: var(--ink-3)`, `aria-hidden` (the page already names the product), clipped at the bottom edge like a signature. Columns collapse to two, then one.
- [ ] **Step 3:** Build; check in Chrome headless at 1440 and 360 px, light and dark: the menus open by click and by keyboard (Tab to the summary, Enter, Tab through links, Escape), the wordmark does not overflow horizontally.
- [ ] **Step 4:** Check the built `index.html` contains `<details` for the menus and that no `<script>` other than the theme and platform ones and `Menu`'s is on the page.
- [ ] **Step 5: Commit** `feat(site): menus in the top bar and a footer in columns`.

### Task 4: Hero and manifesto

**Files:**
- Modify: `apps/site/src/components/Hero.astro`
- Create: `apps/site/src/components/Manifesto.astro`

**Interfaces:**
- Produces: `Manifesto.astro` (no props): one sentence in `.display`, with three small rounded stills (`<Image>` from `src/videos/{anime,showreel,launch-film}.webp`, lazy, `alt=""`, 14 px radius, inline-block, height `0.85em`) set between its words; each word group fades up in turn with scroll-driven CSS (`data-reveal` rules), still under reduced motion.

- [ ] **Step 1:** `Hero.astro`: keep the headline and the app picture (`Media id="tramme"` in the tilted stage). Enlarge `h1` to the `.display` size; the line under the buttons reads "Free and open source. No account." (true today); keep the news pill.
- [ ] **Step 2:** `Manifesto.astro`: write the sentence in the site's voice (notes on the film, takes kept, every keyframe in the atelier). The sentence must read correctly with the stills removed (they are decoration with empty `alt`).
- [ ] **Step 3:** Check both in both themes at 1440 and 360 px; with `prefers-reduced-motion: reduce` emulated, everything is visible without animation.
- [ ] **Step 4: Commit** `feat(site): a larger hero and a manifesto sentence`.

### Task 5: The pillars, tools by category and the facts

**Files:**
- Create: `apps/site/src/lib/features.ts`, `apps/site/src/lib/tools.ts`, `apps/site/src/components/Pillars.astro`, `apps/site/src/components/Tools.astro`
- Modify: `apps/site/src/components/Shot.astro` (a `flat` prop), `apps/site/src/components/OpenSource.astro`
- Delete: `apps/site/src/components/Steps.astro` (its tool chips move to `Tools.astro`; its three steps are replaced by the pillars)

**Interfaces:**
- Produces:
  - `lib/features.ts`: `export interface Feature { id: 'studio' | 'editor' | 'assistant' | 'packs' | 'render'; name: string; line: string; doc: string; picture: { shot: [ImageMetadata, ImageMetadata] } | { still: ImageMetadata } }` and `export const FEATURES: Feature[]` (ids match the section ids of the existing components; `doc` is a docs slug; shots from `src/assets/studio-*.png`, `editor-*.png`; stills from `src/videos/assistant.webp`, `showreel.webp`, `launch-film.webp`).
  - `lib/tools.ts`: `export const TOOL_GROUPS: { name: string; doc: string; tools: string[] }[]`: the twenty chips of `Steps.astro`, regrouped (type and captions; shapes and strokes; camera and depth; effects and colour; sound; export), each group's `doc` a real docs slug.
  - `Pillars.astro`: the five `FEATURES` as a two-column rhythm (a `Shot flat` or a still beside its name, line and "Read more" link to `/features/#<id>`), alternating sides; the one for the studio as a full-width picture with a `part-composer` image floating over it (reuse `Shot`'s `parts`). Not five identical cards.
  - `Tools.astro`: `TOOL_GROUPS` as surfaces with their chips and a link to the docs.
- `OpenSource.astro` keeps its code-counted stats and gains: the licence, the interface languages ("English and French", from `docs/i18n.md`), and the platforms of the latest release (`__RELEASE__`, hidden when `null`).

- [ ] **Step 1:** Write `lib/features.ts`, `lib/tools.ts` (verify each slug with `docHref` against `PAGES`).
- [ ] **Step 2:** Add `flat` to `Shot.astro` (no tilt, no scroll animation, no parts); implement `Pillars.astro` and `Tools.astro`.
- [ ] **Step 3:** Extend `OpenSource.astro`; with `__RELEASE__` forced to `null` (edit locally, do not commit) the page still builds and the platforms line is absent.
- [ ] **Step 4:** Delete `Steps.astro` and its import.
- [ ] **Step 5:** Check in both themes at 1440 and 360 px. Repeat the Task 0 measurement once the landing is assembled in Task 6; do not commit numbers yet.
- [ ] **Step 6: Commit** `feat(site): the pillars, the tools by category and the facts`.

### Task 6: The FAQ and the new landing page

**Files:**
- Create: `apps/site/src/lib/faq.ts`, `apps/site/src/components/Faq.astro`
- Modify: `apps/site/src/pages/index.astro`, `apps/site/src/lib/site.ts`, `apps/site/src/components/Closing.astro` (only if the footer's wordmark needs room)
- Test: `apps/site/test/faq.test.ts`

**Interfaces:**
- Produces:
  - `lib/faq.ts`: `export interface Question { q: string; a: string }` and `export const FAQ: Question[]` (plain text answers, no markup).
  - `Faq.astro` (no props): `FAQ` as `<details>` rows on surfaces with a rotating caret, in a `.wrap`, a `Head` above.
  - `lib/site.ts`: `landingData` adds `{ '@type': 'FAQPage', mainEntity: FAQ.map(...) }` to its `@graph`.
- Consumes: `FAQ`.

- [ ] **Step 1: Write the failing test** `faq.test.ts`: `landingData(new URL('https://tramme.dev'), '/og.jpg', [])['@graph']` contains a `FAQPage` whose `mainEntity` has one `Question` per `FAQ` entry with `acceptedAnswer.text` equal to `a`; every `FAQ` entry has a non-empty `q` ending in `?`.
- [ ] **Step 2:** `npx vitest run apps/site` → FAIL.
- [ ] **Step 3:** Write `lib/faq.ts` with real questions, each answer checked against the README, `docs/deploy.md` or the code: free and open source (Apache-2.0); in the browser and on the desktop; offline (desktop app; the installed web app, personal mode); where projects live; which export formats (`FORMATS`); which AI and whose keys; adding your own effects (plugins, `docs/packs.md`); which systems (`SYSTEMS`).
- [ ] **Step 4:** Update `landingData`; the test passes.
- [ ] **Step 5:** `Faq.astro`; `index.astro` order: `Hero`, `Manifesto`, `Pillars`, `Tools`, `Made`, `OpenSource`, `Faq`, `Closing`. Remove the section imports the landing no longer uses (they stay on `/features/`, Task 8).
- [ ] **Step 6:** Build; the built `index.html` has the FAQ as `<details>` and a `FAQPage` JSON-LD. Re-run the Task 0 measurement on the new `/`, in both themes: the transfer size and the request count are not above the baseline (the stills are lazy). If they are, find the cause (an eager image) and fix it before committing.
- [ ] **Step 7: Commit** `feat(site): a FAQ and the reshaped landing page`, with the before/after numbers in the body.

### Task 7: The examples gallery

**Files:**
- Modify: `apps/site/src/lib/examples.ts`, `apps/site/src/components/Made.astro`
- Create: `apps/site/src/components/ExampleTile.astro`, `apps/site/src/pages/examples.astro`

**Interfaces:**
- Produces:
  - `lib/examples.ts` gains `export const COPY: Record<string, { tint: [string, string]; text: string }>` (the `TILES` data now in `Made.astro`, moved) and an `ids` order `['launch-film', 'anime', 'showreel']`.
  - `ExampleTile.astro` props `{ id: string; wide?: boolean; link?: boolean }`: the figure of `Made.astro` (a `Media` and its caption); with `link` the caption ends with "Take it apart" linking to `repoFile('examples/<id>')`.
- `Made.astro` uses `ExampleTile`; the page uses it too, larger, one per row, with a `PageHead` ("Made with Tramme", a lead).

- [ ] **Step 1:** Move the data, write `ExampleTile.astro`, rewrite `Made.astro` on it (no visible change on the landing page).
- [ ] **Step 2:** `pages/examples.astro` with `Base`, `Nav`, `PageHead`, the tiles with `link`, `Footer`; remove `/examples/` from `PENDING` in `nav.test.ts`.
- [ ] **Step 3:** `npx vitest run apps/site` passes; build; check the page in both themes at 1440 and 360 px.
- [ ] **Step 4: Commit** `feat(site): the examples gallery`.

### Task 8: The features page

**Files:**
- Create: `apps/site/src/pages/features.astro`
- Modify: `apps/site/test/nav.test.ts` (`PENDING`)

- [ ] **Step 1:** `features.astro`: `Base`, `Nav`, `PageHead` ("Everything in the app", a lead), then the existing `Studio`, `Editor`, `Assistant`, `Packs`, `Inside`, `Render` section components in that order, a `Closing`, `Footer`. The sections keep their ids (`studio`, `editor`, `assistant`, `packs`, `inside`, `render`).
- [ ] **Step 2:** Remove `/features/` from `PENDING`; `npx vitest run apps/site` passes (the menu fragments now exist).
- [ ] **Step 3:** Build; at 1440 px click each menu link of "Features": the heading is not hidden by the sticky bar. Check both themes.
- [ ] **Step 4: Commit** `feat(site): the features page`.

### Task 9: Pricing, about and privacy

**Files:**
- Create: `apps/site/src/pages/pricing.astro`, `apps/site/src/pages/about.astro`, `apps/site/src/pages/privacy.astro`
- Modify: `apps/site/test/nav.test.ts` (`PENDING` emptied)

- [ ] **Step 1:** Read `README.md` (Deploying, The assistant, Known limits), `docs/deploy.md`, `docs/desktop-and-mobile-apps.md`, `SECURITY.md`, `CONTRIBUTING.md` and the site's own code for anything that collects data (there is no analytics today).
- [ ] **Step 2:** `pricing.astro` (`PageHead` + `.prose`): the app is free and open source (Apache-2.0), in the browser and on the desktop; what can cost money is the AI providers' usage, billed by them to the visitor's own keys; nothing else. Two buttons: open the app, download. No tiers, no accounts, no credits.
- [ ] **Step 3:** `about.astro`: what Tramme is (the README's first paragraph in plain words), the licence, how to contribute (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`), the repository, security reporting, the author's name as in the footer.
- [ ] **Step 4:** `privacy.astro`: what is kept where (browser storage in personal mode, a folder on the computer on the desktop, provider keys in the key vault or the system keychain), that provider requests go from the browser or the app to the provider the visitor chose, and what the site collects (state exactly what the code shows; if anything is uncertain, write only what is verified and list the open point in the final report).
- [ ] **Step 5:** `PENDING` is empty; `npx vitest run apps/site` passes; add the new pages to `src/pages/llms.txt.ts`'s list. Build and check the three pages in both themes at 1440 and 360 px.
- [ ] **Step 6: Commit** `feat(site): pricing, about and privacy`.

### Task 10: The download page and the docs under the new chrome

**Files:**
- Modify: `apps/site/src/pages/download.astro` (only if the new bar or footer breaks it), `apps/site/src/styles/docs.css` (only if needed)

- [ ] **Step 1:** Check `/download/` and `/docs/` (and `/docs/changelog/`) in both themes at 1440 and 360 px with the new `Nav` and `Footer`; the docs keep Starlight's own header.
- [ ] **Step 2:** Fix only what is visibly wrong (spacing under the wordmark, a heading size on `/download/`); use `PageHead` on `/download/` if its `h1` no longer matches the other pages.
- [ ] **Step 3: Commit** `fix(site): the download page and the docs under the new top bar and footer` (skip if nothing changed).

### Task 11: Verification of the whole

**Files:** none, unless a defect is found; fixes are commits on the task that owns the code.

- [ ] **Step 1:** `npm run typecheck`, `npx vitest run apps/site`, `npm run site:build` pass with no warning from the site.
- [ ] **Step 2:** Screenshots, light and dark, at 1440 and 360 px, of `/`, `/features/`, `/examples/`, `/pricing/`, `/about/`, `/privacy/`, `/download/`, `/docs/`, `/docs/changelog/`; read each. Horizontal scroll check at 360 px (`document.documentElement.scrollWidth <= innerWidth` on every page).
- [ ] **Step 3:** Keyboard pass on `/` (menus, FAQ, buttons) and a pass with JavaScript disabled (`page.setJavaScriptEnabled(false)`): menus and FAQ still open.
- [ ] **Step 4:** Contrast: in the light theme, the lowest-contrast text of each new section (`--ink-3` on `--panel`) is at least 4.5:1 (compute from the token values).
- [ ] **Step 5:** Re-run Task 0's measurement; the final numbers are not above the baseline.
- [ ] **Step 6:** `sitemap-0.xml` lists the new pages; `/robots.txt` and `/llms.txt` are fine.
- [ ] **Step 7:** Add a line under `## [Unreleased]` of `CHANGELOG.md` (`### Added`: the pages and the redesign); commit `docs: the site's redesign in the changelog`. Delete the scratch scripts' preview process.
