# Shared site and application identity

> Implementation: execute inline, validate the complete result with a fresh review.

**Goal:** Make the site and application visibly belong to the same product, validating each shared choice in both real interfaces.

**Architecture:** A small CSS foundation in `brand/theme.css` supplies palettes, radii and motion. Each surface maps these values onto its existing semantic roles. Keep the website's editorial compositions and the editor's working density. Do not restore either stash wholesale.

**Direction:** Geist; the original application's cool Studio/Paper neutrals and teal accent, explicitly preferred by the user; restrained teal selection/focus; 6px controls, 8px menus, 10px panels, 14px dialogs. Website navigation now follows the theme's panel surface. Keep data and warning colors distinct. The photograph and interactive wave remain website-specific.

- [x] Inspect both stashes and render the existing home, Atelier, website hero and pricing.
- [x] Try the shared direction in real app screens before changing production styles.
- [x] Integrate shared foundation into default Studio/Paper, website and documentation; retain alternative user themes.
- [x] Synchronize picker previews, first-paint metadata and design reference with the actual tokens.
- [x] Build both applications; check home, Studio, Atelier, settings, website hero/pricing/docs in dark/light and mobile.
- [x] Verify contrast, keyboard focus, semantic states, motion preferences, navigation and existing tests. Document the tested cross-surface rules and evidence.

Review especially: light controls on white backgrounds; teal selection versus semantic colors; dense inspector labels; mobile overflow; repeated palette declarations that can diverge again.

Validation: 179 tests pass; root TypeScript passes; editor and 54-page site builds pass. Native Chrome confirms shared computed backgrounds/accents/control radii, sampled text/placeholder/action/focus contrast, theme selection, light product pictures, mobile overflow, and local keyboard-focus colors in inverse navigation and the dark hero. Existing wave/journey behavior passes its browser checks, including reduced motion and no JavaScript. Independent review: PASS after contextual focus-role corrections. Reports and comparison board are in `.cache/identity/`.
