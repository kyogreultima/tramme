# Directing and delivering motion

The film plan can now carry timed motion beats. Existing plans remain valid.

```json
{
  "name": "Product",
  "kind": "3d",
  "idea": "The product rises, then holds for the title",
  "seconds": 6,
  "motion": [{
    "subject": "Product",
    "start": 0.8,
    "end": 1.6,
    "action": "Rise 120 px, overshoot the destination by 7%, then settle",
    "easing": "easeOut with a damped overshoot",
    "settle": 2.1,
    "soundAt": 1.62
  }]
}
```

Times are seconds from the scene's start. A beat needs a subject, start, end and action. Easing, settling and a sound cue are optional. The tool rejects non-finite, backwards or out-of-range timing before saving. A scene builder receives its complete choreography even when the global plan summary is shortened.

For a seamless film, set `loop: true` on the plan. A single shot may use one picture kind. Leave movement quiet while text needs to be read; a still hold is a valid directed beat.

## Review

The critic sees an overview spanning the film, followed by selected cuts, entrances and directed movement. The budget stays at four contact sheets, with at most 48 labelled frames, plus the optional target frame. Labels identify the actual frame and time; spacing varies.

Flat graphics, long holds, silence, hard cuts and rich palettes are artistic choices. Craft suggestions do not automatically prevent a completed verdict. Provisional content, missing media references and measured readability or audio warnings do. The critic must name a timestamp, subject and concrete correction; sampled images cannot establish what happened between them or verify an unheard soundtrack.

## Local delivery

The CLI decodes MP4, MOV and WebM files after encoding and adding chapters, including exports assembled from parallel segments. It checks dimensions, cadence, decoded frame count and duration against the rendered span. A decoding or measurement failure stops a successful delivery report. GIF and PNG sequences explicitly skip this video check.

Check an existing file independently:

```sh
npm run tramme -- check-media film.mp4 --width 1920 --height 1080 --fps 30 --frames 180 --duration 6 --json
```

Expectation flags are optional. JSON includes `ok`, `expected`, `actual` and `issues`; failure returns exit code 1. `--timeout` sets the decode timeout in milliseconds (120000 by default). This check validates decoded video and timing; it does not judge composition, certify audio loudness or check destination-specific upload rules.

An additional rendering defect was corrected during this work: the CLI's plugin-sandbox path drew to the preview canvas while the encoder read a different framebuffer. The export path now writes the current sandbox picture into the framebuffer that the encoder reads. A real-browser regression verifies a moving square's position in decoded video.

## Editable loops

Add the **Motion loops** pack from Code, then use `/motion-loop`. It creates a `motion.loop` layer behind the composition. Choose orbit, ribbons or grid; edit the period, density, dimensions and colors in the inspector. A period must divide the film's duration for the whole film to loop. Drawing depends only on time and properties, so seeking out of order is reproducible.

The [ARC example](../examples/product-loop/README.md) includes a six-second film and a command to package it as a self-contained `.tramme` archive. It is a hand-authored rendering fixture, not evidence of an artistic improvement in autonomous generation. Compare actual assistant runs on the same brief, with independent scoring and recorded cost, before claiming that improvement.

## Research used

- [Florence's Motion Lab](https://x.com/flxrnc/status/2105311836190978392): measurable choreography and frame-specific corrections; [article reproduction](https://threadnavigator.com/thread/2105311836190978392/).
- [ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill): structured operations and verification after execution.
- [Scenario Motion Loops](https://github.com/scenario-labs/skills/tree/main/skills/scenario-motion-loops): periodic time, palette controls and checking loop boundaries.

These are independently implemented native additions. They require no Python, paid generation or new runtime dependency. Scenario's generation API remains a separate provider integration.
