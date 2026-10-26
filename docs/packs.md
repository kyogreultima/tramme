# Packs

The plugin packs that ship with the editor: one self-contained file each in `plugins/`, added to a project from the Code section, their commands in the `/` menu from the home screen on. Each brings nodes (layers only it can draw), tools (a whole thing laid out in one move) and checks (what the review flags). This page is generated from the packs themselves by `npm run packs:index` — do not edit it by hand.

## Charts

Bar, line and donut charts from a data set, animated, with a layout tool and a readability check

- Tools: `/chart` — Add a chart
- Nodes: `chart.bar` — Bar chart, `chart.line` — Line chart, `chart.donut` — Donut chart, `chart.race` — Race chart, `chart.scatter` — Scatter, `chart.function` — Function
- Checks: `chart-readability` — Chart readability

## Kinetic type

Text that moves letter by letter: typewriter, wave, scatter, drop, mask

- Tools: none
- Nodes: `text.kinetic` — Kinetic text
- Checks: none

## Physics

Confetti, bouncing balls, a rope, and letters that drop and settle — deterministic simulations

- Tools: none
- Nodes: `phys.confetti` — Confetti, `phys.bounce` — Bouncing balls, `phys.rope` — Rope, `phys.text-drop` — Text drop, `phys.bodies` — Bodies
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

## Chat

Conversations for short videos: a script timed by reading, bubbles entering, typing indicators, the thread scrolling; notifications for the cold open

- Tools: `/chat` — Play a conversation
- Nodes: `chat.thread` — Chat thread, `chat.notice` — Notification
- Checks: `chat-reading` — Chat reading

## Emoji

Emoji as pictures: the 300 most used (Fluent Emoji Flat, MIT) shipped as SVG, found by name or character, drawing the same on every machine

- Tools: `/emoji` — Place an emoji
- Nodes: none
- Checks: none

## Maps

Maps, offline: Natural Earth shipped beside the pack, places found by name, great circles and a smooth zoom for the flights

- Tools: `/map` — Draw a map
- Nodes: `map.view` — Map
- Checks: `map-legibility` — Map legibility

## Audiogram

Audiograms: the wave of a sound moving with the voice, a cover, a name, a progress bar — a clip for the feeds

- Tools: `/audiogram` — Make an audiogram
- Nodes: `audiogram.wave` — Wave
- Checks: none

## Math

Formulas: a TeX subset laid out glyph by glyph in STIX Two Math, written on or changing like a proof on a board

- Tools: `/formula` — Show a formula
- Nodes: `math.formula` — Formula
- Checks: `formula-legibility` — Formula legibility

## Matter

Morphs, liquids and paper: one shape becoming another without twisting, seeded blobs, a torn sheet crossing the frame

- Tools: none
- Nodes: `matter.morph` — Morph, `matter.liquid` — Liquid, `matter.paper` — Paper
- Checks: none

## Print

Print looks: halftone, riso inks, grain and duotone — as GLSL passes and stacked presets

- Tools: none
- Nodes: none
- Checks: none

## QR codes

QR codes written in the pack's own code: square, rounded or dotted modules, a logo in the middle, revealed module by module, a check for what a phone cannot scan

- Tools: none
- Nodes: `qr.code` — QR code
- Checks: `qr-scannable` — QR scannable

## Logos in 3D

Logos in 3D: the path layers of a logo extruded with a bevel into a .glb, turning under the built-in 3D model layer

- Tools: `/extrude` — Extrude a logo in 3D
- Nodes: none
- Checks: none

