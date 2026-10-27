# Assistant queue, dictation and cost tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two assistant bugs, add a message queue and dictation to every message box, and give the bench what it needs to price and compare every assistant route, without changing what the agent does.

**Architecture:** The queue is one module (`apps/editor/src/ai/queue.ts`) that `send()` falls back to while a turn runs; it is shown by one component inside the shared `Composer`, so the conversation, the Studio and the notes get it at once. Dictation is one recorder module plus one `MicButton`, transcribing through the existing pipeline of `speech.ts`. Cost tooling extends the `Usage` record that every route already reports, makes the missing routes report it, and prices it in the bench only.

**Tech Stack:** TypeScript, Preact + signals, Vitest (+ happy-dom where a test needs the DOM), Web Audio / MediaRecorder, Tauri 2 (desktop), the Messages API and the OpenAI chat format.

**Spec:** [docs/superpowers/specs/2026-10-27-assistant-queue-dictation-and-cost-tooling-design.md](../specs/2026-10-27-assistant-queue-dictation-and-cost-tooling-design.md). Read it first: its non-goals bind every task.

## Global Constraints

- **No change to the agent's behaviour:** the default model (`claude-opus-5-5`), `DEFAULT_EFFORT` (`high`), the wording of the system prompt, the tools and their results, image quality all stay as they are. Task 10 only reorders the same system prompt text.
- Costs are shown in the bench only, never in the chat.
- Every interface string in English and French (`apps/editor/src/i18n/en.json` and `fr.json`; `apps/editor/test/i18n.test.ts` checks both have the same keys).
- Colours only from theme tokens (`apps/editor/src/theme/tokens.css`); no eyebrow labels, step numbers or connector lines. Reuse the existing classes (`icon-btn`, `file-chip`, `btn sm`) before adding CSS.
- No model packed in the bundle.
- Work on a branch `feat/assistant-queue-dictation-cost` from `develop`. Conventional Commits. **No `Co-Authored-By` line and no mention of Claude** in commits.
- Gate before each commit: the task's tests pass. Gate before the last commit: `npm run typecheck` and `npm test` pass.
- A line in `CHANGELOG.md` under `Unreleased` for each user-visible change (Task 14 gathers them).
- Browser checks, if any, on the trial server (port 8790, repository-local state), never on port 8787.

## Review Focus

1. **Sending with a stopped queue.** After stop, the queue stays; when the user then sends a new message (no turn running), the queued messages leave first, then the new one, in the same turn. Test in Task 4.
2. **Microphone refused or missing.** Permission denied or no input device: a toast says so, nothing is written, the button returns to rest. Test in Task 7.
3. **Silence or a tap.** A recording under 0.5 s, or one whose transcription is empty, writes nothing and shows no error. Test in Task 7.
4. **A chat-format server that refuses `stream_options`.** The request is sent again without it and the turn goes on; the usage is then marked unknown. Test in Task 9.
5. **A companion that hangs.** The watcher never starts a second look while one is in flight, so a `/health` that waits its 20 s timeout does not pile up requests. Test in Task 1.

---

### Task 1: The companion is found whenever it starts

**Files:**
- Modify: `apps/editor/src/ai/index.ts` (around `refreshStatus`, line 231)
- Modify: `apps/editor/src/ui/chat.tsx:260-268` (`useStatusWatch`)
- Modify: `apps/editor/src/main.tsx` (start the watcher once)
- Test: `apps/editor/test/companion-watch.test.ts`

**Interfaces:**
- Produces: `watchCompanion(): () => void` in `apps/editor/src/ai/index.ts`, returning a function that stops it. `useStatusWatch` keeps its signature but no longer polls (it only runs the first `refreshStatus()`).

