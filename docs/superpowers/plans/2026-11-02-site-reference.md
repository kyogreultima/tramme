# Reference design across the complete site

The reference design now applies to every website page, following the user's clarification that the full site is in scope.

- Shared dark olive / warm white palette, orange actions, Geist typography, fine rules and compact white navigation.
- A consistent oversized brand footer and closing section.
- Features: direct chapter navigation, real screenshots and flat editorial feature lists.
- Pricing: white plan panel, aligned pricing and actions, comparison table and two-column FAQ.
- Explore and public projects: editorial film cards, featured project and a film/details layout.
- Download: product preview, system installers and honest missing-release state.
- About, legal and roadmap pages: structured reading layouts.
- Documentation: matching header, typography, navigation, tables and code surfaces, retaining Starlight search and responsive controls.
- A localized, branded 404 page and keyboard skip links.
- Preserve real content, pricing, navigation destinations, localization and the landing's scroll journey.

Validation: build all routes, run existing tests and TypeScript, inspect each generated page at desktop and mobile widths, verify pricing period controls, FAQ, menus, documentation search/navigation and theme persistence.

Completed validation: 173 tests pass; root TypeScript passes; Astro builds 54 routes and also emits the localized French 404 asset. Chrome inspected all 55 HTML documents at desktop and mobile widths (110 checks), with no horizontal overflow or page errors. Pricing periods, FAQ, theme persistence, menus, documentation search, the landing journey and unknown English/French paths all pass. Captures and report: `.cache/site-redesign/`.

The French error document is also emitted as `fr/404.html` for the existing [Cloudflare nearest-404 behavior](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/).
