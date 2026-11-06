# Safe projects roadmap

Priority: **now**, before removing the code-execution question or accepting projects from unknown sources without it.

Status: **planned, not implemented**. The existing worker and experimental whole-frame renderer are a foundation, not completion of this roadmap. All acceptance boxes below remain open.

Boundary work (2026-11-06): `node scripts/verify-project-boundary.mjs` exercises an HTTP-served CSP and an `allow-scripts` iframe. The frame's message origin is `null`; reads of the parent DOM, cookies, localStorage, IndexedDB and CacheStorage throw `SecurityError`. A private API request is refused by `connect-src 'none'`. A module worker created from a `data:` URL has opaque origin, cannot fetch that API, and retains OffscreenCanvas and WebGL2 in Chromium. A `blob:` module worker failed to start in this setup, so the transport uses `data:`. The editor and CLI now serve `/project-sandbox.html` with a network-denying policy; `browserHost` transfers its bundled worker and approved local plugin source into that frame. The CLI's real plugin render and boundary tests pass under Chrome and Edge. The served-route tests also refuse direct fetch, XHR, WebSocket, remote module imports and a nested worker's fetch without reaching a private route. In local Wrangler, HTML assets redirect to extensionless URLs, so the Cloudflare Worker explicitly serves both sandbox paths with the CSP; the real local response was checked. The desktop custom protocol attaches the same header. Production deployment, desktop webviews, Firefox/Safari, the remaining native/CLI execution paths and media/font/model transfer remain to be tested before the box is checked. **To check on a device:** Windows/WebView2 and macOS/WKWebView, including whether native APIs are visible inside the frame or worker.

CLI native-import removal (2026-11-06): archive and folder validation now load plugin declarations through the same browser sandbox. The Node registry holds schema and functions that refuse execution; project code runs only in the isolated worker, including during `validate`, `check` and pack/unpack validation. A plugin that loops during initialization is terminated after the declaration deadline. The CLI's actual plugin render continues to use the isolated browser worker. Plugin behavior needed by Node-only checks or vector comparisons must be bridged explicitly before those operations can claim full parity; the refusal is deliberate and the roadmap remains open.

Font transfer (2026-11-06): the trusted page fetches font bytes only from the current project's file root or a local Blob and sends them in order before draw requests. The worker creates `FontFace` from those bytes and no longer fetches the document's font URL itself. Chrome and Edge tests confirm one approved read and that naming the private API as a font triggers a refusal before any request reaches it. Model files and other approved resources still need an explicit host capability; this does not close step 1.
The worker now waits for each supplied `FontFace` to finish loading before the first frame, plugin draw or vector export uses it. A font that fails to load stops that operation with its error rather than silently drawing a fallback face.

Startup and call deadlines (2026-11-06): if the iframe does not start its worker in ten seconds, the host rejects waiting operations and removes it. Plugin loading has a 15-second deadline; checks, drawing, frame renders and vector exports have 30 seconds; tools have 120 seconds. A timeout closes the host so the next attempt creates a fresh isolated frame. A browser test serves a blank frame to prove the startup refusal; fake-time tests cover load and draw timeouts. Resource budgets and a user-facing recovery flow are still open in step 4.

Bridge input checks (2026-11-06): unknown worker requests no longer fall through to the check's asset-data capability. Host file requests reject absolute paths, traversal and URL-like paths before invoking the project context; file payloads and network request fields have size and shape bounds. A test sends forged requests during an active check/tool call and verifies that no private data or file action is reached. This does not establish a plugin's identity inside the shared worker: permission separation, replay protection and result limits in step 3 remain open.

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
- [ ] Keep different permission sets separate. One plugin must not impersonate a plugin with approved network access, reuse its active call, or inherit its grants merely because both run in one project worker.
- [ ] Keep provider keys on the trusted side. An approved external action names the service, operation and data; scripts never receive the key itself.

Done when: malformed, forged or replayed messages cannot access another project, broaden a capability or bypass the normal proposal validation.

## Step 4. Bound failure and resource use

- [ ] Add deadlines to loading, checks, tool calls and rendering. The host can terminate and recreate a non-responsive worker; cancellation must not depend on the script cooperating.
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
