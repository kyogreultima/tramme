# Polish roadmap

The small things between the big ones: playback that can be reasoned about, the desktop app that asks for attention when a question waits, the packs' commands on the home screen before a project opens, and the editor conveniences a day of use asks for. None of them is a roadmap of its own worth of work; together they are the difference between a tool that works and one that feels finished.

Status: done (steps 1 to 6). Tick the boxes as steps land, and keep this file as the reference instead of re-deciding the plan.

## Why

The 0.13.0 fix (a clock started at once, and a start overtaken by another or by a pause schedules nothing) carries no test, because the logic lives inside `Preview` where tests cannot reach it. On desktop, a notification alone does not bring the user back: Tauri cannot report a click on a notification, so a question that waits goes unseen until the window is looked at. The home screen offers only the built-in tools, because its command registry holds no pack until a project opens — the packs are invisible exactly where a user decides what to try. And the `/` menu forgets what was used, the scrub is silent, and a project's own copy of a pack grows old without a word. Each is small; each is met every day.

## Principles

- **Rendering stays a pure function of `t`**; the playback clock joins it — time comes from a pure module the tests can drive, not from the component's closure.
- **The desktop app earns attention, never steals it**: a flash of the taskbar or a bounce of the Dock only while a question waits, cancelled the moment the window is focused again.
- **One mechanism for assistant and user.** Everything here is reached the usual ways — `use_tool`, the `/` menu, the settings — and document changes go through operations.
- **Every interface string in English and French**; every behaviour pinned by a test next to the existing ones.

## Steps

### Step 1. The playback clock as a pure, tested module

- [x] The clock that drives the preview (`Preview`'s `advance`, `play`, `stopAudio`) moves out of the component into `apps/editor/src/playclock.ts`: reading the time from a start, wrapping a loop, ending at the duration, and the runs (a start overtaken by another, or cancelled by a pause, schedules nothing) — each a pure, exported function or class with its tests. No change in behaviour.

Done when: the wrap of a loop, the end without one, and a run killed by a restart or a pause are each pinned by a test, and `Preview` uses the module.

### Step 2. The desktop app asks for attention when it waits for an answer

- [x] When a question dialog waits for the user and the window is not focused, the desktop app also asks the window manager for attention: the taskbar flashes on Windows and Linux, the Dock icon bounces on macOS (`requestUserAttention`), and the request is cancelled when the window is focused again. In front of the window, the toast alone, as today.

  The request also goes when the question is answered or withdrawn before the window is focused. To check on a device: the taskbar's flash on Windows and Linux, the Dock's bounce on macOS (the tests drive the Tauri call, not the window manager).

Done when: a question that waits while the user is elsewhere shows the window asking for attention, and stops the moment it is answered or focused.

### Step 3. The packs' commands on the home screen, an index that cannot go stale, and the Packs docs page

- [x] The home screen's command menu lists the shipped packs' tools after the built-in ones, before a project opens — from an index generated from the packs themselves (`plugins/index.json` gaining each pack's commands and their French), so a pack's command cannot go missing. A command of a pack the project does not hold yet waits in the composer until the pack attaches. The site grows a Packs page generated from the same index, and CI checks the index is not stale.

Done when: a user on the home screen can run `/icon` or `/diagram` and lands in a project that holds the pack.

### Step 4. The `/` menu remembers what is used

- [x] The command menu puts the most recent commands first when it opens empty (at most six kept, per project preferences), and searches unchanged once something is typed.

Done when: the commands a user actually runs are the ones the menu opens with.

### Step 5. Hearing the sound while scrubbing

- [x] Dragging the playhead plays a short window of the sound at each step (80 ms, at most every 60 ms, only while dragging, never the video's streamed sound), with a setting to turn it off (on by default).

Done when: scrubbing a cut lands on the sound the way an editor's scrub does — enough to hear the moment, never a stutter.

### Step 6. A project's copy of a pack offered its update

- [x] A project holding its own copy of a shipped pack at an older version than the editor's is offered the update in the Code section, the way an installed plugin's copy already is.

Done when: a project whose `charts.js` is at 1.0.0 while the editor ships 1.1.0 lists the update, and taking it replaces the copy.
