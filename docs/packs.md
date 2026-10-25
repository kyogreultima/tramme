# Packs

The plugin packs that ship with the editor: one self-contained file each in `plugins/`, added to a project from the Code section, their commands in the `/` menu from the home screen on. Each brings nodes (layers only it can draw), tools (a whole thing laid out in one move) and checks (what the review flags). This page is generated from the packs themselves by `npm run packs:index` — do not edit it by hand.

## Charts

Bar, line and donut charts from a data set, animated, with a layout tool and a readability check

- Tools: `/chart` — Add a chart
- Nodes: `chart.bar` — Bar chart, `chart.line` — Line chart, `chart.donut` — Donut chart
- Checks: `chart-readability` — Chart readability

## Kinetic type

Text that moves letter by letter: typewriter, wave, scatter, drop, mask

- Tools: none
- Nodes: `text.kinetic` — Kinetic text
- Checks: none

## Physics

Confetti, bouncing balls, a rope, and letters that drop and settle — deterministic simulations

- Tools: none
- Nodes: `phys.confetti` — Confetti, `phys.bounce` — Bouncing balls, `phys.rope` — Rope, `phys.text-drop` — Text drop
- Checks: none

## Stick figures

Pivot-style stick figures: fixed-length segments posed by joint angles, two-bone IK or stretch, with a walk cycle, a figure tool and a pose check

- Tools: `/styk-figure` — Stick figure
- Nodes: `styk.figure` — Stick figure
- Checks: `styk-figure` — Stick figure poses

## UI walkthrough

A phone or browser frame for screenshots, a clicking cursor, and a tool that lays the walkthrough out

- Tools: `/walkthrough` — Lay out a walkthrough
- Nodes: `ui.device` — Device, `ui.cursor` — Cursor
- Checks: none

## Accessibility checks

Text size, contrast, blinking and time-to-read, checked with the others

- Tools: none
- Nodes: none
- Checks: `a11y-text-size` — Text size, `a11y-contrast` — Text contrast, `a11y-flash` — Blinking, `a11y-duration` — Time to read

## Localization

Captions and shorts in other languages: the assistant translates, the tools retime and duplicate

- Tools: `/localize` — Prepare a translation, `/localize-apply` — Apply a translation
- Nodes: none
- Checks: none

## Icons

Lucide icons as editable stroke groups, found by name, tag or words, laid in a row, a grid or a list, drawing themselves in the film's colours

- Tools: `/icon` — Icons
- Nodes: none
- Checks: `icon-stroke` — Icon stroke

## Diagrams

Flows, architectures, cycles and trees from flowchart text (a Mermaid subset), laid out layered, ring or hub, drawn as editable boxes and self-drawing edges, with a legibility check

- Tools: `/diagram` — Diagram
- Nodes: none
- Checks: `diagram-legibility` — Diagram legibility

## Code view

Code and a terminal on screen: a lexer's colours, typing at a human rhythm, a change between two versions, a session that runs

- Tools: `/code-screen` — Show code on screen
- Nodes: `codeview.code` — Code, `codeview.terminal` — Terminal
- Checks: `code-legibility` — Code legibility

## Rhythm

Rhythm and coherence checks: cuts off the beat, even shots, a palette drifting off the tokens, near-duplicate type sizes

- Tools: none
- Nodes: none
- Checks: `off-beat` — Off the beat, `even-shots` — Even shots, `palette-drift` — Palette drift, `type-drift` — Type drift

## Screencast

Screen recordings played as product films: the picture zooms where things happen, out before each page change, clicks marked with a ripple

- Tools: `/screencast` — Play a screen recording
- Nodes: none
- Checks: `screencast-motion` — Screencast motion

## Handmade

Made by hand: strokes that boil, motion on twos, rough sketches and annotations drawn around what matters

- Tools: `/annotate` — Annotate a layer
- Nodes: `sketch.shape` — Sketch
- Checks: none