- [x] **Step 1: Write the failing tests.** Stub `fetch` so `/health` fails, then answers as the companion does (read `probeCompanion` in `apps/editor/src/ai/companion.ts` for the shape). Use `vi.useFakeTimers()`.
  - `finds a companion started after the app, even when another route works`: `aiStatus.value.server = true` first; start `watchCompanion()`; `/health` fails, advance 4 s, then `/health` answers; advance 4 s; expect `aiStatus.value.companion === 'ok'`.
  - `notices a companion that stops`: from `ok`, `/health` fails; advance 15 s; expect `companion !== 'ok'`.
  - `never looks twice at once`: `/health` never settles; advance 60 s; expect the `/health` fetch called once.
  - `looks again when the window regains focus`: dispatch `focus` on `window`; expect one more `/health` call.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/companion-watch.test.ts`. Expected: FAIL (`watchCompanion` is not exported).
- [x] **Step 3: Implement `watchCompanion()`.**
  - It calls `refreshStatus(true)` every 4 s while `aiStatus.companion !== 'ok'`, and every 15 s once it is `ok`.
  - It also looks again on the window's `focus` event.
  - It skips a tick while a look is in flight.
  - It runs whatever `aiRoute` is.
  - Start it once in `main.tsx`, which covers the home page and the editor.
  - Remove the interval from `useStatusWatch`.
- [x] **Step 4: Run the test**, then `npx vitest run apps/editor/test`. Expected: PASS.
- [x] **Step 5: Commit** `fix(assistant): find the local companion whenever it starts`.

### Task 2: `/` on the home page

**Files:**
- Investigate: `apps/editor/src/ui/Home.tsx:188-247` (`DirectionBox`), `apps/editor/src/ui/composer.tsx:33-53` (`useCommandMenu`), `apps/editor/src/screens/home.css:33-38`, `apps/editor/src/packs.ts:37` (`shippedPacks`)
- Test: `apps/editor/test/home-commands.test.ts`

**Interfaces:** none new, unless the cause calls for one.

- [x] **Step 1: Find the cause** with superpowers:systematic-debugging before changing anything.
  - Render `DirectionBox` (it is not exported: export it for the test) with happy-dom, type `/` into its textarea, and look for `.command-menu` rows.
  - The code is supposed to offer `listCommands(S.registry.value)` (the editor registry has tools and prompts) plus the packs' commands.
  - Candidates to rule out:
    - the menu renders but is clipped or covered (`.hero`, `.brief-box`, the cards below);
    - `typed()` and `keyDown` never fire;
    - `S.registry` is empty at that moment in the desktop app;
    - `shippedPacks()` fails under the desktop app's protocol.
  - If the cause shows only in the running app, say so in the report, with what you found, rather than guessing.
- [x] **Step 2: Write the failing test** `offers the commands on the home page`: render the box, input `/`, expect at least one `.command-row` and the row of a built-in prompt (for example `/analyze`) present.
- [x] **Step 3: Run** `npx vitest run apps/editor/test/home-commands.test.ts`. Expected: FAIL for the reason found in step 1.
- [x] **Step 4: Fix the cause.**
- [x] **Step 5: Run the test.** Expected: PASS.
- [x] **Step 6: Commit** `fix(home): offer the / commands in the home box`.

### Task 3: A prompt for messages sent together

**Files:**
- Modify: `packages/assistant/src/index.ts:401-412` (next to `userPrompt`)
- Test: `packages/assistant/test/prompt.test.ts`

**Interfaces:**
- Produces: `export function queuedPrompt(messages: { text: string; ctx: TurnContext }[], notes: string[]): string`. With one message it returns exactly `userPrompt(messages[0].text, messages[0].ctx, notes)`.

- [x] **Step 1: Write the failing tests.**
  - `one message is the usual prompt`: `queuedPrompt([m], notes) === userPrompt(m.text, m.ctx, notes)`.
  - `several messages keep their order and their own context`:
    - two messages with different `selection` and `time`;
    - each text appears once, the first before the second;
    - each message's `Selection:` line appears next to its own text;
    - the notes appear once, before the first message;
    - the result says the messages were written while the agent worked and are answered together.
  - `the autonomous line appears once`, when any `ctx.autonomous` is set.
- [x] **Step 2: Run** `npx vitest run packages/assistant/test/prompt.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement `queuedPrompt`.**
  - Start with one opening `<context>` holding the notes (and `AUTONOMOUS` when set).
  - Then each message as `<message n="i">` holding its own `<context>` lines (composition, selection, scene, point; the same lines `userPrompt` builds, factored out rather than copied) and its text.
