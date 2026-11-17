# Deploying Tramme on Cloudflare

The same Worker runs in one of two modes:

- **Personal** (the public deployment, the next section): anyone uses it without an account. The server keeps nothing: each visitor's projects stay in their browser, their keys in a key vault the editor cannot read, and their browser calls the providers itself.
- **Server** (`pnpm dev`, [Local development](#local-development)): the Worker serves the editor, the projects API (`/api/projects`, R2 storage, simulated locally) and the assistant relay (`/api/claude`), and keeps the providers' keys. It is the mode of development on this machine; it is not deployed. A deployment of it would answer 503 on its API, since it lets in only the requests Cloudflare Access signs (`apps/worker/src/access.ts`).

Configuration: [apps/worker/wrangler.jsonc](../apps/worker/wrangler.jsonc) (the server mode at the top level, the personal mode in `env.personal`). The deployments with accounts (beta, then production) take this same Worker with the accounts backend behind it; they are defined and deployed from the private platform repository.

## Personal mode: a public deployment

Anyone opens the address and works at once: no account, nothing kept on the server, and no key ever stored by you.

### How it works

- **Projects in the browser.** A service worker (`apps/editor/src/sw.ts`) answers the editor's storage routes (`/api/projects`, `/api/library`, `/api/sounds`) from IndexedDB, with the same code the Worker runs on R2 (`packages/api`). The editor does not know the difference. A project is exported as a `.tramme` archive to back it up or move it to another device.
- **Keys in a vault.** The keys live in a page of another origin of your site (`cles.<your domain>`), framed by the editor. The browser keeps the two origins apart: the editor and the projects' plugins cannot read the vault's storage. The keys are typed into the vault's own page (shown in Settings, Providers), never into the editor.
- **Calls from the browser.** The editor asks the vault for a route (`/api/claude`, `/api/llm`, `/api/models`, `/api/generate`…); the vault adds the key and calls the provider itself, straight from the visitor's browser. Anthropic, OpenAI, Gemini, OpenRouter and ElevenLabs take calls from a page; the others (Z.AI, custom providers) go through the Worker's relay (`/relay` on the vault's address), which passes the request on and keeps nothing. The settings say which providers use the relay.
- **What the Worker does.** It serves the editor and the vault's page (with a Content-Security-Policy: framed by the editor only, reaching only the providers above and the relay), and the relay. No R2, no Access, no Workers AI: transcription goes through the vault with the visitor's OpenAI key, or their local companion.
- **Costs.** The static files, and the relay's requests (Workers' free tier, then a few cents per million). Each visitor's provider bills them for their own use.

### Setting it up

1. **A domain of yours on Cloudflare.** The editor and the vault must be two addresses of the same site, for example `tramme.example.com` and `cles.tramme.example.com`. Two `workers.dev` addresses would not do: `workers.dev` is shared by every Cloudflare customer, so browsers treat the vault as a third party and may clear its storage (Safari first).
2. In [apps/worker/wrangler.jsonc](../apps/worker/wrangler.jsonc), under `env.personal`, set the two addresses and the routes:

   ```jsonc
   "vars": { "MODE": "personal", "APP_ORIGIN": "https://tramme.example.com", "VAULT_ORIGIN": "https://cles.tramme.example.com" },
   "routes": [
     { "pattern": "tramme.example.com", "custom_domain": true },
     { "pattern": "cles.tramme.example.com", "custom_domain": true }
   ],
   ```

3. Deploy:

   ```sh
   pnpm exec wrangler login
   pnpm deploy:personal  # builds the editor, then wrangler deploy --env personal
   ```

   Tramme's own app at `app.tramme.dev` is not this deployment: it has accounts, and the private platform repository deploys it (the Worker `tramme`, with the accounts backend behind it) when `main` moves; [.github/workflows/app.yml](../.github/workflows/app.yml) tells it so ([environments](environments.md)). Do not connect the repository to Cloudflare's Workers Builds, on any Worker or the site's (`tramme-site`): it would build every branch, `develop` included, straight to production, past the checks and the launch switch of the workflows.

Any other address of this Worker (its `workers.dev` one, previews) sends to `APP_ORIGIN`. Until both addresses are set, it answers 503.

### What is kept, and where

| | Where | Who can read it |
|---|---|---|
| Projects, libraries | IndexedDB of the editor's address, in the visitor's browser | the visitor, the editor, the projects' plugins |
| Keys, custom providers | IndexedDB of the vault's address, in the visitor's browser | the vault only |
| A request through the relay | nowhere: passed on to the provider | the Worker, while it passes |

The relay's requests carry the key: the Worker's invocation logs are off in this mode (`observability.logs.invocation_logs: false`), and the relay logs nothing. A visitor may send 120 requests a minute through it (`ratelimits`, `RELAY_LIMIT`).

What a malicious plugin of a shared project could still do: spend the visitor's credit by asking the vault for requests, as the editor does. It cannot read a key, nor change one.

### Limits of the personal mode

- Projects belong to one browser on one device: clearing the site's data, or private browsing, loses them. The home screen says so; the browser is asked to keep them (`navigator.storage.persist()`).
- No service worker (some private windows): the editor says it cannot start.
- No transcription from the server: with the visitor's OpenAI key (through the vault), or the local companion.

## Local development

```sh
pnpm dev           # the server mode, on http://localhost:8787/
pnpm dev:personal  # the personal mode: the editor on http://localhost:8787/, the vault on http://127.0.0.1:8787/
```

The Worker runs in `wrangler dev`: R2 simulated in `.wrangler/state` (the bucket name of `wrangler.jsonc` only names the simulated one), the Access check lifted (the `DEV_OPEN` variable, honored only on `localhost`).

### The assistant

The companion starts along, paired with this editor (`TRAMME_NO_COMPANION=1` to go without it): the assistant runs on the login of an agent installed on this machine (Claude Code, Codex with a ChatGPT login, or the Antigravity CLI with a Google login), no key. Another local page is given the pairing token it prints, by hand; Chrome may ask for permission to access the local network the first time. Outside the repository, the same companion is `npx @qualris/tramme`.

Without the companion, an Anthropic key connected in **Settings, Providers** serves the assistant.

### Providers and their keys

The assistant can also use OpenAI, Gemini, OpenRouter or Z.AI (GLM) models, and any service of the OpenAI chat format added as a **custom provider** (name, base URL such as `https://api.deepseek.com/v1`, key). ElevenLabs makes sounds (below).

Keys are connected in the editor: **Settings, Providers**, then *Connect* on a provider and paste its key. The editor sends it once to the Worker, which keeps it in the simulated R2 (`config/keys.json`, beside the projects) and adds it to each request to that provider. The browser never reads it back: it only learns which providers are connected. *Change key* replaces it, *Disconnect* deletes it.

They can also go in `apps/worker/.dev.vars` (ignored by git; template to copy: `apps/worker/.dev.vars.example`). Fill in only the providers you use, then restart `pnpm dev`; a key connected in the settings comes first:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
ZAI_API_KEY=
ELEVENLABS_API_KEY=
```

A provider set this way shows as *Server secret* in the settings: it cannot be disconnected from the editor, only replaced by a key connected there.

Only connected providers show up in the model menu. A custom provider is reached through the Worker. Local models (Ollama, LM Studio) need nothing on the server: the browser calls them directly.

### Sounds made by a provider

The assistant's `generate-sound` tool makes sound effects, music beds and voice-overs at authoring time, saved in the project like any sound. ElevenLabs makes all three; a voice-over can also come from OpenAI or Gemini. Without any of these keys the assistant still has the sound library (recorded sounds shipped with Tramme, the user's own) and the sounds it writes as code. Each provider bills its own use.

### Transcription

The Worker transcribes the speech of sounds and videos with Workers AI (`@cf/openai/whisper-large-v3-turbo`, the `AI` binding declared in `wrangler.jsonc`, about $0.0005 per minute of sound). Workers AI runs at Cloudflare even from `wrangler dev`, which requires you to be logged in, and its use is billed. Without this binding, an OpenAI key connected in the settings transcribes (Whisper); without either, the editor goes through the local companion, which transcribes on the machine.

### Export on the server

`pnpm renderer` starts the renderer of the exports (`apps/renderer`: the command line's render with Chrome and ffmpeg) on port 8080. While it runs, the export panel offers "Export on the server": the project is rendered as the desktop app renders it, one job at a time, and the film lands in its `renders/`. The app tells when it is over (a notification of the system when it is in the background, a message otherwise), after a reload too. With accounts, the same queue renders in a container, and the account's owner is also told by mail. The queue hands the project to the renderer and asks every 15 seconds where it is (the page asks the queue every 4 seconds at first, then less often up to every 30, and once a minute in the background): no request waits for a whole render, so a film of any length outlasts neither the queue's alarm nor the container's sleep. A failed export says its reason (an asset that cannot be read, an issue of the project), never a call stack.

Before deploying anything that touches the exports, `pnpm test:cloud` checks them from end to end on this machine: the Worker's routes, the queue, the real renderer, Chrome and ffmpeg, on the examples, the plugin fixture and a film made as the assistant makes one (voice, sounds, font, PNG and SVG, footage), plain and isolated in the sandbox; each film is checked for its size, frames, duration and sound. `CLOUD_CASES=showreel,assistant pnpm test:cloud` runs some of them.

### Limits of the server mode

- Files of 95 MB at most (the request size Workers accepts); heavier sounds and videos are uploaded in parts (R2 multipart, 32 MiB per part, 4 GiB per file); 2000 files per project.
- A single user, with no accounts or sharing.
- Video exports happen in the browser (WebCodecs). ProRes and long renders go through the command line (`tramme render`, with Chrome and ffmpeg) on a project folder (`tramme unpack` of a downloaded archive).
