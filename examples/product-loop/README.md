# ARC product loop

A hand-authored six-second fixture for motion production. The native document remains editable: product solids, type and the periodic `motion.loop` backdrop are separate layers. It needs no paid generation or external asset.

From the repository root:

```sh
npm run tramme -- validate examples/product-loop
npm run tramme -- still examples/product-loop --t 0,1.5,3,4.5 --out out/product-loop
npm run tramme -- render examples/product-loop --format mp4 --pages 1 --out out/product-loop/arc.mp4
npm run tramme -- check-media out/product-loop/arc.mp4 --width 960 --height 540 --fps 30 --frames 180 --duration 6 --json
node scripts/product-loop-example.ts
```

The source uses the `/plugins/` mount declared in its local configuration. The packaging command writes `out/product-loop/arc.tramme`, including the plugin and film plan, so it can be opened directly in the editor or desktop app.

The film plan in `assets/film-plan.json` records its timed motion. This fixture proves rendering and delivery, not that the assistant produces better films automatically. That requires the same brief run before and after, with independent visual scoring and recorded time/cost.

Methods studied: [Florence's Motion Lab](https://x.com/flxrnc/status/2105311836190978392), [ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill), and [Scenario Motion Loops](https://github.com/scenario-labs/skills/tree/main/skills/scenario-motion-loops). The native implementation is independent and adds no dependency on these projects.