- [x] **Step 4: Run the test.** Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): one prompt for messages written during a turn`.

### Task 4: The queue

**Files:**
- Create: `apps/editor/src/ai/queue.ts`
- Modify: `apps/editor/src/ai/conversation.ts:87-106` (`send`), `:117-165` (`consume`), `:207-218` (`decide`)
- Modify: `apps/editor/src/ai/index.ts:371` (`AskPayload`), `:395-417` (`ask`), `:272` (`parse`), `:359-369` (`saveChat`)
- Test: `apps/editor/test/queue.test.ts`

**Interfaces:**
- Consumes: `queuedPrompt` (Task 3).
- Produces, in `apps/editor/src/ai/queue.ts`:
  - `export interface Queued { id: string; text: string; context: string; data: Record<string, unknown>; at: number; anchor?: Anchor; attachments: Attachment[] }`. `context` is the line shown and `data` is `contextLine().data`, both taken when the message is written.
  - `export const queue: Signal<Queued[]>`
  - `export function enqueue(text: string, anchor?: Anchor): void`. It takes `pending` attachments as `send` does.
  - `export function dequeue(id: string): void`
  - `export const queueWaits: ReadonlySignal<'turn' | 'decision' | 'stopped' | null>`, which tells why the queue has not left.
  - `export function flushQueue(extra?: { text: string; anchor?: Anchor }): Promise<void>`
- `AskPayload` gains `queued?: { text: string; context: TurnContext }[]`. When set, `ask` builds the prompt with `queuedPrompt` and joins every message's attachments.

- [x] **Step 1: Write the failing tests.** Stub `ask` (or `consume`'s source) to record the payload.
  - `a message sent during a turn waits`: with `running.value = true`, `send('b')` adds one item to `queue` and calls no `ask`.
  - `the queue leaves when the turn ends, as one turn, in order`: two queued; the turn ends without error and without a pending proposal. Expect:
    - one `ask` whose `queued` texts are `['b', 'c']`;
    - two user items appended to `chat`, in that order, each with its own `context`;
    - `queue` empty.
  - `each message keeps the selection it was written with`: change `S.selection` between the two `send`s; the two `queued[i].context.selection` differ.
  - `it waits for the decision on a pending proposal`: the turn ends with `S.proposal.status === 'pending'`. Expect no `ask` and `queueWaits === 'decision'`. Then `decide(true)`, and expect one `ask`.
  - `a stopped turn keeps the queue`: abort, then expect no `ask` and `queueWaits === 'stopped'`. `flushQueue()` sends it.
  - `a new message after a stop leaves with the queue` (Review Focus 1): stopped with `['b']` queued, then `send('d')` with no turn running. Expect one `ask` with texts `['b', 'd']`.
  - `a deleted message never leaves`: `dequeue(id)` before the end of the turn, and it is absent from `queued`.
  - `the queue is kept with the conversation`: `saveChat` writes `queue`, and `parse` reads it back.
  - `a command is not queued`: `send` with `opts.command` while running adds nothing.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/queue.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - `send`:
    - while `running`, it enqueues (commands excepted, which return as today);
    - when not running and the queue is not empty, it calls `flushQueue({ text, anchor })`.
  - `consume`'s `finally`: when not aborted and without error, it calls `flushQueue()` if nothing waits for a decision.
  - `decide`: after a decision, it calls `flushQueue()` when the queue is not empty and no turn runs.
  - The conversation file carries `queue`.
  - `autonomous` is computed when the queue leaves.
- [x] **Step 4: Run the test**, then `npx vitest run apps/editor/test`. Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): queue the messages written during a turn`.

### Task 5: The queue in the message boxes

**Files:**
- Create: `apps/editor/src/ui/QueueList.tsx`
- Modify: `apps/editor/src/ui/composer.tsx:132-200` (`Composer`)
- Modify: `apps/editor/src/ui/Studio.tsx` (the direction box must stay usable while a turn runs; check line 61 and around 143-190)
- Modify: `apps/editor/src/screens/conversation.css`, `apps/editor/src/i18n/en.json`, `apps/editor/src/i18n/fr.json`
- Test: `apps/editor/test/queue-ui.test.ts`

**Interfaces:**
- Consumes: `queue`, `dequeue`, `queueWaits`, `flushQueue` (Task 4).
- Produces: `export function QueueList(): JSX.Element | null`. It renders nothing when the queue is empty.

