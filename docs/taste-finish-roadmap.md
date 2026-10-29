# Taste and finish roadmap

How Tramme's assistant reaches the production level of the `marketing` reference from a prompt alone, with no asset given, and dresses a talking video as a human editor would. The design is [the spec](superpowers/specs/2026-10-29-taste-and-finish-design.md): the bar is the level of finish, never the look or the genre. Each step gets its own plan in `docs/superpowers/plans/`, lands on its own and is measured before the next; tick the boxes as they land.

Status: steps 1 to 5 built, waiting for their measure (the baseline of step 0 is the user's to run, from the `taste-baseline` tag).

## Measuring

Every step is measured on the bench: the grid of [bench/README.md](../bench/README.md), a 1 to 10 against marketing scored blind by the user, the cost from `bench/usage.ts`. While a step is built it is tried on the dev briefs only; the test briefs run once, when the step is done. A step that raises the dev scores and not the test ones is fitted, not general.

## Steps

### Step 0. The baseline

- [ ] Run three test briefs and the two dressing briefs from a worktree of the tag `taste-baseline` (`git worktree add ../tramme-baseline taste-baseline`): the code as it was before step 1.
- [ ] Add the two dressing briefs to `bench/briefs.json` (dev: the bilal talk; test: `out/ammm/export.mp4`, unseen) and a way to show the films shuffled and unnamed.
- [ ] Score the eight films blind, keep the costs.

### Step 1. Make what exists work ([plan](superpowers/plans/2026-10-29-taste-and-finish-step1-make-what-exists-work.md))

- [x] The device frame takes an interface built in layers (`device-screen`, `ui.device` parts), no engine change.
- [x] The index shows each pack's entries by need, generated from the modules' notes, in the cached part of the prompt.
- [x] Search before writing: the guide says to search the vocabulary with two or three words before writing a plugin.
- [x] Harvest: the plugins written in a turn are listed to the user and offered to the library.
- [x] The plugin runtime documented in the reference, with a test that keeps it in step with `ToolContext`.
- [x] A check that can be acted on: issues folded by cause, ranked, capped, named by the composition they sit in; `tramme check` prints the same report.
- [x] False positives fixed at the source: contrast against the card the text sits on, the standard's ratio, fades and pictograms left out.
- [x] Coverage: the longest stretch with only the speaker on screen.
- [x] Warnings are not argued with: fixed, or raised with the user in the summary.
- [ ] One dev run of bilal on the trial server, compared with the run of 2026-10-28 (25 requests, 36 tool calls, 15 images, 24 min): spends the user's quota, waits for their go.

On the bilal project as the run of 2026-10-28 left it (the check the assistant read during that run returned 496 warnings and 29 notes), `tramme check` now reads in six lines (65 warnings, 33 notes of the final document), no contrast warning remains on the interface texts, and the coverage check finds the stretches where the speaker is alone (44.5 s to 77.25 s, 92 s to 114.75 s, 172 s to 193.5 s, and one at the start).

### Step 2. Typefaces ([plan](superpowers/plans/2026-10-29-taste-and-finish-step2-typefaces.md))

- [x] A catalogue of open typefaces searched by character, a specimen sheet drawn by the engine, the chosen files copied into the project at a pinned version, type pairing in the guide.

### Step 3. Direction: kinds of picture, then style frames ([plan](superpowers/plans/2026-10-29-taste-and-finish-step3-direction.md))

- [x] The direction picks the few kinds of picture a film alternates, so no form repeats scene after scene.
- [x] Two or three style frames drawn by an image model, one kept as the target: palette to tokens, type matched to the catalogue, plates and objects made again as assets, the scene rebuilt in layers.
- [ ] One dev run on the trial server (the dressing brief of bilal and one launch brief, twice each): the kinds each plan chose, the frame kept, whether two runs of one brief keep different frames, the cost. Spends the user's quota, waits for their go.

### Step 4. Material ([plan](superpowers/plans/2026-10-29-taste-and-finish-step4-material.md))

- [x] Objects and illustrations made as assets, textures and light drawn by the engine, free libraries (CC0 textures and models, licensed photos and clips) with credits, real logos only with the user's yes.
- [ ] One dev run on the trial server (the dressing brief of bilal and one launch brief): objects, surfaces and stock files each film used, whether any scene stayed a flat plate, the real logos listed, the cost against step 3. Spends the user's quota, waits for their go.

### Step 5. The missing vocabulary ([plan](superpowers/plans/2026-10-29-taste-and-finish-step5-missing-vocabulary.md))

- [x] Interface pieces, layers in perspective, a camera onto a detail, simple 3D solids, finance charts, the comparison of a render with a picture.
  - [x] Layers in perspective and a picture pinned on four corners (`rotationX`, `rotationY`, `fx.pin`, `pin`), a camera onto a detail (`push-in`).
  - [x] Interface pieces (pack and `screen`), 3D solids with materials (`solid.3d`), candlesticks and price lines, `compare`, and the guide's lines on them.
- [ ] One dev run on the trial server (the dressing brief of bilal and one launch brief): whether the interface scenes used `screen`, whether layers were tilted, whether `push-in` and `compare` ran, the operations per scene against step 4's run, the cost. Spends the user's quota, waits for their go.

### Step 6. The critic ([plan](superpowers/plans/2026-10-29-taste-and-finish-step6-critic.md))

- [ ] A separate review in a fresh context, on motion rather than stills, with a definition of done and variants instead of endless fixes; the number of rounds is a setting.

### Step 7. Scene by scene ([plan](superpowers/plans/2026-10-29-taste-and-finish-step7-scene-by-scene.md))

- [ ] The direction, the kept style frame and the scene list written to the project; each scene built in a fresh context that inherits only them.

### Step 8. A library of references ([plan](superpowers/plans/2026-10-29-taste-and-finish-step8-references.md))

- [ ] Annotated in words, never as copied media: what makes a frame or a cut work, and the faults to avoid.
