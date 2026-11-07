# Safe projects roadmap

Priority: **now**, before removing the code-execution question or accepting projects from unknown sources without it.

Status: **in progress (18 open, 2 done)**. The opaque frame and CSP, CLI declaration isolation, font transfer, deadlines, per-plugin tool isolation and initial bridge limits are implemented. Full execution-path coverage, capability validation, resource budgets, recovery and the release gate remain open.

Boundary work (2026-11-06): `node scripts/verify-project-boundary.mjs` exercises an HTTP-served CSP and an `allow-scripts` iframe. The frame's message origin is `null`; reads of the parent DOM, cookies, localStorage, IndexedDB and CacheStorage throw `SecurityError`. A private API request is refused by `connect-src 'none'`. A module worker created from a `data:` URL has opaque origin, cannot fetch that API, and retains OffscreenCanvas and WebGL2 in Chromium. A `blob:` module worker failed to start in this setup, so the transport uses `data:`. The editor and CLI now serve `/project-sandbox.html` with a network-denying policy; `browserHost` transfers its bundled worker and approved local plugin source into that frame. The CLI's real plugin render and boundary tests pass under Chrome and Edge. The served-route tests also refuse direct fetch, no-CORS fetch, XHR, WebSocket, EventSource where available, remote module imports and a nested worker's fetch without reaching a private route. An actual project module attempting IndexedDB access and a private fetch during initialization receives `SecurityError` and sends no request. In local Wrangler, HTML assets redirect to extensionless URLs, so the Cloudflare Worker explicitly serves both sandbox paths with the CSP; the real local response was checked. The desktop custom protocol attaches the same header. Production deployment, desktop webviews, Firefox/Safari, the remaining native/CLI execution paths and media/model transfer remain to be tested before the box is checked. **To check on a device:** Windows/WebView2 and macOS/WKWebView, including whether native APIs are visible inside the frame or worker.

CLI native-import removal (2026-11-06): archive and folder validation now load plugin declarations through the same browser sandbox. The Node registry holds schema and functions that refuse execution; project code runs only in the isolated worker, including during `validate`, `check` and pack/unpack validation. A plugin that loops during initialization is terminated after the declaration deadline. The CLI's actual plugin render continues to use the isolated browser worker. Plugin behavior needed by Node-only checks or vector comparisons must be bridged explicitly before those operations can claim full parity; the refusal is deliberate and the roadmap remains open.

Font transfer (2026-11-06): the trusted page fetches font bytes only from the current project's file root or a local Blob and sends them in order before draw requests. The worker creates `FontFace` from those bytes and no longer fetches the document's font URL itself. Chrome and Edge tests confirm one approved read and that naming the private API as a font triggers a refusal before any request reaches it. Other approved resources still need explicit host capabilities; this does not close step 1.
Model transfer (2026-11-06): the trusted asset loader now reads model bytes with a 32 MiB limit, refusing URLs outside the current project root (or an owned Blob) when isolation is enabled. Document snapshots copy these bytes to the worker; `model.3d` parses them there without calling `fetch`, including during whole-frame rendering where node preload does not run. Unit tests cover the project-path refusal, oversized streaming cancellation, snapshot refresh and network-free model parsing. `node bench/safe-projects/model-sandbox.mjs` renders a colored `.glb` through the real CLI browser worker with a plugin present (760 colored pixels). Native-device and other media-path checks still keep step 1 open.
CLI browser import fix (2026-11-06): the CLI now obtains plugin declarations from the opaque worker before opening its trusted renderer, and configures that renderer to skip project module imports. The model integration probe has a plugin that throws if imported where `document` exists; the export succeeds through the worker. The six-frame web-scene plugin composite also still succeeds. The CLI no longer accepts a `sandbox=0` query escape for projects with plugins. Expression-only projects and the remaining browser/native execution paths still keep step 2 open.
Isolated asset path check (2026-11-06): before the trusted renderer loads an image, font, JSON, LUT, audio, video, model or non-plugin module for an isolated document, it now checks that the URL is within the document's project folder or an owned Blob. A video proxy receives the same check. A test proves that a JSON asset naming `/api/private` is refused before `fetch`; the model browser probe still renders. Other host capabilities, especially tool requests and files outside the project, remain in step 3.

