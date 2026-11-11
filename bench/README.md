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
   share from the cache), tokens written, time, the route it took (server,
   chat, companion, local). It is kept in the conversation
   (`.tramme/chats/*.json`, the items with `usage`); `node bench/usage.ts
   <project folder or .tramme>` adds them up and prices them (see below).
5. Export the film (MP4) and score it.
6. Run the same brief a second time in a new project: the two films are scored
   apart, then side by side for variety.

### Running a brief unattended

`node bench/run.ts <brief id>` does the steps above alone, on the trial server
(port 8790, its own state in `.wrangler/state-bench`) with the companion:

```
npx wrangler dev -c apps/worker/wrangler.jsonc --port 8790 --var DEV_OPEN:1 --persist-to .wrangler/state-bench
node packages/cli/src/main.ts agent --origin http://localhost:8790
node bench/run.ts logo-sting --series baseline --cap 6 --effort high
```

The turn goes through Claude Code, so it spends the subscription's quota: it is
stopped once its cost, read live from Claude Code's transcripts at the API's
prices, passes `--cap` dollars. `--dry` opens the project and checks the
companion answers without sending anything. The run leaves in
`out/bench/<series>/<brief>-<n>/` the conversations (for `usage.ts`), the
transcripts and `run.json`; the project stays on the trial server to be watched
and scored. A brief's `files` (paths under `bench/`) are put in the project's
`assets/` first.

### What a run costs, and what a change did to it

`node bench/usage.ts <project>` prints, for each turn, its tokens, the share
read from the cache, the route and the cost in dollars, then the same per
conversation and in all. The prices are in `prices.ts` (dollars per million
tokens: input, cache read, cache writes kept 5 minutes or an hour, output).
Only Claude is priced: a turn of any other model, or of a route that reported no
usage (Antigravity), says "cost unknown" rather than zero, and so does a total
holding one. Usage is kept per turn, not per request, so Haiku 5.5's higher rate
past 100 K tokens of prompt cannot be applied: its costs read "at least".

`node bench/usage.ts --compare <before> <after>` compares two series of runs of
the same briefs, each a project or a folder with one project per run (folders or
`.tramme` files): the cost, the cache share, the tokens written and the time of
each, and the change. Run the briefs before a change, run them again after, and
compare; a change that lowers the cost and moves the scores is not a saving.

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
(the reference figures are below):

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

### Reference figures

15 frames per case, milliseconds per frame, after the decoder pool, one asset per
file, the parallel export and the filter boxes were in.

On a modest laptop with a GPU (Windows 11, Chrome 155 headless on ANGLE/D3D11, an
Intel HD 620, an i5-7300U with 2 cores and 4 threads):

| case | frame | evaluate | draw | video | readback | send | held back by |
|---|---|---|---|---|---|---|---|
| `layers` | 140 | 5.0 | 25 | 0 | 29 | 67 | the transfer |
| `effects` | 8,716 | 2.3 | 8,616 | 0 | 35 | 50 | the JavaScript (Canvas 2D filters) |
| `video4k` | 112 | 0.3 | 2.5 | 5.3 | 47 | 45 | the GPU |
| `crossfade4k` | 159 | 0.5 | 2.6 | 21 | 67 | 55 | the GPU |
| `simulation` | 133 | 0.3 | 36 | 0 | 28 | 57 | the transfer |
| `instances` | 132 | 1.4 | 33 | 0 | 27 | 58 | the transfer |

With a GPU the readback falls from 230–370 ms to 27–67 ms, and sending the frame to
ffmpeg becomes the largest part of most cases. `effects` stays far above the others:
an export draws in Canvas 2D on the processor by design (`raster: 'cpu'`, exact
antialiasing; the editor's preview uses `'gpu'`), so its filters run there.

The same cases in a cloud container with no GPU (Chrome's software GL), before the
steps above, for comparison only: `layers` 341, `effects` 40,236, `video4k` 501,
`crossfade4k` 666, `simulation` 331 ms a frame, the readback weighing 230–540 ms on
each. They say where to look on such a machine, not on a user's. Worth taking again
on a machine with a dedicated GPU.

## The critic column

A turn that had the film reviewed (the `critique` tool) ends with a usage line that carries `consults`: the critic's requests, priced at their own model's price and added to the turn's cost. `node bench/usage.ts <project>` prints them apart (`critic 2 consults $0.41`). To choose the number of rounds, run the same two briefs at *Critic rounds* 0, 1 and 2 and compare the series with `node bench/usage.ts --compare <before> <after>` beside the blind scores.

## Scenes built apart

A film built scene by scene ends each scene's turn with its own usage line, carrying the scene's name. `node bench/usage.ts <project>` prints them under their conversation (`scene Price: ...`) and, after them, the total of the scenes and how far the dearest is from the cheapest. A flat cost per scene is a spread near 1: a spread that grows with the scene's place in the film means a scene's prompt grows with the scenes before it.
