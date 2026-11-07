# Web scene seek and composition prototypes

Five scene folders exercise the seek contract. The CSS, WAAPI, SVG, GSAP, Lottie and Three.js adapters share `sceneController` from `packages/project/src/scene-runtime.ts`. The step 0 compositor prototype still uses a project plugin node; ordinary editor and export integration are later roadmap steps.

| Scene | Content | Minimum PSNR, engine vs iframe preview | Median PSNR |
|---|---|---:|---:|
| `css-svg` | CSS animation, SVG SMIL and locally loaded Geist variable font | 28.35 dB | - |
| `gsap` | Paused GSAP timeline and transformed HTML elements | 31.86 dB | 34.48 dB |
| `three` | Three.js AnimationMixer driving a WebGL box with alpha | 45.04 dB | 51.29 dB |
| `lottie` | Local Lottie animation with alpha | 45.05 dB | - |
| `waapi` | Web Animations API transform | 38.80 dB | - |

All five scenes produced six distinct export frames; a second capture of each was byte-identical. The native CSS/SVG animations have a larger early-frame preview gap (minimum 28.35 dB). These measurements are prototype evidence, not a fidelity guarantee on other hardware.

The measurements use six frames per scene at 320x180 and 6 fps on Windows. The pinned engine captures alpha PNGs; the comparison harness captures an iframe and reports PSNR with the same function as `tramme compare`.

The higher-level `hyperframes@0.9.13 render --format png-sequence` command froze the first custom-seek scene at its initial pose. The user selected the pinned low-level engine with documented iframe preview limits for CLI and desktop integration.

## Reproduce

Use Node 24 and a local Chrome installation. Install the pinned prototype tools in the ignored cache, outside Tramme's editor bundle:

```sh
npm install --prefix .cache/roadmaps/hyperframes-0.9.13 --no-audit --no-fund @hyperframes/engine@0.9.13 gsap@3.15.1 three@0.187.0
npm install --no-audit --no-fund
```

For each of `css-svg`, `gsap`, `three`, `lottie` and `waapi`:

```sh
node bench/web-scenes/capture-engine.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-css-svg-export
node bench/web-scenes/compare-preview.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-css-svg-export
```

Both commands use a local temporary server and close it when done. The capture writes six alpha PNGs. The comparison writes iframe screenshots under `.cache/roadmaps/webscene-preview` and prints frame PSNR values. The scene folder is read only.

To inspect the seekable iframe preview with its time slider, run `node bench/web-scenes/preview-server.mjs bench/web-scenes/css-svg` and open the printed local URL. Stop the server with Ctrl+C. This page uses the same `webscenePreview.seek(t)` call that the comparison harness exercises.

The CLI layer prototype runs the same capture, builds a temporary valid Tramme project with a `webscene` plugin layer over a normal rectangle layer, and asks Tramme to export six composited PNGs:

```sh
node bench/web-scenes/render-layer.mjs bench/web-scenes/css-svg .cache/roadmaps/webscene-layer
node packages/cli/src/main.ts validate .cache/roadmaps/webscene-layer/project/document.tramme.json
```

The helper checks that all six final frames differ and that a transparent scene pixel reveals the underlying Tramme layer. In the measured middle frame, the transparent scene pixel `(0,0,0,0)` became `(23,55,76,255)` after composition; the center was `(110,71,133,255)`. The node lives in this prototype's plugin and the export helper is explicit. Normal project import, editor preview and a built-in node remain for later steps.

The engine comes from [HyperFrames](https://github.com/heygen-com/hyperframes/blob/main/LICENSE) under Apache 2.0. The GSAP core is used for the prototype under its [standard no-charge license](https://gsap.com/standard-license/); Three.js is MIT. The copied Geist font in `css-svg` is OFL 1.1; its notice is beside it.

Adapter API references: [GSAP time](https://gsap.com/docs/v3/GSAP/Timeline/time%28%29/), [Three.js AnimationMixer](https://threejs.org/docs/pages/AnimationMixer), [Lottie playback](https://github.com/airbnb/lottie-web/blob/master/README.md), [Web Animation currentTime](https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime), [SVG animation clock](https://developer.mozilla.org/en-US/docs/Web/API/SVGSVGElement).
