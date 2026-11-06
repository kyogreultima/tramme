# Web scene step 0 prototype

Three isolated scene folders exercise the seek contract without adding a web scene to the Tramme document yet:

| Scene | Content | Minimum PSNR, engine vs iframe preview | Median PSNR |
|---|---|---:|---:|
| `css-svg` | CSS gradient, SVG path and locally loaded Geist variable font | 33.14 dB | 35.68 dB |
| `gsap` | Paused GSAP timeline and transformed HTML elements | 31.86 dB | 34.48 dB |
| `three` | Seeked Three.js WebGL box with alpha | 45.04 dB | 51.29 dB |

The measurement used six frames per scene at 320×180, 6 fps, on Windows. `@hyperframes/engine@0.9.13` captured PNG with Headless Chrome 152; Tramme's Puppeteer launch captured an actual iframe in Chrome 156. `compare-preview.mjs` calls the same `compareFiles` PSNR function as `tramme compare`. Every exported frame differs from the previous one; a second engine capture of each scene matched all six PNG files byte for byte. The browser versions differ, so these PSNR values are evidence for the prototype only. They are not a preview fidelity guarantee on other hardware.

The higher-level `hyperframes@0.9.13 render --format png-sequence` command was also tested with the first custom-seek scene. It emitted six identical initial-pose frames even though its lint passed and the iframe moved. The lower-level engine called `window.__hf.seek(t)` and produced six distinct frames. This difference must inform the engine decision after the node and editor preview prototypes exist.

## Reproduce

Use Node 24 and a local Chrome installation. Install the pinned prototype tools in the ignored cache, outside Tramme's editor bundle:

```sh
npm install --prefix .cache/roadmaps/hyperframes-0.9.13 --no-audit --no-fund @hyperframes/engine@0.9.13 gsap@3.15.1 three@0.187.0
```

For each of `css-svg`, `gsap`, and `three`:

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