- [x] **Step 1: Write the failing tests** (happy-dom).
  - `shows the queued messages above the box, each with a delete button`: two queued, so two rows. Clicking the first row's delete leaves one.
  - `says why it waits`: with `queueWaits` `'decision'`, the waiting-for-decision string. With `'stopped'`, a "send now" button that calls `flushQueue`.
  - `the box accepts a message during a turn`: with `running` true, the send button is enabled when text is typed, and the stop button is present too.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/queue-ui.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - `Composer` renders `QueueList` above `.composer`.
  - While busy, it shows both the stop and the send buttons. Send stays disabled while a command is typed, as today.
  - Rows reuse the `file-chip` look for attachments. Message text is clipped to two lines.
  - New strings go in both locales: queue title, waiting for the turn, waiting for a decision, send now, delete.
- [x] **Step 4: Run the test**, then `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): show the queue in every message box`.

### Task 6: Transcribing samples

**Files:**
- Modify: `apps/editor/src/speech.ts:60-125`
- Test: `apps/editor/test/speech-chunks.test.ts`

**Interfaces:**
- Produces:
  - `export function chunkStarts(duration: number): number[]`, extracted from `transcribeUrl`, which now uses it.
  - `export type DictationSource = 'local' | 'companion' | 'server'`
  - `export async function transcribeSamples(samples: Float32Array, source: DictationSource): Promise<string>`. It takes 16 kHz mono samples, cuts them with `chunkStarts`, and joins the merged words with spaces.
    - `'local'` runs `wordsOf(..., 'browser')`;
    - `'companion'` runs `'companion'`;
    - `'server'` runs the existing `'server'` chain.

- [x] **Step 1: Write the failing tests.**
  - `chunkStarts`: `chunkStarts(10)` is `[0]`, `chunkStarts(28)` is `[0]`, `chunkStarts(30)` is `[0, 26]`, `chunkStarts(60)` is `[0, 26, 52]`.
  - `transcribeSamples` with `wordsOf` mocked (export it for the test, or inject it): 40 s of samples make two calls with the source's backend. The text is the merged words in order, with the overlap counted once.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/speech-chunks.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.** `transcribeUrl` keeps its behaviour and uses `chunkStarts`.
- [x] **Step 4: Run the test**, then `npx vitest run apps/editor/test/perception.test.ts packages/cli/test/speech.test.ts`. Expected: PASS.
- [x] **Step 5: Commit** `refactor(speech): transcribe samples, chunk starts shared`.

### Task 7: Dictation

**Files:**
- Create: `apps/editor/src/dictation.ts`, `apps/editor/src/ui/MicButton.tsx`
- Modify: `apps/editor/src/settings.ts` (the `Preferences` type and `DEFAULT_PREFERENCES`)
- Modify: `apps/editor/src/ui/Settings.tsx` (next to the transcription model choice)
- Modify: `apps/editor/src/ui/composer.tsx` (the bar), `apps/editor/src/ui/Home.tsx:229-240` (the brief bar)
- Modify: the desktop app's microphone permission: `apps/desktop/src-tauri` (Info.plist `NSMicrophoneUsageDescription`; check the Windows WebView2 permission handling)
- Modify: i18n `en.json`, `fr.json`
- Test: `apps/editor/test/dictation.test.ts`

**Interfaces:**
- Consumes: `transcribeSamples`, `DictationSource` (Task 6); `chosenModel('transcription')`; `askUser` (`apps/editor/src/confirm.ts`).
- Produces:
  - `Preferences.dictation: DictationSource`, defaulting to `'local'`;
  - `export function insertAtCursor(value: string, start: number, end: number, add: string): { value: string; caret: number }`. It puts one space between words when needed;
  - `export const recording: Signal<{ since: number; level: number } | null>`;
  - `export async function startDictation(): Promise<void>`;
  - `export async function stopDictation(): Promise<string>`, which returns `''` for nothing heard;
  - `export function cancelDictation(): void`;
  - `export function MicButton(props: { onText: (text: string) => void; disabled?: boolean }): JSX.Element`.

