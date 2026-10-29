# Taste and finish — design

Date: 2026-10-29. Status: agreed in conversation, waiting for review.

## Intent

From a prompt alone, with no asset given (no font, no background, no picture), Tramme's assistant makes films at the production level of the `marketing` reference, the Axiom "BNB V2" promo (`Documents/Tramme/projects/marketing-kxitk0`, `assets/chat/marketing.mp4`). The same holds when it dresses a talking video: the result stands next to what a human editor delivers.

The bar is marketing's **level of finish, not its look or its genre**. Tramme must not learn to make dark-blue crypto promos; it must reach that finish on any subject and in any style, and the same brief asked twice still gives two different films of equal quality (the user's standing rule: taste and a director's method, never a template system). It stays autonomous and affordable: the user is on a Claude subscription, and quota burn decides whether the assistant is usable at all.

Today the assistant carries the craft of *motion* (curves, staggers, durations, checks; [docs/taste-roadmap.md](../../taste-roadmap.md)) but not the craft of *the picture*: what a finished frame looks like, what it is made of, and when it is good enough. Without assets from the user, its films come out flat, repetitive and half finished.

## What we measured

### The talking video (`bilal`, 2026-10-28)

The user asked Tramme to illustrate the last 3 min 47 of a talk, in the style of a reference video and of an example animation (`essaie`), over a given background picture. A human editor then made the final film (`out/ammm/Le secret derrière ces apps étrangement addictives mp4.mp4`, 12 min 33; the same passage runs from about 8:55).

- **The story was right.** Tramme picked the same moments as the editor (points earned, 10 € × 12 = 120 € a year, the 1 300 € iPhone against the 10 € offer, the 90 € and 40 € dishes, the recap of principles). The editor even kept Tramme's "Mes tâches" phone as it was.
- **One form, eight times.** Every illustration was the same white phone in the middle of the frame. The editor alternates kinds of picture: interface screens, big titles in a condensed display face, objects and illustrations (a brain made of banknotes, the dishes as objects, a house with a price tag), glass icon tiles, diagrams (a balance, a price line, a gauge), logos, photos, stock footage.
- **No material.** Tramme set no typeface (system font), made no picture, and drew eight icons by hand in a plugin of its own. Most of what the editor added is material.
- **Framing.** Tramme's phone sits small in the middle, two thirds of the frame empty, its interface text at 16 to 22 px on a 1080 frame. The editor enlarges the phone past the edges of the frame, pushes the camera onto the detail that matters (the price, the button), clicks with a cursor, brackets the number.
- **Coverage.** Tramme left the speaker alone for 30 s at a time (0:45–1:15, 1:25–1:55, 2:50–3:10). The editor puts something on screen every 10 to 20 s, and titles over the speaker between illustrations.
- **Light.** Tramme used the given picture as it was (muddy brown stripes). The editor keeps the palette but builds a black plate with orange glows and drifting particles: the frame has a light and the screens stand out.
- **The eye.** Tramme said it judged the illustrations "on stills only, not in playback", and talked its way past the warning on small text ("the same scale as your example"). The check had returned 496 warnings and 29 notes: too many to act on.
- **Cost:** 25 requests, 2.4 M tokens read from the cache, 78 k written, 36 tool calls, 15 images, 24 min (Opus 5.5, companion).

### The vocabulary it did not find

Most of what the editor used already ships with Tramme, and Tramme used none of it:

| Need | Already there |
|---|---|
| Phone or browser frame, a clicking cursor | pack UI walkthrough (`ui.device`, `ui.cursor`), for screenshots only (see below) |
| Icons | pack Icons (Lucide, searchable) |
| A price bracketed, a word underlined | `annotate` (pack Handmade), `spotlight` |
| A title with one word in the accent | `kinetic-title` |
| A glass card | `frosted-card` |
| A gauge | pack Charts (donut) |
| Objects as pictures | `generate-image`, then `remove-bg` |
| A lit plate, particles | `shader`, `particles`, `look.bloom` |
| Pieces reused across scenes | the component library (`component-keep`, `component-use`) |

One correction to "already ships": `ui.device` holds a screenshot only (its `screen` prop is an image asset), and without one it draws nothing at all (`plugins/walkthrough.js`). An interface built in layers, which is what bilal needed, cannot sit in it, so writing its own phone was partly justified. The frame must learn to hold built layers before finding it helps.

Its own thinking reads: "maybe the UI walkthrough pack has phone mockup nodes". It never ran the search. The vocabulary index lists the packs by name only and hides their entries behind `list_nodes { query }` ("N more entries come from the editor's packs…", `apps/editor/src/ai/answers.ts`).

### What the assistant writes for itself

28 plugins across the user's projects (`Documents/Tramme/projects`, the dev server, the archives in Downloads):

