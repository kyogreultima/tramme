# Bench

Two benches: what the assistant costs and makes (below), and where a frame's
time goes when Tramme renders ([load cases](#load-cases-where-a-frames-time-goes)).

## What the assistant costs and makes, on briefs it has never seen

`briefs.json` holds prompts of the kind users write: launches, announcements,
teasers, data stories, testimonials, in four formats and two languages. The
**dev** briefs are for working on Tramme; the **test** briefs stay unseen while
doing so (no preset, element or prompt is tuned on them) and are only run to
measure. A change that helps the dev briefs and not the test ones is fitted to
those videos, not general.

### Running a brief

1. A new project in the brief's format.
2. In the chat, the brief's prompt, word for word.
3. Leave the assistant alone until the turn ends: apply the changes at the end
   of the turn (settings), no answer to its questions.
4. The turn ends with its cost: tool calls, pictures seen, tokens read (and the
   share from the cache), tokens written, time. It is kept in the conversation
   (`.tramme/chats/*.json`, the items with `usage`); `node bench/usage.ts
   <project folder or .tramme>` adds them up.
5. Export the film (MP4) and score it.
6. Run the same brief a second time in a new project: the two films are scored
   apart, then side by side for variety.

### Scoring (1 to 5 each)

| | 5 is |
|---|---|
| Story | a concept of its own, one idea per scene, an opening that hooks, an end that asks for something |
| Faithful | the brief's words, names and figures as given; nothing made up |
| Direction | an art direction that fits the brand and the audience (palette, type, motion), the brand's colours |
| Rhythm | cuts on the beat, no dead frame, nothing static for long |
| Legible | type large enough for the format, on screen long enough to read |
| Sound | music and effects present, balanced, on the picture |
| Finish | no text cut or overlapping, nothing off frame |
| Variety | (two runs of one brief) two directions: another structure, palette, type or motion, not the same film reworded |

### Reference

A reference (`marketing.tramme`, 2026-10-13, a reference video to
recreate, Opus, effort high): 6 hours, more than two 5-hour quotas, 305 tool
calls, 76 pictures seen, 20 plugins written by the assistant, about 10 s of a
40 s film.

## Load cases: where a frame's time goes

`load/cases.ts` builds documents that each push one part of a frame
([performance roadmap](../docs/performance-roadmap.md), step 1):

| Case | What it pushes |
|---|---|
| `layers` | 400 animated shapes: evaluation and Canvas 2D drawing |
| `effects` | 20 layers with blur, shadow and glow, the composition's look, motion blur: Canvas 2D filters and the GPU |
| `video4k` | a 4K VP9 source in a 1080p frame: video decoding (the file is made by ffmpeg on the first run; VP9 because Chromium builds without H.264 decode it too) |
| `crossfade4k` | a crossfade between two shots of that 4K file, 4 s apart: one file read at two moments at once |
| `simulation` | particles, cloth, a rope and a flock stepped every frame |

`tramme load` renders them (all, or the ones named) in a folder of the system's
temporary files, and prints for each the time per frame and its parts:
evaluation, drawing, waiting for video frames, the GPU's readback, waiting for
the encoder, and what holds the case back (the JavaScript, the GPU, video
decoding or the transfer). The GPU works asynchronously: its share of a frame
is paid when the pixels are read back.

```
npm run tramme -- load --json before.json          # before a change
npm run tramme -- load --before before.json        # after: each figure with its change
npm run tramme -- load video4k --frames 30         # one case, its first second
```

The figures depend on the machine (a real GPU or a software one, the cores):
compare runs made on the same machine.