- [x] **Step 1: Write the failing tests.**
  - `insertAtCursor`:
    - `('hello', 5, 5, 'world')` gives `{ value: 'hello world', caret: 11 }`;
    - `('', 0, 0, 'hi')` gives `{ value: 'hi', caret: 2 }`;
    - a selection is replaced.
  - `a refused microphone says so and writes nothing` (Review Focus 2): `navigator.mediaDevices.getUserMedia` rejects with `NotAllowedError`. Expect a toast, `recording` null, `onText` never called.
  - `a tap writes nothing` (Review Focus 3): a recording shorter than 0.5 s resolves `''` without calling `transcribeSamples`. An empty transcription also resolves `''`.
  - `the downloaded model is offered before its first download`: source `'local'`, model not in the cache. Expect `askUser` called with the model's size. Declined: nothing transcribed.
  - `the setting picks the source`: with `prefs.dictation` set to `'server'`, `transcribeSamples` receives `'server'`.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/dictation.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - Record with `getUserMedia({ audio: true })` and `MediaRecorder`.
  - Show the level from an `AnalyserNode`.
  - At stop, decode the blob and render it to 16 kHz mono with an `OfflineAudioContext`, like `chunkAudio`.
  - `MicButton`:
    - click starts, click again stops;
    - Escape cancels;
    - while recording, the elapsed time and the level show;
    - while transcribing, a spinner.
  - Put it in the `Composer` bar (inserting at the textarea's cursor) and in the home brief bar.
  - A dictated message sent during a turn goes to the queue through the normal send.
  - The setting goes in the settings next to the transcription model, with three choices: downloaded model, companion, server.
- [x] **Step 4: Run the test**, then `npx vitest run apps/editor/test`. Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): dictate a message, on the downloaded model first`.

### Task 8: Usage: cache writes by lifetime, and a turn's unknown usage

**Files:**
- Modify: `packages/assistant/src/index.ts:420-449` (`Usage`, `NO_USAGE`, `addUsage`, `UsageMeter`)
- Modify: `apps/editor/src/api.ts:44` (`TurnUsage`)
- Modify: `apps/editor/src/ai/index.ts:441-464` (the usage item of `ask`)
- Test: `packages/assistant/test/usage.test.ts`, `apps/editor/test/server-session.test.ts`

**Interfaces:**
- Produces:
  - `Usage` gains `cacheWrite1h: number`, the share of `cacheWrite` kept an hour. It is `0` in `NO_USAGE`, and `addUsage` sums it.
  - `TurnUsage` gains `route: 'server' | 'chat' | 'companion' | 'local'` and `unknown?: true`. `unknown` is set when the turn received no `usage` event.

- [x] **Step 1: Write the failing tests.**
  - `UsageMeter reads the 1-hour cache writes`: `message_start` with `usage: { input_tokens: 10, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 }, output_tokens: 1 }` gives `cacheWrite: 300, cacheWrite1h: 200`.
  - `addUsage sums cacheWrite1h`.
  - In the server-session test, the usage of a turn carries `route: 'server'`.
- [x] **Step 2: Run** `npx vitest run packages/assistant/test/usage.test.ts apps/editor/test/server-session.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
  - `ask` sets `route` from the route it took. It sets `unknown: true` when no `usage` event arrived.
  - The Codex usage in `packages/cli/src/agents.ts:296` sends `cacheWrite1h: 0`.
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): record cache writes by lifetime and the route of each turn`.

### Task 9: Usage of the chat-format routes

**Files:**
- Modify: `apps/editor/src/ai/compat.ts:76-124` (`ChatReader`)
- Modify: `apps/editor/src/ai/server.ts:50-61` (`Part`, `REFUSED`), `:359-391` (`chat`)
- Test: `apps/editor/test/compat.test.ts`, `apps/editor/test/server-session.test.ts`

**Interfaces:**
- Produces: `ChatReader.usage(): Usage | null`. It reads the last event's `usage`:
  - `prompt_tokens` minus the cached share, as `input`;
  - the cached share as `cacheRead`, from `prompt_tokens_details.cached_tokens` (OpenAI and OpenRouter) or from `cached_tokens` at the top (other providers);
  - `completion_tokens` as `output`;
  - `requests: 1`.
  - It returns `null` when no event carried a usage.
- A new refusable `Part` named `'usage'`, matched by `/stream_options|include_usage/i`.

- [x] **Step 1: Write the failing tests.**
  - `ChatReader reads the usage of the last chunk`: a stream whose last event is `{ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } }` gives `{ requests: 1, input: 200, cacheRead: 800, cacheWrite: 0, cacheWrite1h: 0, output: 50 }`. Note that `push` must not skip an event without `choices` before reading its usage.
  - `the chat route asks for the usage`: the request body has `stream_options: { include_usage: true }`, and the turn yields a `usage` event.
  - `a server refusing stream_options` (Review Focus 4): the first answer is a 400 naming `stream_options`. The request is sent again without it, the turn ends normally, and no `usage` event is yielded.
- [x] **Step 2: Run** `npx vitest run apps/editor/test/compat.test.ts apps/editor/test/server-session.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the tests.** Expected: PASS.
- [x] **Step 5: Commit** `feat(assistant): read the usage of the chat-format providers`.