- **marketing, 20 plugins (~180 KB):** tools to analyse the reference and copy it pixel by pixel (coin tracking, candle digitizing, planar tracking, comparison against the reference at full resolution). That run had been given a "pixel-accurate reverse engineer" prompt; it took 6 hours, more than two 5-hour quotas, 305 tool calls and 76 images for about 10 s of the 40. The user never wanted a copy: they wanted Tramme to reach that level on its own. What these plugins rebuild still tells what such a film is made of: candlestick charts, a field of avatar coins, a lit grid, interface cards in perspective, rising bubbles. Two of them are general: `fetch-file` (it downloaded Inter by hand: fonts are missing) and `ref-compare`/`hd-compare` (comparing a render with a picture).
- **Probes, in two projects:** the assistant explored what the plugin runtime offers, because the reference does not say it.
- **Duplicates of packs:** bilal's `ui-kit.js` (a phone and icons).
- **Bound to one subject:** a 3D airliner (35 KB), a storyboard panel, wireframe solids and an easing graph for a showreel, a liquid chrome shader. They point at one general lack: 3D (simple solids, models to find) and premium shader looks.

### What marketing's level is made of

Read from the reference, in terms that hold for any style:

- **One idea per shot, many shots:** about 20 shots in 40 s, cut on the music, each built for its idea.
- **The subject shown up close:** the product's own interface rebuilt at full fidelity, framed tight, planes separated by depth of field, layers tilted in perspective, a camera that always moves with intent.
- **Light as a material:** glows, light ribbons, glossy 3D. No frame is a flat plate.
- **Restrained type:** one family, few sizes, short lines, entering in sync with the cut.
- **Continuity:** an element of one shot becomes the next (a button becomes a sphere, a line becomes the path of the next shot).
- **Palette discipline:** neutrals and one accent, held for the whole film.
- **Density:** real-looking detail in every frame (names, figures, avatars, rows), never an empty placeholder.
- **An ending:** the logo and where to go.

### What was tried before

`@tramme/film` (removed 2026-10-26) had a direction step (`film-guide`), a review (`film-review`) and three looks. Its films scored about 4/10 against marketing: direction in words plus self-review over fixed layouts did not reach the bar.

## Diagnosis

1. **No visual target.** "An art direction decided from the brand" is a sentence in the prompt. The assistant goes from words to JSON patches without ever fixing what a finished frame looks like.
2. **No material.** Five typefaces (the kits, `apps/editor/src/recipes.ts`), flat shapes, a shader, grain capped at 0.03. The pictures guide leads with quiet backgrounds; nothing pushes the assistant to make the objects and illustrations a scene needs. A model cannot draw: it composes, and its frames are no richer than what it can reach.
3. **No outside eye, no definition of done.** The assistant judges its stills with the taste that made them; the checks catch amateur faults (the floor), never "not there yet" (the ceiling), and they drown in their own noise. The turn ends when the checks pass or the allowance runs out.
4. **Vocabulary not found, written too low.** The packs exist but stay hidden. Scenes are written operation by operation (49 operations to fix text sizes), so long films cost a lot and stop halfway.

## Goals

- From a prompt alone, films at marketing's level of finish, judged by the user against the reference.
- Dressing a talking video at the level of the editor's cut: varied kinds of picture, readable, covered, lit.
- Any subject, any style; the same brief twice gives two directions.
- The film is finished when the turn ends: every scene built, nothing provisional, sound placed.
- Cost known for every lever and compared between settings; no worse than today for the same quality.

## Non-goals

- Reproducing a reference video, pixel by pixel or shot by shot.
- A film compiler of fixed layouts or shot types (the lesson of `@tramme/film`).
- Fine-tuning a model.
- Studio 3D character animation or hand-drawn cel animation, autonomously.

## Anti-goals (failure even if it works)

- Every film looks like marketing (black, one blue accent, tilted cards), or like any one house style.
- Every scene uses the same form, however good.
- A critic loop that burns quota without raising the score.
- Warnings explained away instead of fixed or raised with the user.
- Text drawn inside generated pictures (it stays untranslatable and comes out crooked).

## Constraints

