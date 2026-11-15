# Tramme companion

The assistant of the [Tramme]({{site}}) editor, run by an agent of your computer on your own subscription: **Claude Code**, **Codex** (ChatGPT) or **Antigravity** (Google).

## Start it

With [Node.js](https://nodejs.org) 20 or later installed:

```sh
npx @qualris/tramme
```

To start it with `tramme` alone, install it once:

```sh
npm install -g @qualris/tramme
tramme
```

Leave the window open while you work. The Tramme app and the desktop app find the companion and pair with it by themselves; the assistant's model menu then lists the agents of this computer.

## The agents

- **Claude Code** comes with the companion. Sign in once with `npx @anthropic-ai/claude-code`, then `/login`.
- **Codex**: install it with `npm install -g @openai/codex`, then `codex login`. The Codex app and its editor extension work too.
- **Antigravity**: install it with `irm https://antigravity.google/cli/install.ps1 | iex` (Windows) or `curl -fsSL https://antigravity.google/cli/install.sh | bash` (macOS, Linux), then run `agy` once to sign in.

Each agent gets the editor's tools and nothing else: no shell, no files of your computer, no web search.

## Options

```text
tramme [--origin <url>,…] [--port 4317] [--renew]
```

The same options follow `npx @qualris/tramme`.

- `--origin` pairs another editor address by itself.
- `--port` changes the port (the companion listens on 127.0.0.1 only).
- `--renew` makes a new pairing token.

The first transcription with the companion installs local speech recognition once (about 150 MB, in `~/.tramme/whisper`).

## Licence

[FSL-1.1-ALv2](./LICENSE), by Qualris.
