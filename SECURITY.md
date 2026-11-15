# Security policy

## Supported versions

Tramme is young: only the latest release and the `main` branch receive security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab, then **Report a vulnerability**. Include what you found, how to reproduce it, and the impact you expect. You should get a first answer within a week.

Once a fix is ready, it is released and the advisory is published, with credit to the reporter unless they prefer otherwise.

## Scope and known limits

Some behaviors are documented limits, not vulnerabilities:

- **Expressions are not a security sandbox.** They are isolated to stay deterministic, but a document from an unknown source should be evaluated in a worker.
- **Project plugins and expressions run in the editor.** A project imported from someone else can carry JS modules (nodes, effects, modifiers) and expressions that run with the page's rights. The import asks first: it inventories the code of the archive (the plugins with their file and size, the expressions with their first addresses) and nothing runs before the answer, the default being the refusal — a refusal writes nothing to storage. The editor's own examples skip the question. What remains after the yes: the code still runs with the page's rights, so only accept projects from someone you trust.
- **The server mode is for local development.** It has no user accounts and is not deployed; deployed, its API answers only requests signed by Cloudflare Access (see `docs/deploy.md`).
- **The local companion (`npx @qualris/tramme` or `tramme`, `tramme agent` in the repository)** listens on `127.0.0.1` only, accepts the Tramme app of its environment, the desktop app, the origins given with `--origin` and localhost, and requires a pairing token, which only those named origins receive by themselves. Reports that bypass any of these are in scope.

## Secrets

API keys are connected in the editor's Settings, Providers. In personal mode they stay in the key vault, in the visitor's browser. Signed in to an account, the Worker keeps them sealed (AES-GCM) under the account. In the local server mode, the Worker keeps them in the simulated R2 (`config/keys.json`), or they are lines of a `.dev.vars` file ignored by git. In every case the browser never reads them back: it only learns which providers are connected. Never commit them.
