# Assistant: message queue, dictation, cost tooling — design

Date: 2026-10-27. Status: agreed in conversation, waiting for review.

## Intent

Tramme's assistant should cost less to run and be easier to talk to, **without changing what the agent does**. Before any optimisation of the agent itself (model, effort, prompt content, tools), Tramme needs the means to measure what every route costs and to remove the waste that does not touch the agent's behaviour. Alongside, two things the user misses when working with the assistant: writing while it works (a message queue) and speaking instead of typing (dictation). Two bugs met on the way are fixed first.

Order of work:

1. Bug: a companion started after the app is not detected without a reload.
2. Bug: the `/` menu is not available in the home page's message box.
3. The message queue.
4. Dictation.
5. Cost tooling.

## Goals

- Every message box that talks to the agent accepts new messages while a turn runs; they wait in a queue, can be deleted until they leave, and leave together when the turn is over.
- A microphone in every message box: what is said is written into the box, the user reads it and sends it.
- The bench can say what any route cost, turn by turn and brief by brief, in tokens and in dollars, and compare two series (before and after a change).
- The waste that does not touch the agent's behaviour is removed.

## Non-goals

- **No change to the agent's behaviour.** The default model, the effort level, the content of the system prompt, the tools, what `get_document` returns, the quality of generated pictures stay as they are. They will be tuned later, on the measures this work makes possible.
- No cost shown to the user in the chat. Costs live in the bench only.
- No live transcription while speaking (words appearing as they are said). The text arrives when the recording stops.
- No dictation that sends by itself.
- Accounts, a backend, credits and the gallery are a separate project with its own design (see the appendix for what was decided so far).

## Anti-goals

- A queued message that leaves with the wrong context ("this layer" pointing at whatever is selected when the queue leaves rather than when it was written).
- Dictation that silently sends the user's voice to a server when they expected the downloaded model.
- A "cost optimisation" that quietly changes the films the agent makes.

## Constraints

- The house rules of the repository hold: every interface string in English and French, a line in `CHANGELOG.md` under `Unreleased`, `npm run typecheck` and `npm test` pass, no model packed in the bundle.
- Colours only from the theme tokens; no decorative patterns (eyebrow labels, step numbers, connector lines).
- Reuse before writing: one microphone control and one queue for every box, not one per box.
- Browser checks run on the trial server (port 8790, repository-local state), never on the user's dev server on 8787.
- The desktop app (Tauri) must get microphone access on Windows and macOS (WebView permission, `NSMicrophoneUsageDescription`).

## 1. Bug: companion started after the app

**What happens.** The user starts the local companion (`tramme agent`) while the desktop app is open; the app does not see it until it is reloaded.

**Probable cause, to confirm by reproducing.** The companion is looked for again only by `useStatusWatch` ([apps/editor/src/ui/chat.tsx:261](../../../apps/editor/src/ui/chat.tsx)), mounted by the assistant panel and the notes, and only while no route answers. On the home page the status is read once (`ensureStatus`, [apps/editor/src/ai/index.ts:195](../../../apps/editor/src/ai/index.ts)); in the editor, once another route works (the server, a key), the companion is never looked for again, so its engines (Claude Code, Codex, Antigravity) stay missing.

**Wanted.** A companion started at any moment shows up within a few seconds, on every screen, whether or not another route already works; one that stops is noticed the same way. The look stays quiet (no "checking" state flashing). Reproduce first, then a test that fails before the fix.

## 2. Bug: `/` on the home page

**What happens.** Typing `/` in the home page's message box offers no command.

**What the code says.** The box has the command menu ([apps/editor/src/ui/Home.tsx:199](../../../apps/editor/src/ui/Home.tsx)): the registry's tools and workflows plus the shipped packs' commands, positioned under the box ([apps/editor/src/screens/home.css:38](../../../apps/editor/src/screens/home.css)). Nothing there explains the failure: reproduce it in the desktop app and in the browser, find the cause, fix it, and add a test.

**Wanted.** On the home page, `/` offers the same commands as in the editor's box (the packs' included), and picking one behaves as it does today when the project starts (`begin` in [apps/editor/src/start.ts](../../../apps/editor/src/start.ts)).

## 3. Message queue