### Task 10: The system prompt in cache order

**Files:**
- Modify: `packages/assistant/src/index.ts:308-379` (`systemPrompt`)
- Modify: `apps/editor/src/ai/index.ts:418-439` (where the system prompt is built and passed)
- Modify: `apps/editor/src/ai/server.ts:322` (`turn`), `:394-431` (`attempt`), `:359` (`chat`)
- Test: `packages/assistant/test/system.test.ts`, `apps/editor/test/server-session.test.ts`

**Interfaces:**
- Produces:
  - `export interface SystemParts { fixed: string; variable: string }`;
  - `export function systemParts(reference: string, brief?: string, installed?: string[]): SystemParts`;
  - `systemPrompt(...)` keeps its signature and returns `fixed + variable` joined.
- `fixed` is today's instructions followed by `reference`. `variable` is today's installed-plugins paragraph and brief paragraph. Not one word changes: only `reference` moves before them.
- `ServerSession.turn(prompt, model, system: string | SystemParts, ...)`. The packs line is added by `ask` to the installed list as today, so it stays in `variable`.

- [ ] **Step 1: Write the failing tests.**
  - `the fixed part holds no project`: `systemParts(REF, 'BRIEF', ['plug: x'])`. `fixed` contains `REF` and contains neither `BRIEF` nor `plug: x`.
  - `same words, reference first`: the multiset of paragraphs of `systemPrompt(REF, 'BRIEF', ['plug: x'])` equals that of the previous implementation. Keep a copy of today's function in the test as the oracle. `indexOf(REF) < indexOf('BRIEF')`.
  - `the server sends two system blocks, the fixed one cached`: given `SystemParts`, the request's `system` is `[{ text: fixed, cache_control: { type: 'ephemeral', ttl: '1h' } }, { text: variable }]`. With an empty `variable`, one block.
  - `a string system still works`: the existing server-session tests pass unchanged.
- [ ] **Step 2: Run** `npx vitest run packages/assistant/test/system.test.ts apps/editor/test/server-session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The chat-format route and the companion receive the joined string.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `perf(assistant): system prompt in cache order, its fixed part cached apart`.

### Task 11: The conversation's cache lifetime as a setting

**Files:**
- Modify: `apps/editor/src/ai/index.ts:28-48` (`AiSettings` and its defaults)
- Modify: `apps/editor/src/ai/server.ts` (`TurnOptions`, `attempt` lines 402-404)
- Modify: `apps/editor/src/ui/Settings.tsx` (the assistant section), i18n `en.json`, `fr.json`
- Test: `apps/editor/test/server-session.test.ts`

**Interfaces:**
- Produces: `AiSettings.cacheTtl: '5m' | '1h'`, defaulting to `'5m'`, and `TurnOptions.cacheTtl?: '5m' | '1h'`. `ask` passes it.

- [ ] **Step 1: Write the failing test** `the conversation's cache lasts as set`. With `cacheTtl: '1h'`, the last message block's `cache_control` is `{ type: 'ephemeral', ttl: '1h' }`. With `'5m'` or unset, it is `{ type: 'ephemeral' }`. When the `hour` part was refused, there is never a `ttl`.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/server-session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, with the setting in the assistant settings, in both locales. Say in its description that an hour costs more to write and less when the user comes back after more than five minutes.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): the conversation's cache lifetime as a setting`.

### Task 12: Haiku 5.5

**Files:**
- Modify: `packages/assistant/src/index.ts:8-15` (`MODELS`, `ADAPTIVE`)
- Modify: `apps/editor/src/ai/server.ts:414-416` (fallbacks)
- Test: `packages/assistant/test/models.test.ts`, `apps/editor/test/server-session.test.ts`

