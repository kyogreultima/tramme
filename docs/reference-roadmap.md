# Start from a reference roadmap

The user gives the assistant a reference (a video, a gif or a Lottie) and adds their own assets: their logo, their screenshots, their footage, their pictures, their words. The assistant makes the same video in the context of those assets: the reference's scenes, pace, cuts on the music, layouts, moves, transitions, palette and type, with the user's assets wherever the reference showed its own content. The result is an editable Tramme project.

Status: steps 1 to 4 built on 2026-11-13 (`/remake`, the `read-reference` tool, the outline, the plan and the checks; the reference is documented in [document.md](document.md#start-from-a-reference)); step 5 waits: its proof and its runs make films with the assistant, on the user's quota. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

Inspired by [reanimate](https://github.com/NiazMorshed2007/reanimate) (MIT), a Claude Code skill that records an animation, writes its spec, builds it and verifies it against the original. Tramme keeps the loop and changes its aim: reanimate rebuilds the original, Tramme rebuilds it around other content. Any code taken from reanimate keeps its licence notice.

## Why

A user who likes a film can show it far more precisely than they can describe it. "The same, but with my product" is the brief motion designers receive every day. The assistant already plans and builds films from words ([taste-finish-roadmap.md](taste-finish-roadmap.md)); a reference gives it everything the words leave open.

## Principles

- **The reference's film, the user's content.** Everything of how the reference is made carries over: scenes, durations, cuts on the beat, the layout of each scene, the moves, the transitions, the role and rhythm of the text, the palette, the type. Its content does not: its words, logos, footage, characters and pictures never enter the film. The user's assets take their places, and keep their own colours (a logo, a screenshot is shown as it is).
- **The type approached, never copied.** The reference's typefaces are matched by the nearest typeface the project can use (the packs, Google Fonts, the user's fonts); a typeface is never traced from the frames.
- **A reading, saved as an asset.** What the assistant reads from the reference is written once, at authoring time, as `assets/references/<name>.reference.json`, with its source named. The render never reads the reference: rendering stays a pure function of `t`, and the project stays self-contained.
- **A reference is a source, not a template.** Nothing read from a reference is stored as a reusable format of the app; the reading belongs to the project that read it.
- **One mechanism for the assistant and the editor.** The reading is a tool of the editor's vocabulary, called by the assistant with `use_tool` and by the user from the `/` menu; the film is made through the existing film plan and operations, so every change is validated, previewed and undoable.
- **The model sees both.** The checks put a frame of the reference and the frame of the user's film at the same moment side by side, and the assistant judges them with its own eyes.
- **It costs money, and the user says so first.** Reading a video with a vision model and building the film spend the user's quota: the same gate as the other paid tools, with an accept-in-advance setting.
- **The user's right to the reference is theirs to hold.** The editor reads a file the user gives it; it does not fetch from platforms whose terms forbid it.

## Decisions

Taken by the user on 2026-11-13.

1. **The inputs.** A video or a gif file and a Lottie file; a link only when it points at a media file. Pages of streaming platforms are not fetched.
2. **What transfers.** The same video in the context of the assets the user adds: the whole making of the reference (structure, layouts, moves, transitions, palette, type), its content replaced by the user's assets.
3. **How autonomous.** The reading is shown first as an outline of scenes (what each one shows, where, how long, on which beat); the user corrects it or accepts it, then the film is made. An accept-in-advance setting skips the stop.
4. **Where it runs.** The web editor, the desktop app and the CLI alike; the reading runs with the existing perception tools and the provider of the assistant.

## Steps

### Step 1. Reading a reference

- [x] A `reference` asset kind: a video, a gif or a Lottie dropped on the Studio or the assistant's prompt, kept under `assets/references/` and marked as a reference, so no layer shows it by mistake and the export never includes it.
- [x] The `read-reference` tool: the shots of the video (the `shots` tool), its music (`beats`), a few frames per shot sent to the model, and from them the reading: the scenes with their start, length and the beat they cut on; in each scene its slots, the places where content sits (a logo, a headline, a screenshot, a photo, a product, a figure) with their box, their role and their entrance; the moves (push-in, pan, tilt, rise, mask reveal…); the transitions; the role and rhythm of the text (title, word by word, caption); the pace (cuts per second, holds); the palette as colour values and the type as a description (serif or not, weight, width, case, tracking).
- [x] The movement read from the pixels where the frames alone leave it open: the motion estimate already used by slow motion gives each shot's direction and speed, so a push-in is told from a pan without asking the model.
- [x] A Lottie reference read exactly: the import ([lottie-import.ts](../packages/interop/src/lottie-import.ts)) gives its layers, keyframes and eases, and the reading takes its slots and timing from them, without a vision model.
- [x] The reading's schema in `@tramme/core`, written by `pnpm schema`, and documented in [document.md](document.md).

Built differently: the reference stays where it was imported and is marked `reference: true`, rather than moved under `assets/references/` (only its reading is written there). The camera is measured by a search for the zoom or the shift that best explains a second look at the shot, the frame's border included, rather than by the block matching of slow motion: on flat graphics, the blocks find nothing. The reading's model is the turn's route, as the critic's, counted with the critic's consults; it is no paid generation, so it has no gate of its own.

Checked in Chrome on a three-shot film rendered by Tramme (a title rising, a mark popping under a push-in, a screen sliding in), as mp4 and as gif: cuts at 1.99 and 3.99 s for 2 and 4, the push-in found on the second shot alone (72 px/s for 74), the user's logo and screen proposed for their slots. To check on a device: a real reference, read with a real model.

### Step 2. The reading shown to the user

- [x] The reading as an outline in the Studio: one row per scene with a still of the reference, its length, its beat, its slots and the asset of the user proposed for each; the user edits a row, swaps an asset, deletes a scene or merges two, and the asset changes through operations.
- [x] The setting that accepts the reading in advance (decision 3), in the assistant's settings with the other accept-in-advance options.

### Step 3. The same video around the user's assets

- [x] Each slot matched to an asset of the user by its role (the logo to the logo's slot, a screenshot to a screen, a portrait to a person), and the words written for the text slots from the user's brief, in their language. A slot left without an asset is filled, in this order, by an asset the user adds, a picture made by `generate-image` behind its gate, or a plain type treatment; the answer names each slot filled that way.
- [x] The film plan made from the reading: one plan scene per reading scene, its length, beat, slots and direction (the reference's palette and the nearest typeface) kept. `film-plan` takes the reading as `reference` and says in the plan which scene of the reading each scene follows.
- [x] The scenes built with the existing vocabulary at the reading's layout, the moves and transitions mapped to the editor's (`push-in`, `compare`, masks, the transitions of the packs); a move the vocabulary lacks is named in the answer and replaced by the nearest, never drawn as a picture.
- [x] The cuts on the reference's timing; on the beats of the user's music at the same places of the bar when the user gives another music.
- [x] The text with the rhythm of the reference's text (word by word stays word by word, a held title stays held), its length fitted to the slot.

### Step 4. Checked against the reference

- [x] A structure check, in code: number of scenes, their lengths within a tolerance, cuts on the same beats, slots at the same places, the same kinds of move and transition. What differs is listed under `To fix:`.
- [x] A look check by the critic: a frame of the reference and the frame of the film at the same point of each scene, side by side; the critic names what keeps them from reading as the same video (a layout off, a softer move, a different weight of type) and never asks for the reference's content. Its rounds are bounded by `criticRounds`.
- [x] A content check, in code: no word of the reference's text, no logo or picture of the reference in the film (the reading keeps the words the model saw; the film's text is compared with them).

### Step 5. Shown and measured

- [ ] A proof on the site ([proofs-roadmap.md](proofs-roadmap.md)): a reference whose licence allows it, a set of assets, the film made; shown side by side.
- [ ] Two references with two sets of assets each on the trial server, scored blind: how close to the reference, how much of the user's content, the cost. Spends the user's quota, waits for their go.
