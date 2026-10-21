# Installed plugins roadmap

How a user installs a plugin once and uses it everywhere: imported from the settings, kept on their own device, offered in every project to them and to the assistant — then, once tramme has its API, found in a marketplace. Today a plugin lives in a project (`plugins/*.js`), and the shared library (`library-add`, `library-use`, `apps/editor/src/library.ts`) is reached only through commands, and only where a server or the desktop app answers `/api/library`.

Status: steps 1 to 7 done (the share target of step 2 waits); step 8, the marketplace, waits for tramme's API. What is left is listed under each step. Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

A plugin worth having is worth having in every project: a chart pack, a house style, a tool that lays out a company's lower thirds. Copying it by hand into each project, or going through a command to fetch it from the library, is the friction that keeps people from writing plugins at all. And the assistant can only use what the project holds.

Two things must not be lost on the way. A project must still open anywhere — on another device, in the command line, as a `.tramme` archive sent to someone — and every export must stay reproducible. And a plugin installed for every project runs in every project, so the trust it is given must be given knowingly.

## Principles

- **The user's device holds their plugins.** No service is required: the plugins are files on the device, in whatever storage that device offers (see step 1). A server's bucket (R2 in the private deployment) is one storage among others, never the only one. The marketplace, when it comes, lists and serves plugins; it does not keep the user's.
- **One storage contract.** The plugins go through the same `Bucket` contract the projects and the libraries already use (`packages/api/src/bucket.ts`): R2 on the Worker, IndexedDB in the browser, folders in the desktop app. A new storage implements the contract and passes the same suite (`packages/api/test/contract.ts`); nothing above it changes.
- **Install once, the project stays self-contained.** What only acts at authoring time (tools, workflows, checks, kits, presets) is used from the installed plugin. What draws (nodes, effects, modifiers) is copied into the project, at the version used, the moment a layer uses it. The project never depends on what one device has installed.
- **Installed means sandboxed.** An installed plugin runs in every project, so it never runs on the page: its code loads, evaluates and draws only in the per-project worker ([plugin-isolation.md](plugin-isolation.md), [evaluator-sandbox.md](evaluator-sandbox.md)).
- **Trust is given at install, with what it gives.** The install says what the plugin brings and what it may reach, before any of its code runs.

## Steps

### Step 1. Plugins on every device

Where the installed plugins live, per platform:

| Platform | Storage | What the user sees |
|---|---|---|
| Desktop app (Tauri) | A folder: `Documents/Tramme/plugins` by default, changed in the settings like the projects' folder | A real folder: plugins dropped in it appear, a folder synced by the user's own cloud (iCloud Drive, Google Drive, Dropbox, OneDrive) syncs them across computers for free |
| Web, Chrome and Edge on a computer | A folder picked once with the File System Access API (`showDirectoryPicker`), its handle kept in IndexedDB, permission asked again when the browser requires it | The same real folder as the desktop app |
| Web, Firefox and Safari on a computer, and every phone browser | The browser's own storage (IndexedDB, as the personal mode keeps the projects, `apps/editor/src/local/idb.ts`), made persistent (`navigator.storage.persist()`) | No folder: the settings list the plugins, import and export them as files |
| Private deployment | The server's bucket (R2 today), as the library is now | The settings, the same way |
| Mobile app (Tauri, when it comes) | The app's own documents folder: on iOS made visible in the Files app (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`), on Android the app's folder or one picked with the system's picker | A folder in the Files app on iOS; a folder on Android |

- [x] The folder storage for the web: the `Bucket` contract over a `FileSystemDirectoryHandle`, passing the contract suite in Chromium (the command line's headless Chrome runs it). Done: `apps/editor/src/local/folder.ts` (`folderRecords`), passing the contract suite on a fake folder; in Chromium on a real folder it is a device check.
- [x] The storage chosen by what the platform allows, in the order of the table, and named in the settings so the user knows where their plugins are. Done: `apps/editor/src/installed.ts`.
- [x] Persistence asked for where the storage is the browser's, and said plainly where it is not granted (Safari can clear a site's storage after weeks without a visit when it is not installed as an app): the settings then recommend installing the app and exporting a backup.
- [x] Every installed plugin exported as one file (an archive of the plugins) and imported back, so a phone or a browser without folders is never a dead end. Done: `packInstalled` and `unpackInstalled` (`packages/project/src/plugin.ts`).

### Step 2. The Plugins section of the settings

- [x] A "Plugins" section: the installed plugins with their name, version, description, size and what they bring (nodes, effects, modifiers, tools, workflows, checks, kits, presets), each one enabled or disabled, updated or removed.
- [x] Import by the file picker or by dropping files on the section (a `.js` module today, the package of step 7 later). On a phone the file picker reaches the Files app, the downloads and the cloud drives the system offers; a plugin shared to tramme from another app (the system's share sheet, the installed web app's share target) lands here too. Done for the picker and the drop; the share sheet and the installed web app's share target are not done yet.
- [x] The install question before any code runs: what the plugin brings, read from the module's text as the code question already does (`apps/editor/src/importer.ts`), its declared permissions (step 5) and its API version. A plugin of a newer API is refused with the message `Registry.use` already gives.
- [x] An update is an import of a newer version of the same plugin: the section shows what changed in what it brings and in its permissions, and asks again only when the permissions grow.
- [x] On the desktop and on the web with a folder, "Open the folder", and the list follows what is added or removed there. Done: the list is read again when the window comes back.
- [x] The shared library of today becomes this section: `library-add` installs a project's plugin, `library-use` stays for the assistant and the `/` menu, and the server's library is the private deployment's storage of step 1.