What is common today: Claude Code gathers queued messages and passes them on; Cursor queues and sends them one turn each; ChatGPT and Claude.ai do not let one write during an answer. Tramme gathers them, and sends them when the turn ends (it works the same for every route, the companion's command lines included, which cannot take a message in the middle of a turn).

**Behaviour (decided with the user):**

- While the agent works, every box that sends to it (the conversation's composer, the Studio's direction box, the notes pinned on the picture) keeps accepting messages. The send button stays, next to the stop button.
- A message sent during a turn waits in a queue shown just above the box, in order, each with a button that deletes it. A message that has left can no longer be deleted.
- When the turn ends, every queued message leaves together, in order, as one turn of the agent, with all their attachments.

**Decided by the designer (the user can still overturn them):**

- Each queued message keeps the context of the moment it was written: the time on the timeline, the selection, the scene, the pin on the picture and the layer under it. The agent receives each message with its own context, so "this layer" means the layer selected when it was written.
- In the conversation, the messages show as the separate messages they were written as; the agent receives them as one turn.
- After a stop or a failed turn, the queue stays and does not leave on its own; the queue has a "send now" action.
- A `/` command is not queued: while a turn runs, commands stay unavailable, as today.
- The queue survives a reload of the page (kept per project and conversation). Today's draft (`draft` in [apps/editor/src/attachments.ts](../../../apps/editor/src/attachments.ts)) is not persisted, so this needs its own storage.
- A turn ending with a proposal still waiting for the user's decision: see "Queue and pending proposals" below.

**Left to the builder:** the look of the queue (within the theme and the existing chat components), how the gathered messages are written into the turn's prompt (`userPrompt` takes one context today), the storage of the queue.

## 4. Dictation

**Behaviour (decided with the user):**

- A microphone button in every message box (home, conversation, Studio direction box, notes).
- The user records, stops, and the text is written into the box where the cursor is. Nothing is sent: the user reads, corrects and sends. During a turn, what they send goes to the queue like any message.
- The transcription runs **first on the downloaded Whisper model** (in the browser, or in the companion when it runs), then the server. A setting chooses the source instead: downloaded model (default), companion, server.

**Decided by the designer:**

- The model is the one chosen for transcription in the settings (Models, Transcription: Whisper tiny, base, small or large v3 turbo, [apps/editor/src/models.ts:114](../../../apps/editor/src/models.ts)); one download serves both the media and the dictation.
- With no model downloaded and the setting on "downloaded model", the user is offered the download (Whisper base, 80 MB, suggested) rather than being sent to the server without a word.
- The language is detected, not imposed by the interface's language.
- The recording reuses the existing pipeline of [apps/editor/src/speech.ts](../../../apps/editor/src/speech.ts) (16 kHz mono chunks of 28 s, the same backends), so a long dictation works like a long sound.
- Recording shows that it records (elapsed time, a level) and can be cancelled (Escape) without writing anything.

**Left to the builder:** click-to-start/click-to-stop or hold-to-talk (click to start and stop is the suggestion), the keyboard shortcut, where the setting sits in the settings.

## 5. Cost tooling

### Measure every route

Each turn already ends with a usage line kept in the conversation (`.tramme/chats/*.json`), read by [bench/usage.ts](../../../bench/usage.ts). Today it is complete for Claude through the server and the companion's Agent SDK, and for Codex (`cached_input_tokens`). Missing:

- **The chat-format routes** (OpenAI, Gemini, OpenRouter, Z.AI, custom providers, local servers) report no usage at all. Ask for it (`stream_options: { include_usage: true }`) and read what each returns: prompt and completion tokens and the cached share where given (`prompt_tokens_details.cached_tokens` and the providers' equivalents). A server that refuses the option drops it, through the existing mechanism for refused request parts (`REFUSED` in [apps/editor/src/ai/server.ts](../../../apps/editor/src/ai/server.ts)).
- **Antigravity** reports nothing: record what its stream exposes, and mark the turn's usage as unknown rather than zero.
- **Claude's cache writes** are kept as one figure; split them by lifetime (5 minutes or 1 hour, from `cache_creation` in the Messages API's usage), since they are not priced the same.
- Each usage line names its route and provider, so the bench can price it.

### The bench prices and compares

- A price table per model (input, cache read, cache write 5 min and 1 h, output), kept in the bench. A model missing from the table gives "unknown", not zero. Usage is kept per turn, not per request, so Haiku 5.5's higher rate past 100 K tokens of prompt cannot be applied: its cost is reported as a lower bound (designer's call).
- `bench/usage.ts` adds the dollar cost per turn, per conversation and in all, and the share read from the cache.
- A comparison of two series of runs (two folders: before and after) on the same briefs: cost, cache share, tokens written, time.
- Costs are shown in the bench only, never in the chat.

### Remove the waste that does not touch behaviour

- **The system prompt in the right order.** The same text, reordered: the fixed part (the instructions, then the reference `docs/document.md`) first, with its own cache breakpoint, then the parts that change (the installed plugins, the packs line, the project's brief). Today the changing parts come before the reference ([packages/assistant/src/index.ts:378](../../../packages/assistant/src/index.ts)), so the reference is never served from the cache across projects. The chat-format routes and the companion get the same order (OpenAI and Gemini cache a stable prefix by themselves). Measured on the bench before and after: the films should not change.
- **The conversation's cache lifetime becomes a setting**: 5 minutes (default, today's) or 1 hour. The system prompt keeps its hour. A 1-hour write costs more, so the default stays until the bench says otherwise.
- **Haiku 5.5 in the model list**, next to Haiku 4.5 (the default model does not change). It takes adaptive thinking and effort levels; it has no server-side fallback, so none is sent for it.

**Left to the builder:** the shape of the price table and of the comparison report, the name and place of the cache setting.

## Queue and pending proposals (designer's call)

A turn often ends with a proposal waiting for the user to apply or reject it, and today a proposal without an answer is dropped at the next message. The queue therefore waits: it leaves once the turn has ended **and** no proposal waits for a decision (applied or rejected, or applied on its own when the settings apply changes automatically). The queue says it is waiting for that decision.

## Appendix: accounts, decided so far (separate project)

Recorded so the conversation is not lost; this design does not build any of it.

- Accounts and a backend so a user finds their projects, resources and conversations on any device.
- A Meshy-like product for motion design: credits, subscriptions, a gallery; each project switches between public and private.
- Tramme pays an existing model behind the accounts, most likely Claude. The custom providers (the user's own keys) stay as they are and cost no credits.
- At first the browser stays open while the agent works; continuing the work on the server comes later (it needs the server to edit and render a project, since the agent's tools run in the editor today).
- Credit prices are still to calibrate on the bench's measures; the working proposal was about 100 credits to 1 €, a draft on a small model then a finish on a larger one, failed generations refunded.
