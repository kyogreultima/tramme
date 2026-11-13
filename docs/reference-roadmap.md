# Start from a reference roadmap

The user gives the assistant a reference (a video, a gif, a Lottie or a link) and the material of their own film: their words, their brand, their footage. The assistant reads how the reference is built (its scenes, its pace, its cuts on the music, its moves, its transitions, the role of its type) and makes the user's film built the same way, as editable Tramme layers. The result is the user's film in the manner of the reference, never a copy of the reference.

Status: not started. Decisions 1 to 4 are the user's and come first. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

Inspired by [reanimate](https://github.com/NiazMorshed2007/reanimate) (MIT), a Claude Code skill that records an animation, writes its spec, builds it and verifies it against the original. Tramme keeps the loop and changes its aim: reanimate rebuilds the original, Tramme carries its structure onto other material. Any code taken from reanimate keeps its licence notice.

## Why

A user who likes a film can show it far more precisely than they can describe it. "Like this, but for my product" is the brief motion designers receive every day. The assistant already plans and builds films from words ([taste-finish-roadmap.md](taste-finish-roadmap.md)); a reference gives it the pace, the structure and the manner the words leave open.

## Principles

- **The structure transfers, the content stays the user's.** Scenes, durations, cuts on the beat, kinds of move, transitions and the role of each text carry over. The reference's words, logos, footage, characters and pictures never enter the film. The palette and the type come from the user's brand when they have one, from the reference only as a direction.
- **A reading, saved as an asset.** What the assistant reads from the reference is written once, at authoring time, as `assets/references/<name>.reference.json`, with its source named. The render never reads the reference: rendering stays a pure function of `t`, and the project stays self-contained.
- **A reference is a source, not a template.** Two films made from one reference with two briefs differ as the briefs differ. Nothing read from a reference is stored as a reusable format of the app.
- **One mechanism for the assistant and the editor.** The reading is a tool of the editor's vocabulary, called by the assistant with `use_tool` and by the user from the `/` menu; the film is made through the existing film plan and operations, so every change is validated, previewed and undoable.
- **The model sees both.** The checks put a frame of the reference and the frame of the user's film at the same moment of the structure side by side, and the assistant judges them with its own eyes.
- **It costs money, and the user says so first.** Reading a video with a vision model and building the film spend the user's quota: the same gate as the other paid tools, with an accept-in-advance setting.
- **The user's right to the reference is theirs to hold.** The editor reads a file the user gives it; it does not fetch from platforms whose terms forbid it.

## Decisions

The user's, before step 1.

1. **The inputs of the first version.** Proposed: a video or a gif file and a Lottie file; a link only when it points at a media file. Pages of streaming platforms later, or never.
2. **What transfers.** Proposed: structure, pace, moves, transitions and the role of the type, always; the reference's palette and typefaces only when the project has no brand of its own, and then approached, never sampled exactly.
3. **How autonomous.** Proposed: the reading is shown first as an outline of scenes (what each one does, how long, on which beat), the user corrects it or accepts it, then the film is made. An accept-in-advance setting skips the stop.
4. **Where it runs.** Proposed: the web editor, the desktop app and the CLI alike; the reading runs in the editor with the existing perception tools and the provider of the assistant.

## Steps

### Step 1. Reading a reference

- [ ] A `reference` asset kind: a video, a gif or a Lottie dropped on the Studio or the assistant's prompt, kept under `assets/references/` and marked as a reference, so no layer shows it by mistake and the export never includes it.
- [ ] The `read-reference` tool: the shots of the video (the `shots` tool), its music (`beats`), a few frames per shot sent to the model, and from them the reading: the scenes with their start, length and the beat they cut on, what each scene shows in kinds of the film plan (`interface`, `type`, `object`…, never the reference's subject), the moves (push-in, pan, tilt, rise, mask reveal…), the transitions, the role and rhythm of the text (title, word by word, caption), the pace (cuts per second, holds), and the palette and type as directions.
- [ ] The movement read from the pixels where the frames alone leave it open: the motion estimate already used by slow motion gives each shot's direction and speed, so a push-in is told from a pan without asking the model.
- [ ] A Lottie reference read exactly: the import ([lottie-import.ts](../packages/interop/src/lottie-import.ts)) gives its layers and keyframes, and the reading takes its timing and eases from them, without a vision model.
- [ ] The reading's schema in `@tramme/core`, written by `pnpm schema`, and documented in [document.md](document.md).

### Step 2. The reading shown to the user

- [ ] The reading as an outline in the Studio: one row per scene with a still of the reference, its length, its beat and what it does in words; the user edits a row, deletes it or merges two, and the asset changes through operations.
- [ ] The setting that accepts the reading in advance (decision 3), in the assistant's settings with the other accept-in-advance options.

### Step 3. The user's film in the manner of the reference

- [ ] The film plan made from the reading and the user's brief: one plan scene per reading scene, its length and beat kept, its kind and its idea taken from the user's material. `film-plan` takes the reading as `reference` and says in the plan which scene of the reading each scene follows.
- [ ] The scenes built with the existing vocabulary, the moves and transitions of the reading mapped to the editor's (`push-in`, `compare`, masks, the transitions of the packs); a move the vocabulary lacks is named in the answer and replaced by the nearest, never drawn as a picture.
- [ ] The cuts on the beats of the user's music when the film has one, at the same places of the bar as in the reference; on the reference's timing otherwise.
- [ ] The text in the user's language, with the rhythm of the reference's text (word by word stays word by word, a held title stays held).

### Step 4. Checked against the reference

- [ ] A structure check, in code: number of scenes, their lengths within a tolerance, cuts on the same beats, the same kinds of move and transition in the same places. What differs is listed under `To fix:`.
- [ ] A manner check by the critic: a frame of the reference and the frame of the film at the same point of each scene, side by side; the critic names what the film lacks of the reference's manner (a faster pace, a harder cut, a bolder type) and never asks for its content. Its rounds are bounded by `criticRounds`.
- [ ] A content check, in code: no word of the reference's text, no logo or picture of the reference in the film (the reading keeps the words the model saw; the film's text is compared with them).

### Step 5. Shown and measured

- [ ] A proof on the site ([proofs-roadmap.md](proofs-roadmap.md)): a reference whose licence allows it, a brief, the film made; shown side by side.
- [ ] Two references and two briefs each on the trial server, scored blind: how close the manner, how much of the user's content, the cost. Spends the user's quota, waits for their go.