- Rendering stays a pure function of time. Everything made (a picture, a font, a model) is a file in the project with its record, as `generate-image` does today (`docs/generation-roadmap.md`); the project stays self-contained and reproducible.
- No typeface ships in the repo (the user's decision when `fonts/` was removed): fonts are fetched at a pinned version, like the kits already do from Fontsource, and copied into the project.
- Rights: only what may be used, shown and changed: open font licences, CC0, pictures and clips made by a provider for the user. Real brands' logos and pictures of real people or products go through the user's yes.
- No budget is fixed up front. Every lever that costs (style frames, variants, critique rounds, generated pictures) is a setting with a default, and runs are compared on cost and score (`node bench/usage.ts --compare`, the scoring grid of `bench/README.md`).
- Paid generations keep today's gate and per-turn allowance.
- One mechanism for the assistant and the user: every new capability is a tool of the vocabulary (`use_tool` and the `/` menu); document changes go through operations.
- The test briefs of `bench/briefs.json` stay unseen while working; nothing is tuned on one video, marketing included.
- Shared modules, no copies; new features land in the Studio first (directing in notes is the default view), the Atelier keeps working.

## The programme, in order

Each step gets its own plan and lands on its own; each is measured on the bench before the next.

### 0. The baseline

Run three test briefs and one talking-video dressing as they are today, export, score (the grid of `bench/README.md` plus a 1 to 10 against marketing), keep the cost. The bench has no dressing brief yet; add two, the videos kept out of the repo (`out/` is ignored by git):

- **dev:** the `bilal` talk (`Documents/Tramme/projects/bilal-s8tba8`: the cut video from minute 9, its transcript, the background picture and the example `essaie`, with the user's request as they wrote it). The editor's cut is the human reference for it.
- **test:** `out/ammm/export.mp4` (47.7 s, 1920×1080, 30 fps), given by the user for this. It stays unseen while working: nobody watches it until a test run. Its prompt is written without watching it: it asks what the user asked for bilal (illustrate, full frame, where a picture helps the listener) and gives nothing but the video, so it also measures the case with no asset at all.

### 1. Make what exists work

The cheapest gains, all on the existing vocabulary:

- **The device frame holds a built interface:** `ui.device` draws its frame without a screenshot, and a tool of its pack lays the frame with a content group clipped to the screen (the engine's layer `clip`), so an interface built in layers sits in a phone or a browser without a plugin of its own.
- **The index shows the packs' entries by need**, one line each ("a phone or browser frame for an interface: `ui.device`, pack UI walkthrough"), without their full schemas. The cost is a few hundred tokens in the cached part of the prompt.
- **Search before writing:** the guide says to search the vocabulary with two or three words before writing a plugin, and to write one only when nothing fits.
- **Harvest:** at the end of a turn, every plugin the assistant wrote is listed to the user and offered to the library (`library-add`). Those that come back across projects become packs.
- **The plugin runtime documented** in the reference (what a tool's context offers), so no run probes it again.
- **A check that can be acted on:** issues grouped by cause (one line for "38 texts under 3 % of the frame in the composition Illustration 2", not 38 lines), ranked, capped in what reaches the model, false positives fixed at the source (contrast measured against the card the text sits on, not the plate under the card; silent when the text sits on a layer whose colour the check cannot know).
- **Coverage:** a check for a talking video, the longest stretch with nothing but the speaker on screen. The speaker is the footage of one media, all its cut layers together; anything else visible counts as covering it (another clip, a full-frame picture, an illustration), except captions, sound, adjustment layers and what stays on screen the whole film (a logo in a corner).
- **Warnings are not argued with:** the guide says a warning is fixed, or raised with the user in the summary; never dismissed in the assistant's own reasoning.

### 2. Typefaces

A catalogue of open typefaces (Fontsource: families, categories, weights, variable axes, subsets), searched by character ("condensed grotesque, heavy, for titles"), answered with a **specimen sheet rendered by the engine** that the model looks at before choosing, the chosen files copied into the project at a pinned version. The guide gets type pairing: a display face and a text face, or one family well used; never the system font.

### 3. Direction: kinds of picture, then style frames

- **Kinds of picture.** The direction picks the few kinds of picture the film will alternate (interface up close, kinetic type, object or illustration, data, diagram, photo or footage, 3D object, character…) and assigns them to scenes so that no form repeats scene after scene. An example the user gives is one of these kinds, never the form of the whole film. These are kinds, not layouts: the composition of each scene stays the assistant's.
- **Style frames.** Before building, the assistant has two or three key frames of the film drawn by an image model (the providers of `generate-image`), from a direction written precisely (type, palette, light, materials, framing). Image models carry far more visual taste than a model writing JSON; this is where the film borrows it. One is kept (by the user, or by the assistant on its own), and it becomes the target:
  - its palette becomes the tokens (`palette`);
  - its type is matched to the closest face of the catalogue (step 2);
  - its plates, textures and objects are made again without words as assets (`generate-image` with `reference` and a mask, `remove-bg`);
  - the scene is rebuilt in layers to match it, then animated.

  The style frame is a target, never an asset: words drawn in it are retyped as text layers.
- Variety comes from here: two runs of one brief start from two different frames.

### 4. Material

What a scene needs that the vocabulary cannot draw:

- **Objects and illustrations** made as assets (an object on a transparent ground, an illustration in the film's style), not only backgrounds; the guide says when a noun of the script deserves a picture.
- **Textures and light** drawn by the engine, free and deterministic: grain, paper, halftone, moving gradients, glows, light ribbons (shader and effect presets).
- **Free libraries:** CC0 textures, environment maps and 3D models (Poly Haven, ambientCG), photos and clips under a licence that allows use (Pexels, Unsplash), searched like `sfx` searches sounds, with a contact sheet to choose from and the credits kept.
- **Real logos and pictures** (a brand, a person, a book): searched only with the user's yes, each one named in the summary. In a turn left alone, a wordmark set in the film's type stands in for a logo, a picture made for the film stands in for a real one, and the summary lists what it would fetch (decided in writing this design).

### 5. The missing vocabulary

Packs (or engine changes) for what both cases needed and nothing gives, each written at the level of meaning so a scene costs few operations:

- **Interface pieces:** rows with a checkbox, price and plan cards, a cart and its totals, a level ring and an XP bar, badges, toasts, toggles, buttons and their states, tables with avatars; light and dark, sized for the format, built on `ui.device` and the component system so a screen is a few instances with parameters. Both cases needed it; both wrote their own.
- **Layers in perspective:** rotation around x and y under the composition camera (the transform has only a 2D rotation and a depth today, `packages/core/src/types.ts`), so cards and screens tilt; and a picture pinned on four corners (what marketing's `quad.track` did by hand).
- **A camera onto a detail:** push in onto a layer and back, with the framing kept readable, for built scenes (the screencast pack does it for recordings only).
- **3D:** simple solids (box, slab, sphere, torus) with glossy and glass materials and an environment map, for the 3D accents both marketing and the showreel wanted; the extrude pack and `model.3d` already cover logos and models.
- **Finance and dense data:** candlesticks and price lines with markers in the Charts pack.
- **Comparison of a render with a picture** (side by side, difference, a score): the critic's tool against the style frame.

### 6. The critic

- **A separate review** in a fresh context, run by the strongest model with eyes available: it gets the style frame, the direction, the film in motion, and a grid calibrated on marketing's level (the list above, in words). It answers "not yet" with the three things that matter most, or "done".
- **It judges motion, not stills:** strips around every transition and entrance, or the video itself where the provider takes video.
- **A definition of done** it enforces: every scene has its material and a type hierarchy; something on screen at least every 20 s in a talking video; a hero moment and an ending; transitions; sound; no provisional element; text readable at the format's size.
- **Variants rather than endless fixes:** when a scene fails twice, two or three takes of it are made and the best is kept (the Studio's takes).
- **Bounded:** the number of rounds is a setting; the default is decided from the bench.

### 7. Scene by scene

The direction, the kept style frame and the scene list are written to the project (the brief and a film plan). Each scene is then built in its own fresh context that inherits only them, so a long film is finished without the context or the quota running out, and each scene's cost stays flat. The user sees one conversation and the stages in the Studio's notes.

### 8. A library of references

Annotated in words, never as copied media: what makes a frame or a cut work (composition, hierarchy, type, contrast, rhythm, transitions, the link between picture and sound), and the faults to avoid (empty scenes, generic motion, mismatched material, repeated compositions). Tramme's own best films join it with the reasons they work, watched for convergence onto one look.

## Measuring

- While a step is built, it is tried on dev briefs only. When it is done, the same runs as the baseline: the same three test briefs and the dressing brief, each run twice for variety, eight films. Runs spend the user's quota, so test runs happen once per step, not per change (decided in writing this design).
- Each film: the grid of `bench/README.md`, a 1 to 10 against marketing scored blind by the user (agreed: the user scores the eight films of every step, not knowing which version is which), the cost from `bench/usage.ts`. The bench needs a way to show the films shuffled and unnamed, and to put the scores back on their runs.
- A step that raises the dev scores and not the test ones is fitted, not general, and is reworked.
- Success: the test films average 7 out of 10 against marketing in the user's blind judgement, none under 5, at a cost the user accepts once they see the numbers (the figures are a proposal made in writing this design; the user sets the final ones).

## Left to the builder

- How the index lines by need are generated (from the packs' notes, or written in `plugins/index.json`).
- The exact grouping and cap of the check's issues.
- Which image provider draws the style frames by default, and how the decomposition is split between tools.
- Which model and which input (strips or video) the critic uses on each route (companion, server, other providers).
- How scenes run in fresh contexts on each route (the turn engine is `apps/editor/src/ai/conversation.ts`, the companion `packages/cli/src/agents.ts`).
- The file formats of the film plan and of the reference library.
- Whether this programme gets a roadmap file in `docs/` with boxes to tick, like the other roadmaps.