CLI mount containment (2026-11-07): the local render server now uses path-relative containment rather than a string prefix, and refuses an existing project symlink that resolves outside its mount. Project config cannot replace a protected `/project/` path with another mount. Unit tests cover sibling-prefix traversal, parent traversal, a directory symlink and a forged config mount. Explicit non-project mounts remain supported; this closes one path to another folder, not the full cross-project and native boundary proof in step 1.
Asset allocation bounds (2026-11-07): the loader now has at most eight asset loads in flight; an isolated image above 8,192 pixels on either side or 16 million pixels overall is refused before creating an `ImageBitmap`. Tests exercise both limits. Browser image decoding already occurred by the time its dimensions are known, and the number of assets in a document is not yet capped; graphics memory and aggregate allocations therefore remain open in step 4.
Bitmap bridge budget (2026-11-07): each page-to-sandbox message and draw/frame response now has a separate 256 MiB budget for the estimated RGBA bytes of its `ImageBitmap` surfaces; this does not mistake a bitmap for a small plain-data object. A test covers refusal in both directions. Document images are cloned into the worker so the trusted page retains its loaded copy; per-frame video bitmaps can still transfer ownership. Actual browser/GPU allocation, repeated messages and per-project totals remain open in step 4.
The worker now waits for each supplied `FontFace` to finish loading before the first frame, plugin draw or vector export uses it. A font that fails to load stops that operation with its error rather than silently drawing a fallback face.

Startup and call deadlines (2026-11-06): if the iframe does not start its worker in ten seconds, the host rejects waiting operations and removes it. Plugin loading has a 15-second deadline; checks, drawing, frame renders and vector exports have 30 seconds; tools have 120 seconds. A timeout closes the host so the next attempt creates a fresh isolated frame. A browser test serves a blank frame to prove the startup refusal; fake-time tests cover load, draw, check, tool, whole-frame render and vector export timeouts. Resource budgets and a user-facing recovery flow remain open in step 4.

Bridge input checks (2026-11-06): unknown worker requests no longer fall through to the check's asset-data capability. Host file requests reject absolute paths, traversal and URL-like paths before invoking the project context; file payloads and network request fields have size and shape bounds. A test sends forged requests during an active check/tool call and verifies that no private data or file action is reached. This input check alone did not establish plugin identity; later paragraphs record the separate worker and replay checks.

Host resource bounds (2026-11-06): at most 64 worker calls can wait at once; the next is refused before it reaches the worker. The host refuses a project module larger than 1 MiB before sending its source into the opaque frame. Unit and browser tests exercise these limits. Total message size, graphics allocations and a user-facing recovery path remain open in step 4.

Plugin-backup expansion (2026-11-06): the installed-plugin backup reader now refuses a compressed file over 64 MiB and a declared expanded total over 128 MiB before inflating entries. The project archive and single-plugin package readers already had expansion limits. Other import paths, total bridge message size, graphics allocations and recovery still keep step 4 open.

Bridge request concurrency (2026-11-06): one active tool or check can have at most 16 host requests waiting at once. The host refuses replayed request IDs before repeating a file or network operation, and no longer sends an answer back after the call has ended. This is one part of the broader capability validation still open in step 3.

Worker response envelopes (2026-11-06): the host checks the shape and basic bounds of declarations, call IDs, draw result lists, progress, and error fields before using them. A malformed response closes the isolated frame and rejects waiting work. Plugin identity and complete capability checks still keep step 3 open.

Worker result budget (2026-11-06): the host traverses returned declarations, tool outputs, drawings and vector exports with an 8 MiB limit for nested plain data and a 10,000-entry limit. Returned ImageBitmaps are checked for dimensions but their actual GPU allocation is controlled by the browser; they are not counted as plain bytes. Message transfer allocations and platform memory limits still keep steps 3 and 4 open.

Expression-only picture path (2026-11-06): when a user has explicitly enabled the experimental sandbox preview, a project without plugins now selects the same sandboxed picture path for stills and raster exports. Previously the export selector required a plugin even under that opt-in. The default remains off; page-side mirror evaluation, sound evaluation and vector export can still evaluate expressions outside the boundary, so step 2 is open.

Startup queue bounds (2026-11-06): while the isolated frame starts, consecutive document snapshots are coalesced and the host stops at 128 queued messages. A project may load at most 64 distinct plugin modules in one host. A browser test holds the frame at startup and verifies that excess messages close it promptly. Overall message bytes, media copies and platform memory remain open in step 4.

Bounded resource reads (2026-11-06): approved project modules (1 MiB) and fonts (16 MiB) are now read through a bounded stream; the host cancels a response as soon as it exceeds its limit, without first buffering its whole body. A test uses a response that never finishes after crossing the module limit and verifies prompt cancellation. Other media and model transfers still need equivalent host capabilities and budgets.