### Step 3. Installed plugins in every project

- [x] The registry of a project takes the enabled installed plugins and the project's own (`Registry.use` for both). When both bring the same type or tool name, the project's wins: a project opens the same everywhere. Done: `attachInstalled` (`apps/editor/src/plugins/vocabulary.ts`) loads them in the project's sandbox from blob URLs; built-in names and the project's own are never taken.
- [x] Their tools, workflows, checks, kits and presets are offered in every project: the `/` menu, the add menu, the checks after a change, the kit tool. Done: tools and checks bridged to the sandbox, the rest as the plain data the sandbox declares (`PluginDecl` grew `prompts`, `kits`, `presets`).
- [x] Disabled per project when one is not wanted there, kept in the project's settings. Done: `meta.pluginsOff` (ids), a second switch in the Plugins section while a project is open.

### Step 4. What draws is copied into the project

- [x] When a layer, an effect or a modifier of an installed plugin enters a project (the add menu, a preset, a recipe, the assistant's proposal), the plugin is copied into the project's `plugins/` at the version installed and added to the document's `plugins`, in the same proposal: one undo removes both. Done: any commit (`state.ts`) that draws with a type an installed plugin brought writes `plugins/<file>` (and its own files) first, then applies the change and the copy together; `meta.installedCopies` keeps the version.
- [x] The copy is what the project uses from then on. A newer installed version is offered per project ("this project uses charts 1.2, 1.4 is installed"), never applied on its own, so an export made today is made the same way next year. Done: "Use 1.4 here" in the Plugins section.
- [x] A project opened on a device where the plugin is not installed works as it did: its copy is in it. The command line, which knows nothing of installed plugins, renders it unchanged.
- [x] A tool's result needs no copy: it is operations and files in the project already. A workflow, a check or a kit is not copied either.

### Step 5. Permissions and the sandbox

- [x] Installed plugins never run on the page: a project that uses one previews, stills and exports through the sandbox (the experimental flag of [evaluator-sandbox.md](evaluator-sandbox.md) forced on for it), and its module loads only in the worker. Done: a project with `meta.installedCopies` draws through the sandbox (`sandboxedDoc`), wherever the flag is off; the worker's CSP now allows `eval` (the document's expressions are compiled there; the network stays closed).
- [x] Permissions declared in `meta`: the network origins it may reach at authoring time (the worker's CSP opened to those origins only, closed otherwise), the provider routes it may call with the user's keys (through `api.reach`, never the keys themselves), the project files it may write beyond `assets/`. A plugin that declares none gets none. Done differently for the network: the worker stays closed, and a tool asks the page through `ctx.fetch`, which checks the origin or the provider route the plugin declared (`permitted`, `apps/editor/src/installed.ts`). Writes: `assets/` and the declared paths.
- [x] A plugin that throws or hangs repeatedly is disabled for the session, with its name in the error bar and the settings. Done for throws (three in a row, `counted`); a hang is not timed out, as tools may run long.

### Step 6. The assistant with many plugins

- [x] `use_tool` stays the one generic tool, so the tools sent to the model never change with what is installed and prompt caching keeps working.
- [x] `list_nodes` stops listing everything once the vocabulary grows: a search over names, descriptions and `ai` notes (`list_nodes { query }`), the built-ins and the project's own listed first, the installed plugins found on demand. Done: the installed plugins' entries are counted, not listed, in the index, and found by `list_nodes { query }`.
- [x] The installed plugins named in one line of the system prompt (name and what it is for), so the assistant knows to search for them.

### Step 7. The package and its manifest

- [x] `meta` grows what an installed plugin needs: a stable id (`author/name`), a version (semver), the API range, the permissions of step 5, the licence, the author, a home page. Missing fields keep today's plugins valid: an id is made from the name, the version is `0.0.0`. Done: `manifestOf` (`packages/project/src/plugin.ts`); the API range is the `api` number of today.
- [x] A package format for plugins that carry more than code: `.trammeplugin`, a zip of the module, its translations, its icons, its own assets (fonts, LUTs, images, sounds), checked on import like a `.tramme` archive (`packages/project`). A single `.js` stays valid. Done: `readPluginPackage` / `writePluginPackage`, checked paths and sizes.
- [x] A plugin's own assets copied into the project with the plugin when it draws with them, so step 4's promise holds. Done: beside its module under `plugins/`, where `import.meta.url` finds them.

### Step 8. The marketplace

Once tramme has its API.

- [ ] A catalogue served by the API: plugins with their manifest, screenshots or a short video, versions and changelog. The settings browse it in a "Discover" tab; installing downloads the package into the device's storage of step 1, through the same install question as an import.
- [ ] Publishing: an author account, a package signed with the author's key, the manifest checked, the permissions shown to reviewers. A review before a plugin is listed, at least for those asking for network or keys.
- [ ] Updates: the settings check the installed plugins against the catalogue and offer the new versions, with the change in permissions; never installed without the user.
- [ ] Reporting and revocation: a plugin can be reported from the settings; a revoked version is disabled at the next check, the projects that copied it told so.
- [ ] The assistant can suggest a plugin of the catalogue when nothing installed does what is asked, and installs it only with the user's yes.
