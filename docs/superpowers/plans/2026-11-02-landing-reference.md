# Landing page reference implementation

Scope follow-up: `2026-11-02-site-reference.md` extends this visual direction to every website page and the documentation, including the shared closing component.

**Goal:** Reproduce `image.png` and `image1.png` for Tramme, retaining “One film, all the way” and advancing its features on scroll.

**Architecture:** Keep Astro and bilingual catalogs. Scope the dark palette, white navigation, orange actions and editorial typography to the landing. Use real screenshots and films. Enhance a readable feature list with a sticky stage and IntersectionObserver, without intercepting wheel or touch scrolling.

**Decisions:** Teal textile hero, inset white navigation, light headings, fine rules, dark product sections, white community section, dark closing and oversized existing brand. Replace customer claims with honest product content. Work in the user-provided checkout to retain the reference images and dependencies.

- [x] Add the landing variant and reference palette, navigation and footer.
- [x] Replace the hero and supporting sections with the reference composition.
- [x] Build Studio → Atelier → Assistant → Packs → Export with direct selection, reverse scrolling and linear no-script/reduced-motion fallbacks.
- [x] Update obsolete presentation assertions and test journey activation and teardown.
- [x] Run the site suite and build; inspect desktop/mobile, both languages, every step and fallbacks in Chrome.

## Asset

The built-in imagegen tool generated `apps/site/src/assets/hero-textile.png`. Astro serves responsive WebP derivatives. Existing screenshots and film posters are reused for product content.

Prompt used:

> Use case: photorealistic-natural. Asset type: wide website hero background, 16:9 landscape. Extreme macro photograph of richly textured flowing teal fabric, like a sculptural turquoise silk cloth or soft sea sponge surface, sweeping broad organic folds, tiny tactile textile grain, cinematic side lighting, deep petrol shadows and luminous teal highlights, fills entire frame. Abstract organic material only, no identifiable object. Large sweeping diagonal fold rising from lower left towards upper right; darker lower right and bottom edge provide clean space for white website typography added separately. Restrained premium editorial photography, sophisticated dark teal green cyan palette, like the abstract turquoise fabric in the supplied landing page references. No text, no logos, no borders, no interface, no watermark.

## Review notes

Independent code review checked the shared page shell and journey. Browser verification covered French widths down to 320px and wide desktops up to 2560px, forward/reverse scrolling, direct selection, hashes, resizing, reduced motion, landscape and no JavaScript. Observer margins use viewport-height pixels and refresh on resize. The original closing component remains in use on other site pages; the reference closing belongs to the landing only.

Final validation: 171 site tests pass, root TypeScript check passes, production build produces 53 pages. Chrome checks pass on nine viewport configurations with no page errors; screenshots and the behavior report are in `.cache/landing/`.