Approved network response budget (2026-11-06): when a plugin has a specific network grant, its bridge response body is read with a 64 MiB ceiling and cancelled before forwarding if it exceeds that ceiling. A test uses an open response advertising an oversized body and verifies cancellation. This bound does not itself validate the grant; permission separation is recorded below.

Permission separation (2026-11-06): declarations and drawing may share the project worker, but tools and checks now run in a separate opaque worker per plugin ID and module URL. The trusted host selects that worker from its own registry entry; the plugin cannot choose another host in a message. Changing the module URL or project disposes the former worker. Browser tests show a second plugin's forged request cannot invoke the first plugin's active fetch grant and verify host replacement. Editor-shipped packs are transferred only under their pack identity. Other capability checks in step 3 remain open.

Canvas request bounds (2026-11-06): the host refuses malformed dimensions and draw or whole-frame requests above 8,192 pixels on either side, using the same per-side ceiling as the editor's project-size control. Scale is checked before a worker message is sent. Per-layer graphics allocations, aggregate pixels and platform memory limits still keep step 4's resource box open.

Worker canvas retention (2026-11-06): the isolated renderer now keeps at most two released full-frame canvases in its reuse pool; further released canvases are resized to zero rather than held for later frames. This bounds that cache, while simultaneous layer allocations, WebGL contexts and actual browser/GPU memory still need measurement and limits before step 4 is complete.

Failure recovery (2026-11-06): a failed project or installed plugin attachment is no longer cached as a successful attachment; the next attempt can load a repaired source. Storyboard stills now propagate plugin attachment failures and display their error instead of silently producing a picture with missing plugin tools. A complete safe retry/open-without-extension flow and preservation tests for unsaved work remain open in step 4.

Bridge answer budget (2026-11-06): host replies to a sandbox file, data, still or other capability request are checked against the 8 MiB nested-data budget before posting; an oversized reply is refused to that call. Approved network replies retain their separate 64 MiB streamed-body ceiling. Tests cover both sides of this distinction. Media transfers still need their own budgets, so step 4's resource box stays open.

Outbound message budget (2026-11-06): tool, check, draw, render and document messages are refused before the host sends more than 64 MiB of nested data or 10,000 entries. The browser transport checks again after it adds approved font bytes. A test verifies that an oversized tool input and document snapshot do not reach the worker. Transferred image/video bitmap allocations and aggregate graphics work remain outside this plain-data bound, so step 4 stays open.

## Goal

A user opens, plays, edits and exports a `.tramme` project without granting its scripts the editor's rights. Ordinary animation code needs no general execution permission. Extra capabilities, such as sending a media file to an external service, require a specific, understandable permission.

This work extends [plugin isolation](plugin-isolation.md) and [the evaluator in the sandbox](evaluator-sandbox.md). It closes the isolation item in [the plugins roadmap](plugins-roadmap.md#step-10-ecosystem); enabling `sandboxPreview` alone does not close it.

## What exists, and what is missing

- `apps/editor/src/importer.ts` inventories plugins and expressions and asks before running imported code. Keep this question until the release gate below passes.
- `apps/editor/src/plugins/` runs tools, checks and drawing in a per-project worker. Whole-frame evaluation and rendering also exist, behind a setting that is off by default.
- The worker is created on the editor's origin. Its `guardRealm` limits `fetch` to that origin and removes `WebSocket`; the published CSP also permits same-origin requests. This does not deny access to the editor's authenticated API or same-origin storage.
- Expressions use `new Function` with selected global names shadowed. A blocked-name list is not a security boundary. Expressions must be covered even when a project has no plugins, including any mirror evaluator used by the interface.
- Import validation, thumbnails, stills, vector exports, browser exports, the desktop app and the CLI must obey the same boundary. A sandboxed preview does not make an earlier native or page-side import safe.

The platform distinction matters: [workers can use network and storage APIs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers). An [opaque-origin sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) or a dedicated origin without the editor's credentials provides a boundary the host can enforce. Merely replacing globals does not.

## Step 1. Establish the enforced boundary

- [ ] Build and prove the runtime boundary on the supported browsers and desktop webviews. Decided (2026-11-05): an opaque-origin sandboxed iframe (`sandbox="allow-scripts"`, never `allow-same-origin`) whose document is served with a Content-Security-Policy that denies the network, hosting the worker for computation and rendering. It needs no domain and serves the web, the desktop app and the CLI's page alike. A dedicated credential-free origin (like the key vault's) is the fallback only if a supported webview fails the proof. Preserve OffscreenCanvas/WebGL where supported; document compatibility before committing to the transport. What only a device can show (WebView2 on Windows, WKWebView on macOS) is written under the box as "to check on a device", and does not block it.
- [ ] Deny direct access to the editor's DOM, cookies, IndexedDB, caches, other projects, account data, provider routes and keys. On desktop, expose no Tauri IPC, native commands or filesystem rights to project code. On the CLI, execute no untrusted plugin in the native Node process.
- [ ] Deny direct network requests and remote module loading by platform policy, including alternative transports and nested execution contexts. Transfer approved code, media, fonts and model resources through the host; do not pass authenticated editor URLs as a substitute for isolation.

