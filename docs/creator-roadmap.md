# Creators' roadmap

What a creator who talks to the camera every week needs, taken from what works elsewhere (a script first, the takes chosen for them, a storyboard by block). Decided with the user on 2026-11-16: each box is an option beside the current way of working, never in its place, and none of them comes before the work already planned. Everything that works today keeps working the same.

## A. The takes chosen against the script

- [x] A script given to the project (written, pasted or imported): kept as a document of the project (`meta.script`), read by the assistant.
- [x] The recording transcribed (the transcription that exists), its words aligned on the script's sentences (`takes`, apps/editor/src/takes.ts).
- [x] For each sentence, the last good take kept; the repeats, the false starts and the words off the script cut, the sentences never said named. The cut is a take of the assistant, kept or set aside as any other. (Keeping what was said off the script and is worth it is left to the assistant's judgement, from the tool's report.)
- [ ] Before and after on real footage, in the proofs.

## B. The script as a prompter

- [x] Record in the app (camera and microphone) with the script scrolling at the pace chosen (the prompter: in the studio's bar and the atelier's timeline, apps/editor/src/ui/Prompter.tsx).
- [x] The recording joins the project, and the assistant's box is ready to keep its takes (A).

## C. A storyboard by block

- [x] A view of the film by sentence of the script: for each block, keep the camera or say in one sentence what to show (the prompter's Blocks tab, meta.blocks; built by the `/blocks` workflow).
- [x] Ideas offered for a block left empty (the `/blocks` workflow proposes one per empty block before building).
- [ ] The blocks built apart (the scenes already are), shown building side by side. Left: the thread shows them one under the other.

## D. Smaller things

- [x] Several `/commands` in one message, and the commands and `@tags` marked in the boxes.
- [x] A style kept with the account (the direction's palette, typefaces, tone and rules: "Keep as my style", the library's styles), offered to each new project on the home screen (apps/editor/src/style.ts).
- [x] "From a voice": a recording dropped alone, and the cleaning, the storyboard, the edit and the sound follow one another (the `/from-voice` workflow).

## E. Export for editors

- [x] A Final Cut 7 XML for Premiere Pro (`tramme premiere`, "For Premiere Pro" in the export panel): the cuts, the footage with its in and out points, the sound on its tracks; each block's animation as a ProRes 4444 clip with alpha above the footage; the subtitles as SRT. From the desktop app, the command line and the export in the cloud.
- After Effects takes the same clips. Rebuilding the animations layer by layer in After Effects (a script) is left out: too much for what it gives.