**Interfaces:**
- Produces: `['claude-haiku-5-5', 'Haiku 5.5']` in `MODELS`, placed after Sonnet 5.5 and before Haiku 4.5. `ADAPTIVE` includes it. `export const NO_FALLBACK = new Set(['claude-haiku-5-5'])`. `DEFAULT_MODEL` is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `Haiku 5.5 is offered, the default unchanged`: it is in `MODELS`, `DEFAULT_MODEL === 'claude-opus-5-5'`, and `effortLevels('claude-haiku-5-5')` has five levels.
  - `no fallback is asked for Haiku 5.5`: a request with that model has neither the `server-side-fallback` beta nor `fallbacks`, and has `thinking: { type: 'adaptive', ... }`.
- [ ] **Step 2: Run** `npx vitest run packages/assistant/test/models.test.ts apps/editor/test/server-session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): Haiku 5.5 in the model list`.

### Task 13: The bench prices and compares

**Files:**
- Create: `bench/cost.ts` (pure functions), `bench/prices.ts` (the table)
- Modify: `bench/usage.ts`, `bench/README.md`, `vitest.config.ts` (add `'bench/**/*.test.ts'` to `include`)
- Test: `bench/cost.test.ts`

**Interfaces:**
- Consumes: `Usage`, `TurnUsage` (Task 8).
- Produces:
  - `export interface Price { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; lowerBound?: boolean }`, in dollars per million tokens;
  - `export const PRICES: Record<string, Price>`;
  - `export function costOf(u: TurnUsage): { dollars: number; lowerBound: boolean } | null`. It returns `null` for an unknown model or an `unknown` usage;
  - `export function cacheShare(u: Usage): number`, which is `cacheRead / (input + cacheRead + cacheWrite)`, and 0 when nothing was read;
  - `export function compare(before: TurnUsage[], after: TurnUsage[]): { before: Totals; after: Totals; change: Totals }`, with `Totals = { dollars: number | null; cacheShare: number; output: number; ms: number }`.
- Prices (Anthropic first-party, cached 2026-10-06; check them against the live pricing page before committing). Cache writes are 1.25× input for 5 minutes and 2× input for an hour.

  | Model | Input | Cache read | Output |
  |---|---|---|---|
  | `claude-opus-5-5` | 4 | 0.20 | 20 |
  | `claude-sonnet-5-5` | 2 | 0.20 | 10 |
  | `claude-haiku-5-5` (`lowerBound: true`: its higher rate past 100 K tokens of prompt cannot be applied per turn) | 0.10 | 0.01 | 0.50 |
  | `claude-haiku-4-5-20251001` | 1 | 0.10 | 5 |

  No other provider's prices: their models give `null` until someone adds them.

- [ ] **Step 1: Write the failing tests.**
  - `costOf prices each part`: Opus 5.5 with `input 1e6, cacheRead 1e6, cacheWrite 1e6, cacheWrite1h 4e5, output 1e5` gives `4 + 0.2 + 0.6 × 5 + 0.4 × 8 + 2 = 12.4`.
  - `unknown model or usage gives null`.
  - `Haiku 5.5 is a lower bound`.
  - `cacheShare`.
  - `compare sums and subtracts`. A `null` dollars on either side stays `null`.
- [ ] **Step 2: Run** `npx vitest run bench/cost.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `node bench/usage.ts <project>` adds per turn the dollars (or "unknown"), the cache share and the route, then totals per conversation and overall. `node bench/usage.ts --compare <before> <after>` prints both totals and the change. Document both in `bench/README.md`.
- [ ] **Step 4: Run the test**, then `node bench/usage.ts` with no argument. Expected: PASS, and the usage message lists the `--compare` form.
- [ ] **Step 5: Commit** `feat(bench): price and compare the assistant's turns`.

### Task 14: Close

**Files:**
- Modify: `CHANGELOG.md` (`Unreleased`)

- [ ] **Step 1:** Add the user-visible lines:
  - the companion found without a reload;
  - `/` on the home page;
  - the message queue;
  - dictation and its setting;
  - Haiku 5.5;
  - the cache lifetime setting;
  - the bench's prices and comparison.
- [ ] **Step 2: Run** `npm run typecheck` then `npm test`. Expected: both pass. Fix any failure before going on.
- [ ] **Step 3: Commit** `docs: changelog for the queue, dictation and cost tooling`.
- [ ] **Step 4:** Do not push. Report:
  - the branch;
  - the commits;
  - what Task 2 found;
  - anything that needs a manual check in the desktop app: microphone permission, the companion started after launch, `/` on the home page.