Done when: code running at module initialization cannot read the editor's data or call its API, before any drawing or tool call occurs. Test the actual deployed headers and native protocol, not only mocked globals.

## Step 2. Cover every execution path

- [ ] Move all imported plugins, expressions, modifiers, effects, simulations, checks and tools behind the boundary, including expression-only projects and the interface's mirror evaluation.
- [ ] Use that boundary during archive validation, import, project opening, thumbnails, playback, scrubbing, stills, raster/vector exports and CLI rendering. Pass data and finished pictures across it, never executable plugin callbacks.
- [ ] Make isolated execution the default after validation. A missing capability, failed worker or unsupported platform must stop the affected operation with a clear explanation; never fall back silently to the editor's or Node's full rights.

Done when: a project cannot select an unprotected path through its contents, saved preferences, a query parameter or a failed isolated render.

## Step 3. Give scripts only the capabilities they need

- [ ] Limit the host API to explicit operations on the current project: read approved assets, receive document data, draw, and propose validated, undoable edits. Expose neither arbitrary API forwarding nor unrestricted file paths.
- [ ] Validate message kinds, payloads, paths, sizes, call lifetime and results on the host. Establish the caller's project and permissions on the host; do not trust an identity claimed in a message.
- [x] Keep different permission sets separate. One plugin must not impersonate a plugin with approved network access, reuse its active call, or inherit its grants merely because both run in one project worker.
- [ ] Keep provider keys on the trusted side. An approved external action names the service, operation and data; scripts never receive the key itself.

Done when: malformed, forged or replayed messages cannot access another project, broaden a capability or bypass the normal proposal validation.

## Step 4. Bound failure and resource use

- [x] Add deadlines to loading, checks, tool calls and rendering. The host can terminate and recreate a non-responsive worker; cancellation must not depend on the script cooperating.
- [ ] Bound input sizes, archive expansion, messages, pending requests, canvas dimensions and graphics allocations. Enforce the resource limits available on each platform and state any limits the platform cannot enforce, rather than promising a hard memory cap it does not provide.
- [ ] Preserve the user's saved project and unsaved editor work after a script crashes, loops forever or exceeds a budget. Explain which operation stopped and offer a safe retry or opening without that extension.

Done when: a faulty project cannot freeze the editor's main thread or trigger unbounded host-side work through its bridge.

## Step 5. Replace general consent with specific permissions

- [ ] After all other gates pass, remove the general “Run this project's code?” question for ordinary isolated opening, playback and export. Do not describe this documentation release as having removed it.
- [ ] Ask only for extra capabilities: a named external destination, files outside the project, or a paid provider action. Say what will happen, for example “Send this image to this service?”, rather than asking for JavaScript execution.
- [ ] Scope remembered grants to the relevant project/plugin and capability; show and revoke them in settings. New destinations or broader permissions need a new decision. An old general trust answer must not become unrestricted access in the new model.

Done when: ordinary projects open without a code question, while an ungranted external or privileged action remains blocked and understandable.

## Step 6. Prove the result before shipping

- [ ] Run adversarial tests for module-load side effects, expression escapes, cross-project reads/writes, authenticated requests, storage access, remote imports, alternate network APIs, Tauri/Node access, forged messages, permission confusion, infinite loops and oversized inputs. Verify rejection without an unprotected fallback.
- [ ] Run the real import → reopen → preview → still → export paths on the web, Windows/WebView2, macOS/WKWebView, Linux and the CLI where supported. Cover private/personal storage modes and cloud mode when it exists; mark unsupported paths explicitly.
- [ ] Compare preview and export against representative projects: video, transparency, 3D, simulations, expressions, modifiers, effects, installed plugins and vector output. Record understood pixel differences and measure frame time, memory and responsiveness on real hardware.
- [ ] Obtain an independent security review of the boundary, bridge and native integration, fix its material findings, and record the tested versions/platforms and residual limitations.

## Release gate

The general permission disappears only after the enforced boundary, complete path coverage, capability checks, failure handling and adversarial/device tests pass. Until then, keep the existing warning and mark this work as unfinished. A worker, a signature, a blocklist or a default-setting change alone is not sufficient.
