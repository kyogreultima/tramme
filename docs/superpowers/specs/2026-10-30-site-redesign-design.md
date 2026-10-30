# The site, redesigned — design

Date: 2026-10-30. Status: agreed in conversation (plan of the day, then "go" with the defaults below); the decisions marked *my call* are the builder's defaults, to be corrected on review.

## Intent

Tramme's site is one long page, a download page and the docs. It should read like the site of a product that has several things to show: a top bar with menus, a page per pillar of the app, a gallery of examples, a short pricing answer, a changelog, an about page, and a real footer. The content structure follows CapCut's French site (https://www.capcut.com/fr-fr/): a hero with the app in front, the smart-editor features as cards, the tools by category, templates (here the repository's examples), social proof, a closing call, and a footer in columns.

The look takes a little from the reference screenshot the user gave (MAXS): a big assertive hero with the app's picture right under it, a manifesto sentence with small pictures set inside the text, feature cards pairing a screenshot with a short caption, a full-width picture with a piece of the interface floating over it, an accordion FAQ, a giant wordmark closing the page. It leaves what makes that reference brutalist: condensed capitals, hard edges and blocks, the neon yellow-green, decorations (stars), extreme contrast.

**The page follows the app's theme.** The site already shares the editor's tokens (`apps/site/src/styles/theme.css`: the paper theme by default, the studio theme beside it, Geist, the teal accent, 20 px surfaces, pill buttons) with the docs. That stays the single source: the redesign adds no colour, no font and no shape of its own.

## Goals

- A multi-page site with the structure below, one look across the landing page, the new pages, the download page and the docs.
- A landing page that says what Tramme is in the first screen and shows the app in front of the visitor within it.
- The new logo (`brand/svg`, already in place) in the top bar, the footer, and as the giant wordmark.
- Every page works in both themes, from a phone to a wide screen, with the keyboard, and without JavaScript for the menus and the FAQ.

## Non-goals

- A second language. The site stays in English; the pages are built so a `/fr/` can be added later, nothing more.
- A blog, a templates marketplace, accounts, a newsletter, analytics.
- Changing the docs' content or Starlight's layout (only the shared top bar and footer vocabulary, if it reaches them).
- Changing the app.

## Anti-goals (it fails even if it works)

- Looking like CapCut or like MAXS: borrowed ideas, not borrowed looks.
- Anything the memory of this project forbids: a colour outside the theme tokens, gradients, glows, sparkles, small labels above titles, step numbers, connector dashes; the same layout for every section.
- Invented proof: no testimonials, no download counts, no ratings, no partner logos Tramme has no relation with.
- A heavier landing page: it still runs no engine, the videos load near the screen, and its weight and its scores are not worse than today's.

## Pages

| Page | Role | Content |
|---|---|---|
| `/` | landing | hero; manifesto; the pillars as cards with pictures; tools by category; examples; facts; FAQ; closing call |
| `/features/` | the pillars, one page | Studio, Atelier, Assistant, Packs, Export, each with its picture, a few lines and a link to its docs |
| `/examples/` | the gallery | the repository's examples (`examples/*/tramme.json`), each its video, its name, its length, "open in the app" |
| `/pricing/` | the answer to "what does it cost" | free and open source (Apache-2.0); the app in the browser and on the desktop at no charge; only the AI providers' usage costs, with the visitor's own keys |
| `/docs/changelog/` | what changed | `CHANGELOG.md` as one more docs page (the docs loader already makes pages from the repository's Markdown): no new rendering code; *my call*, planned in place of `/changelog/` |
| `/about/` | the project | what it is, the licence, how to contribute, the repository, the security policy |
| `/privacy/` | what is kept where | short and factual: projects stay in the browser (personal mode) or in the user's folder (desktop), keys in a key vault or the system keychain; what the site itself collects (nothing, if that is true: to be verified in the code before it is written) |
| `/download/` | exists | restyled with the new top bar and footer only |
| `/docs/` | exists | untouched |

The "web app" page of the plan is dropped: the app opens from the top bar's primary button.

## The top bar and the footer

- The top bar stays the app's floating pill. Its links become menus: **Product** (the app in the browser, the desktop app, the assistant), **Features** (the five pillars), **Examples**, **Docs**, **Pricing**; and on the right the theme toggle, the repository and the primary button. Menus open with `<details>` or the popover API: no script, the keyboard works, they close on Escape. On a phone they fold into one menu.
- The footer is columns: Product, Features, Resources (docs, changelog, examples), Project (about, repository, licence, privacy, security), and above them the giant wordmark.

## The landing page, section by section

1. **Hero.** One sentence on what it is, two buttons (open the app, download), "free and open source, no account" under them, and the app's picture right below, large, in the page's theme (the existing `Shot`: tilted back, lying flat as the page scrolls). Today's hero is close to this: it is kept and reshaped, not replaced.
2. **Manifesto.** One large sentence about directing a film in words, with small video stills inserted in the line (examples from the repository). Scroll-revealed, still when motion is reduced.
3. **The pillars.** The five of the features page as two-column cards: a screenshot and a short caption each; one of them as a full-width picture with a piece of the interface floating over it.
4. **Tools by category.** What a motion designer looks for first (today's chips strip, `Steps.astro`), grouped: type, shapes and paths, camera and depth, effects, sound, export; each group links to its docs.
5. **Examples.** The gallery's first three, as today's `Made`, linking to `/examples/`.
6. **Facts, not proof.** Counted from the code at build time (layer types, effects, modifiers, formats: today's `OpenSource` stats), the licence, the platforms of the latest release, the interface languages; plus the repository's activity read at build time only if it can be done as `lib/download.ts` already reads the release, and left out otherwise.
7. **FAQ.** An accordion of real questions with true answers (is it free, does it work offline, which formats, which systems, where do my projects live, which AI does it use, can I add my own effects). `<details>`, one new component, marked up for search engines.
8. **Closing call and the wordmark.** Today's `Closing` band, then the footer's giant wordmark.

## Constraints

- Tokens only, from `theme.css`. Type scale: Geist, weight and size for hierarchy; the hero and the manifesto may go larger than today's `h1` (a `clamp` up to about 7 rem), in the same family and weight, never condensed.
- Shapes as the app's: 20 px surfaces, 14 px pictures, pills for buttons.
- Performance: no engine on the landing; videos and large pictures lazy; no new script for look; reveals stay scroll-driven CSS. The landing's weight and its Lighthouse scores are measured before and after, and are not worse.
- DRY: the new pages are made of the existing pieces (`Head`, `Cards`, `Shot`, `Media`, `AppLink`, `DownloadLink`, `Footer`, `Nav`) and a handful of new ones (`FAQ`, `Menu`, `Wordmark`, a two-column feature card, a page header); a section repeated on two pages is one component. The old landing sections that the new ones replace are removed, not left unused.
- The docs keep working: they share the theme and the brand, and Starlight's own header is not replaced.
- Honest content: every claim on the pages is checked against the code or the docs; the examples, formats and counts are read from the repository, not typed.

## What was decided

- By the user: the content follows CapCut's structure; the design takes a little from the screenshot and none of its brutalism; the site follows the app's theme; a plan first.
- By default, accepted with "go": English only for now; the pages above, with a pricing page, a changelog in place of a blog, and a privacy page; the landing page and the shared pieces first, the other pages after.
- *My call*: no "web app" page; the manifesto section and the giant wordmark are kept from the screenshot, the counter and the testimonials are not; the FAQ is real questions only.

## Left to the builder

- The exact copy of each page, within the facts above (the existing landing copy is the voice to keep: plain, short sentences, a motion designer's words).
- Which screenshots and stills are used where; new screenshots only if a pillar has none (`apps/site/src/assets` holds the studio, the atelier and the parts).
- The menus' mechanism (`<details>` or popover), as long as it needs no script and is accessible.
- The order of the work inside the two phases: the shared pieces and the landing page first, the pages after.
