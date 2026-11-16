# Sound and Motion Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring into Tramme what the study of Openverse, Real SFX, earshot and Cavalry found missing: search and judging by meaning, finer sync, mono and rhythm checks, key matching, more free sources, path deformers and a Cavalry import proof.

**Architecture:** Every measure is a pure function in `@tramme/core` (testable without a browser). The editor's sound tools (`apps/editor/src/sound.ts`) and checks (`apps/editor/src/mixing.ts`) call them. The CLAP model runs in the browser through transformers.js, which the editor already uses for the cut-out and the depth map. Openverse goes through the Worker only when a key is configured there.

**Tech Stack:** TypeScript, vitest, Web Audio, `@huggingface/transformers` 4.3.2 (already a dependency), Cloudflare Worker (`packages/api`).

**Spec:** [docs/superpowers/specs/2026-11-16-sound-and-motion-research.md](../specs/2026-11-16-sound-and-motion-research.md) (the research report, in French). Tasks 1 to 13 implement pistes 1 to 12 of its table.

## Global Constraints

- Work on `develop`. No new branch. No push.
- One commit at the end of all the work (no per-task commit, no plan-edit commit), with no Claude attribution line.
- Sounds are files. Nothing is synthesised at render time. The one mixer (`packages/render/src/audio.ts`) is not forked.
- Recordings stay first for hits, clicks and whooshes (`RECORDED_FIRST` in `sound.ts`).
- Licences accepted from outside: CC0, PDM, CC BY. NC, ND and SA are always refused. Tramme is commercial (FSL).
- No technical error shown raw to the user. A missing model, key or network falls back to what works today, and the tool's text says so plainly.
- Every user-facing string goes through `t()` with keys added in both `apps/editor/src/i18n/en.json` and `fr.json`.
- Colours only from the theme tokens. No new UI beyond a settings row and tool inputs.
- Tests: `pnpm vitest run <file>` from a `C:\` cwd with an uppercase drive letter.

## Review Focus

1. **No model, no network** (first run offline, a private window with no Cache API, the Android app): the search must answer by words exactly as today. Task 7 pins it.
2. **A banned sound that is one variant of a family:** banning one variant must stop the whole family coming back through `variantsOf`. Task 3 pins it.
3. **A tuned sound on a repeated moment:** `vary` nudges the rate by up to ±4 %, which would undo the tuning. When a sound is tuned, no nudge. Task 9 pins it.
4. **A cue shift that pushes a sound before 0 s** (a tap 60 ms before a cut at 0.03 s): the clip must start at 0 with its file offset, as `place()` already does for `peakAt`. Task 2 pins it.
5. **An Openverse result with a licence string in another case or with a version** (`"by"`, `"BY"`, `"cc0"`, `license_version: "4.0"`): the credit must read `CC BY 4.0`, and an NC/ND/SA result must be refused whatever its case. Task 4 pins it.

---

### Task 1: Mono compatibility check

A sound whose two channels cancel when summed (phase-inverted stereo) goes silent on a phone speaker.

**Files:**
- Modify: `packages/core/src/audio.ts` (beside `soundFigures`)
- Modify: `apps/editor/src/mixing.ts` (`SOUND_TEXTS`, `soundReport`)
- Test: `packages/core/test/audio.test.ts`, `apps/editor/test/mixing.test.ts`

**Interfaces:**
- Produces: `monoLoss(channels: Float32Array[], sampleRate: number, window?: number): { lossDb: number; at: number } | null`. It returns the worst window's loss: the stereo RMS minus the RMS of `(L+R)/2`, in dB, positive when summing loses level. `window` defaults to 0.4 s. It returns `null` for mono input or when every window is under -60 dBFS.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/audio.test.ts
it('measures nothing lost on a centred stereo sound', () => {
  const l = sine(440, 1, 48000), r = l.slice();
  expect(monoLoss([l, r], 48000)!.lossDb).toBeLessThan(0.5);
});
it('finds a phase-inverted stereo sound lost in mono', () => {
  const l = sine(440, 1, 48000), r = l.map((x) => -x);
  expect(monoLoss([l, r], 48000)!.lossDb).toBeGreaterThan(30);
});
it('says nothing of a mono sound', () => { expect(monoLoss([sine(440, 1, 48000)], 48000)).toBeNull(); });
```

```ts
// apps/editor/test/mixing.test.ts: through the exported helper the report uses
it('warns when the master loses 6 dB or more in mono', () => {
  expect(monoIssue({ lossDb: 9.2, at: 1.4 })?.say.text).toBe(SOUND_TEXTS.mono);
  expect(monoIssue({ lossDb: 3 })).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/audio.test.ts apps/editor/test/mixing.test.ts`
Expected: FAIL, `monoLoss` and `monoIssue` are not exported.

- [ ] **Step 3: Implement**

In `packages/core/src/audio.ts`, add `monoLoss` and export it from `packages/core/src/index.ts`. In `mixing.ts`:
- add `SOUND_TEXTS.mono = 'The mix loses {db} dB in mono around {t} s (a phone speaker): a stereo sound cancels itself, use one channel'`;
- add `export function monoIssue(m: { lossDb: number; at?: number } | null): QualityIssue | null` with the threshold `MONO_LOSS = 6` dB and severity `warning`;
- in `soundReport`, call `monoIssue(monoLoss(final, rate))` right after the master checks.

The `layers` field names the effect clips whose hit is within ±0.4 s of `at`.

- [ ] **Step 4: Run the tests to see them pass**

Run: same command. Expected: PASS.

---

### Task 2: A cue shift per kind of sound

A tap lands 60 ms before the cut, a click 11 ms before, and the top of a whoosh 37 ms after. These values come from earshot's launch preset.

**Files:**
- Modify: `packages/nodes/src/sound.ts` (audio node schema, beside `visual`)
- Modify: `packages/core/src/audio.ts` (`AudioClip`, `audioClips`)
- Modify: `apps/editor/src/sound.ts` (`place`)
- Modify: `apps/editor/src/mixing.ts` (the `offCue` comparison)
- Test: `apps/editor/test/sound.test.ts`, `apps/editor/test/mixing.test.ts`

**Interfaces:**
- Produces:
  - `CUE_SHIFT: Record<string, number>` in `apps/editor/src/sound.ts`, in seconds: `{ tap: -0.06, click: -0.011, tick: -0.011, key: -0.011, ui: -0.011, whoosh: 0.037, swish: 0.037, transition: 0.037 }`. Every other kind is 0.
  - The audio node prop `cueShift`: a number in seconds, default 0, `animatable: false`, group as `visual`.
  - `AudioClip.cueShift: number`.

- [ ] **Step 1: Write the failing tests**

```ts
// sound.test.ts, through the exported place (export it for the test)
it('lands a tap 60 ms before its cue and records the shift', () => {
  const { ops } = place(ctx, [[{ asset: 'sound-tap', title: 'Tap', figures: fig({ peakAt: 0.02 }), kind: 'tap' }]], [{ t: 2, visual: 'cut' }], { gain: -8, vary: false });
  const layer = ops.find((o) => o.value?.type === 'audio')!.value;
  expect(layer.in).toBeCloseTo(2 - 0.06 - 0.02, 4);
  expect(layer.props.cueShift).toBe(-0.06);
});
it('starts a shifted sound at 0 with its file offset when the shift goes before the film', () => {
  const { ops } = place(ctx, [[{ asset: 'sound-tap', title: 'Tap', figures: fig({ peakAt: 0.05 }), kind: 'tap' }]], [{ t: 0.03, visual: 'cut' }], { gain: -8, vary: false });
  const layer = ops.find((o) => o.value?.type === 'audio')!.value;
  expect(layer.in).toBe(0);
  expect(layer.props.start).toBeCloseTo(0.08, 4);
});
it('does not shift a sound aligned on its start', () => { /* align: 'start' → no cueShift prop */ });
```

```ts
// mixing.test.ts: offCue reads the expected hit as cue + cueShift
it('accepts a whoosh 37 ms after its cut', () => { expect(offCueFrames({ hit: 2.037, cue: 2, cueShift: 0.037, fps: 30 })).toBe(0); });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/editor/test/sound.test.ts apps/editor/test/mixing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `place()`, when `align === 'peak'`, use `shift = CUE_SHIFT[s.kind] ?? 0` and place at `at = m.t + shift - lead`. Write `props.cueShift = shift` only when it is non-zero.

`audioClips` reads the prop (default 0). In `soundReport`, `offCue` compares `near.t + e.clip.cueShift` with `e.hit`, through `export function offCueFrames(o: { hit: number; cue: number; cueShift: number; fps: number }): number`, which returns the frames off rounded, 0 when inside the tolerance.

- [ ] **Step 4: Run the tests to see them pass**

Run: same command. Expected: PASS. Then run the whole `apps/editor/test/sound*.test.ts` and `packages/core/test/audio*.test.ts` to see nothing else moved.

---

### Task 3: Banning a sound, and the user's library first

**Files:**
- Modify: `packages/core/src/sounds.ts` (`searchSounds`)
- Modify: `apps/editor/src/settings.ts` (pref `bannedSounds`)
- Modify: `apps/editor/src/sound.ts` (new tool `sound-ban`; `sfx` search; `SOUND_TOOLS`)
- Test: `packages/core/test/sounds.test.ts` (create if it is missing), `apps/editor/test/sound.test.ts`

**Interfaces:**
- Produces:
  - `searchSounds(entries, query, opts: { kind?: string; limit?: number; banned?: ReadonlySet<string>; meaning?: (e: SoundEntry) => number | null })`. `meaning` is used by Task 7. `banned` holds family keys: `e.family ?? e.id`.
  - `banKey(e: SoundEntry): string`, which returns `e.family ?? e.id`.
  - The pref `bannedSounds: string[]` (default `[]`).
  - The tool `sound-ban`: `{ sound: string; undo?: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('drops a banned family, every variant of it', () => {
  const a1 = e({ id: 'hit-a-1', family: 'hit-a', kind: 'impact' }), a2 = e({ id: 'hit-a-2', family: 'hit-a', kind: 'impact' }), b = e({ id: 'hit-b', kind: 'impact' });
  expect(searchSounds([a1, a2, b], 'impact', { banned: new Set(['hit-a']) }).map((x) => x.id)).toEqual(['hit-b']);
});
it('puts the user library first among equal scores', () => {
  const mine = e({ id: 'mine-thud', kind: 'impact', source: 'library' }), shipped = e({ id: 'a-thud', kind: 'impact', source: 'built-in' });
  expect(searchSounds([shipped, mine], 'impact')[0].id).toBe('mine-thud');
});
```

Add a `sound.test.ts` case: `sound-ban` with `sound: 'hit-a-2'` stores `'hit-a'` in `bannedSounds`, and with `undo: true` removes it.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/sounds.test.ts apps/editor/test/sound.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

The sort in `searchSounds` breaks score ties with `library` before `built-in` before `preset`, then by id. `sfx` passes `banned: new Set(prefs.peek().bannedSounds)`.

When a search with words finds fewer than 3 sounds, the `sfx` text ends with `Few sounds here: find recordings (sound-find) before writing one.`

`sound-ban` has these `ai` notes:
- `when`: "the user rejects a sound, or a sound keeps coming back wrong";
- `avoid`: "banning a whole kind".

Its notice goes through `t('sound.banned')` and `t('sound.unbanned')`.

- [ ] **Step 4: Run the tests to see them pass**

Run: same command. Expected: PASS.

---

### Task 4: Openverse through the Worker, and CC BY recordings

**Files:**
- Modify: `packages/api/src/keyed-providers.json` (add `openverse`)
- Modify: `packages/api/src/stock.ts` (route `openverse`), `packages/api/src/providers.ts` (route comment)
- Modify: `apps/editor/src/api.ts` (`stockOpenverse`), `apps/editor/src/openverse.ts`
- Modify: `apps/editor/src/sound.ts` (`sound-find`: licences)
- Modify: `apps/worker/.dev.vars.example`, `docs/deploy.md`
- Test: `apps/worker/test/worker.test.ts`, `apps/editor/test/openverse.test.ts` (create), `apps/editor/test/sound.test.ts`

**Interfaces:**
- Produces:
  - The route `GET /api/stock/openverse/<audio|images>?<Openverse params>`. It answers Openverse's JSON as is, and 503 `no openverse key` when none is set.
  - The keyed provider `"openverse": { "origin": "https://api.openverse.org", "fields": [{ "name": "client_id", "required": true }] }`. The key itself is the client secret.
  - `licenceOf(r: { license?: string; license_version?: string }): string | null`, exported from `apps/editor/src/openverse.ts`. It answers `'CC0'`, `'PDM'` or `'CC BY <version>'`, and `null` for anything else (NC, ND, SA, unknown).
  - `openverse(kind, params, signal)` keeps its signature. It tries the Worker route first and falls back to the direct anonymous call on 503, 404 or a network error.

- [ ] **Step 1: Write the failing tests**

```ts
// openverse.test.ts
it.each([['cc0', '1.0', 'CC0'], ['by', '4.0', 'CC BY 4.0'], ['BY', '3.0', 'CC BY 3.0'], ['pdm', '1.0', 'PDM']])('credits %s %s as %s', (license, v, out) => expect(licenceOf({ license, license_version: v })).toBe(out));
it.each(['by-nc', 'BY-ND', 'by-sa', 'sampling+', ''])('refuses %s', (license) => expect(licenceOf({ license })).toBeNull());
it('falls back to the anonymous search when the Worker has no key', async () => { /* stub api.stockOpenverse → 503, fetch direct → results; expect results */ });
```

```ts
// worker.test.ts
it('exchanges the openverse client credentials once and reuses the token', async () => {
  /* stub fetch: POST /v1/auth_tokens/token/ → { access_token: 'tok', expires_in: 36000 }; two searches → one token call, both searches carry Authorization: Bearer tok */
});
it('answers 503 without an openverse key', async () => { /* no key → 503 */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/editor/test/openverse.test.ts apps/worker/test/worker.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

**The Worker.** `openverseSearch(req, reach, kind)` in `stock.ts`:
- `kind` is `audio` or `images`, otherwise 404;
- the token comes from `POST https://api.openverse.org/v1/auth_tokens/token/`, form `grant_type=client_credentials&client_id=…&client_secret=…`;
- it is kept in module memory until 60 s before `expires_in`, and read like the `project` field of `hydracept.ts`;
- the query string is passed through with `page_size` capped at 50;
- a 429 becomes an `HttpError(429, 'openverse: too many requests, try again in a while')`.

**`sound-find`.** It asks for `license: 'cc0,by'` and keeps a result only when `licenceOf(x)` is not null. The licence passes through to `keepInLibrary`. The text's first line drops "CC0" and says "credited".

**Deploy.** `.dev.vars.example` and `docs/deploy.md` say how to register an Openverse application: `POST /v1/auth_tokens/register/`, then confirm the e-mail. The user does that, with their own address.

- [ ] **Step 4: Run the tests to see them pass**

Run: same command, plus `pnpm vitest run apps/editor/test/stock.test.ts` (the images use `openverse()` too). Expected: PASS.

- [ ] **Step 5: Probe the audio `category` filter on the live API**

Run: `curl -s "https://api.openverse.org/v1/audio/?q=whoosh&license=cc0,by&source=freesound&page_size=20" | jq .result_count`, then the same query with `&category=sound_effect`.

Keep `category=sound_effect` in `sound-find` only if the second count is at least 80 % of the first. Note the result in the task's report either way.

---

### Task 5: Music beds from Jamendo (`music-find`)

**Files:**
- Modify: `apps/editor/src/sound.ts` (new tool `music-find`; `SOUND_TOOLS`)
- Test: `apps/editor/test/sound.test.ts`

**Interfaces:**
- Consumes: `openverse`, `licenceOf` (Task 4); `keepInLibrary`, `measure`.
- Produces: the tool `music-find`: `{ query: string; count?: number; min?: number; max?: number }`. `count` defaults to 3 (at most 6); `min` and `max` are in seconds, defaulting to 20 and 300. It keeps tracks as `kind: 'music'` with their credit.

- [ ] **Step 1: Write the failing test**

```ts
it('keeps Jamendo tracks with a free licence and refuses NC ones', async () => {
  /* stub openverse → [{ license: 'by', license_version: '3.0', duration: 95000, … }, { license: 'by-nc', … }]; run music-find; expect one kept, kind 'music', license 'CC BY 3.0', the NC one listed as refused (licence) */
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run apps/editor/test/sound.test.ts -t "Jamendo"`. Expected: FAIL.

- [ ] **Step 3: Implement**

The tool searches with `source: 'jamendo'`, `license: 'cc0,by'` and `page_size: '20'`. It keeps tracks whose duration (ms) is within `[min, max]` and whose `licenceOf` is not null. `soundFlaws` is not applied, since it is tuned for effects.

Its `ai.when`: "a music bed the user does not want generated, or before a paid generation". The tool runs `beats` on what it keeps so `music-plan` can read the grid.

- [ ] **Step 4: Run it to see it pass**

Run: same command. Expected: PASS.

---

### Task 6: CLAP in the browser, and the catalog's embeddings

**Files:**
- Create: `apps/editor/src/clap.ts`
- Modify: `apps/editor/src/models.ts` (a catalogue entry, so the settings show and delete it like the others)
- Modify: `scripts/sound-library.ts` (writes `sounds/clap.bin`), `apps/editor/src/sound.ts` (`keepInLibrary` stores the user's embeddings)
- Modify: `packages/core/src/sounds.ts` (`SoundEntry.clap?: string`)
- Modify: `THIRD_PARTY_NOTICES.md` (CLAP model, Apache-2.0)
- Test: `apps/editor/test/clap.test.ts` (create)

**Interfaces:**
- Produces:
  - `CLAP_MODEL = 'Xenova/clap-htsat-unfused'`, pinned to a revision in `models.ts`.
  - `textVector(text: string): Promise<Float32Array | null>` and `audioVector(buffer: AudioBuffer): Promise<Float32Array | null>`. Both return 512-d, L2-normalised vectors. The audio is resampled to 48 kHz mono and cut to its first 10 s. Both return `null` when the model cannot load: no Cache API, offline, a failed download.
  - `packVector(v: Float32Array): string` and `unpackVector(s: string): Float32Array`: int8 with one float32 scale, base64.
  - `catalogVectors(): Promise<Map<string, Float32Array>>`, read from `/sounds/clap.bin`. Its layout is a uint32 count, then for each entry a uint16 id length, the UTF-8 id, a float32 scale and 512 int8 values.
  - `cosine(a: Float32Array, b: Float32Array): number`.

- [ ] **Step 1: Write the failing tests**

```ts
it('packs a vector into int8 and back within 1 %', () => { const v = unit(512, 7); const w = unpackVector(packVector(v)); expect(cosine(v, w)).toBeGreaterThan(0.99); });
it('reads the catalog binary layout', async () => { /* build a 2-entry buffer by hand, stub fetch, expect ids and vectors */ });
it('answers null when the model cannot load', async () => { /* stub the pipeline import to throw; expect textVector('whoosh') → null */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/editor/test/clap.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`clap.ts` loads `ClapTextModelWithProjection`, `ClapAudioModelWithProjection`, `AutoTokenizer` and `AutoProcessor` from `@huggingface/transformers`, quantized on CPU, fp16 on WebGPU, as `model-cache.ts` does. The models are loaded once, lazily, and the loading error is kept so a retry waits for the next session.

`scripts/sound-library.ts` computes the vectors for every shipped sound in the same Chrome run that measures them.

`keepInLibrary` adds `clap: packVector(await audioVector(buffer))` when it is not null.

- [ ] **Step 4: Run them to see them pass, then build the catalog**

Run: `pnpm vitest run apps/editor/test/clap.test.ts`. Expected: PASS.
Run: `pnpm tsx scripts/sound-library.ts`. Expected: `sounds/clap.bin` of about 220 KB for 421 sounds, and `catalog.json` unchanged except for its order.

---

### Task 7: Search and judge by meaning

**Files:**
- Modify: `packages/core/src/sounds.ts` (`searchSounds` reads `meaning`)
- Modify: `apps/editor/src/sound.ts` (`sfx` search, `sound-find` judging)
- Test: `packages/core/test/sounds.test.ts`, `apps/editor/test/sound.test.ts`

**Interfaces:**
- Consumes: `textVector`, `audioVector`, `catalogVectors`, `unpackVector` and `cosine` (Task 6); `searchSounds(…, { meaning })` (Task 3).
- Produces:
  - In `sounds.ts`: `MEANING_WEIGHT = 8`, `MEANING_MIN = 0.25`. The score is the word score plus `MEANING_WEIGHT × max(0, sim − MEANING_MIN) / (1 − MEANING_MIN)`. An entry with no word match is kept when `sim ≥ MEANING_MIN`.
  - In `sound.ts`: `MATCH_MIN = 0.2`. In `sound-find`, a recording whose `cosine(textVector(query), audioVector(file))` is below it is refused with the reason `does not sound like "<query>"`, and the kept ones are sorted by similarity.

- [ ] **Step 1: Write the failing tests**

```ts
it('ranks by meaning when the words do not match', () => {
  const a = e({ id: 'door-slam', kind: 'impact', tags: ['door'] }), b = e({ id: 'glass', kind: 'chime', tags: ['glass'] });
  const sim = new Map([['door-slam', 0.6], ['glass', 0.1]]);
  expect(searchSounds([a, b], 'heavy wooden thud', { meaning: (x) => sim.get(x.id) ?? null }).map((x) => x.id)).toEqual(['door-slam']);
});
it('answers by words alone when meaning gives null for every entry', () => {
  const a = e({ id: 'hit', kind: 'impact' });
  expect(searchSounds([a], 'impact', { meaning: () => null })).toEqual(searchSounds([a], 'impact'));
});
```

Add a `sound.test.ts` case: `sound-find` with the stubbed vectors refuses a recording at cosine 0.1 with the reason `does not sound like`. With `textVector` stubbed to null, it keeps today's behaviour.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/sounds.test.ts apps/editor/test/sound.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`sfx` computes `textVector(query)` once per search. The vectors come from the catalog's (`catalogVectors`) and from the user's (`unpackVector(e.clap)`). A preset written as code has none: `meaning` returns null for it.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Check the thresholds by ear and by eye**

In the editor trial server (port 8790, repo-local state), search these 12 queries:
`metal hit`, `soft whoosh`, `paper`, `deep boom`, `ui click`, `glass ding`, `wood tap`, `riser`, `glitch`, `door`, `water drop`, `camera shutter`.

Note how many of the top 3 fit, with and without meaning. Keep `MEANING_WEIGHT` and `MEANING_MIN` if the meaning column fits at least as often on every query and better on `paper`, `door`, `water drop` and `camera shutter`. Otherwise adjust them once and record the values tried in the task's report.

---

### Task 8: The music's key and a sound's pitch

**Files:**
- Create: `packages/core/src/tonality.ts` (exported from `index.ts`)
- Test: `packages/core/test/tonality.test.ts`

**Interfaces:**
- Produces:
  - `keyOf(samples: Float32Array, rate: number): { tonic: number; mode: 'major' | 'minor'; confidence: number } | null`. `tonic` is 0 to 11 with C = 0. The method is a chroma from an FFT of 8192 points (hop 4096), from 55 Hz to 2 kHz, correlated with the Krumhansl–Kessler profiles. `confidence` is the best correlation minus the second best, and the function returns `null` under 0.05.
  - `pitchOf(samples: Float32Array, rate: number): { midi: number; confidence: number } | null`. The method is YIN over the 0.2 s after the peak. `confidence` is `1 − d'(τ)`, and the function returns `null` under 0.8 or outside midi 36 to 96.
  - `scaleOf(key): number[]`: the 7 pitch classes of the key.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds A minor in an A minor chord progression', () => { const k = keyOf(chords(['Am', 'Dm', 'E', 'Am'], 48000), 48000)!; expect([k.tonic, k.mode]).toEqual([9, 'minor']); });
it('finds C major', () => { const k = keyOf(chords(['C', 'F', 'G', 'C'], 48000), 48000)!; expect([k.tonic, k.mode]).toEqual([0, 'major']); });
it('says nothing of noise', () => { expect(keyOf(whiteNoise(4, 48000), 48000)).toBeNull(); });
it('hears A4 as midi 69', () => { expect(pitchOf(pluck(440, 1, 48000), 48000)!.midi).toBeCloseTo(69, 0); });
it('hears no pitch in a noise burst', () => { expect(pitchOf(whiteNoise(0.5, 48000), 48000)).toBeNull(); });
```

The helpers `chords`, `pluck` and `whiteNoise` go at the top of the test file: sums of sines with a decay, and seeded noise.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/tonality.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `keyOf`, `pitchOf` and `scaleOf` as specified. Use the FFT already in `packages/core/src/spectrum.ts` rather than a new one.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

---

### Task 9: Pitched sounds tuned to the music

This closes the box of step 7 of `docs/sound-roadmap.md`: "Pitch matched to the music's key".

**Files:**
- Modify: `apps/editor/src/sound.ts` (`sfx`: input `tune`; `place`: option `semitones`)
- Modify: `apps/editor/src/perception.ts` (the key kept with the music's analysis)
- Test: `apps/editor/test/sound.test.ts`

**Interfaces:**
- Consumes: `keyOf`, `pitchOf` and `scaleOf` (Task 8).
- Produces:
  - `tuneTo(midi: number, scale: number[]): number`: the semitones to the nearest pitch class of the scale, in −2..2, with 0 when the nearest is further.
  - `sfx` input `tune?: boolean`, default true. It applies when a music layer with a key is under the moment and the sound has a pitch.
  - `place` option `tuned?: number`. Its rate is `2^(tuned/12) × (o.rate ?? 1)`, with no `vary` nudge.

- [ ] **Step 1: Write the failing tests**

```ts
it('moves a C# chime to D in D major', () => expect(tuneTo(61, scaleOf({ tonic: 2, mode: 'major', confidence: 1 }))).toBe(1));
it('leaves a note of the scale alone', () => expect(tuneTo(62, scaleOf({ tonic: 2, mode: 'major', confidence: 1 }))).toBe(0));
it('does not nudge the rate of a tuned sound on repeated moments', () => {
  const { ops } = place(ctx, [[chime]], [{ t: 1 }, { t: 2 }, { t: 3 }], { gain: -8, vary: true, tuned: 1 });
  const rates = ops.filter((o) => o.value?.type === 'audio').map((o) => o.value.props.rate);
  expect(new Set(rates)).toEqual(new Set([+(2 ** (1 / 12)).toFixed(4)]));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/editor/test/sound.test.ts -t "tune|tuned|scale"`. Expected: FAIL.

- [ ] **Step 3: Implement**

The key of a music asset is computed once and kept beside its `beats` analysis in `perception.ts`. A sound's pitch is computed in `bring()` from the buffer `measure` already decodes.

The `sfx` text says `tuned +1 st to D major` when it applies.

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

---

### Task 10: The sound's rhythm against reference films

**Files:**
- Create: `packages/core/src/rhythm.ts` (exported from `index.ts`)
- Modify: `apps/editor/src/mixing.ts` (`SOUND_TEXTS.rhythm`, `soundReport` reads the profile; new tool `sound-profile` in `MIXING_TOOLS`)
- Test: `packages/core/test/rhythm.test.ts`, `apps/editor/test/mixing.test.ts`

**Interfaces:**
- Produces:
  - `RhythmFigures = { perTen: number; gapMedian: number; gapMax: number; spreadDb: number; lowShare: number; floorDb: number; digitalSilence: number }`, read from the onsets of `analyseAudio`, on the whole mix.
  - `rhythmOf(channels: Float32Array[], rate: number): RhythmFigures`:
    - `perTen`: onsets per 10 s;
    - `gapMedian` and `gapMax`: the gaps between onsets, in seconds;
    - `spreadDb`: the interquartile range of the onset peaks, in dB;
    - `lowShare`: the share of energy under 120 Hz;
    - `floorDb`: the 10th percentile of short-term loudness;
    - `digitalSilence`: the seconds with |x| < 1e-5.
  - `RhythmProfile = { [K in keyof RhythmFigures]: [number, number] }`, made by `profileOf(refs: RhythmFigures[]): RhythmProfile`:
    - with several references, the [min, max] of each figure widened by 15 % of its span;
    - with one reference, the value ± `SINGLE = { perTen: 0.3×, gapMedian: 0.3×, gapMax: 0.3×, spreadDb: 3, lowShare: 0.1, floorDb: 6, digitalSilence: 0.5 }`, where × means relative.
  - `outOfProfile(f: RhythmFigures, p: RhythmProfile): (keyof RhythmFigures)[]`.
  - The tool `sound-profile`: `{ assets: string[] }`, the video or audio assets of references the user brought. It writes `assets/sounds/profile.json`.

- [ ] **Step 1: Write the failing tests**

```ts
it('counts 5 onsets in 10 s of clicks every 2 s', () => { expect(rhythmOf([clicks(10, 2, 48000)], 48000).perTen).toBeCloseTo(5, 0); });
it('widens a profile of several references by 15 % of its span', () => { const p = profileOf([fig({ perTen: 4 }), fig({ perTen: 8 })]); expect(p.perTen).toEqual([3.4, 8.6]); });
it('flags only what leaves the profile', () => { expect(outOfProfile(fig({ perTen: 12 }), profileOf([fig({ perTen: 4 }), fig({ perTen: 8 })]))).toEqual(['perTen']); });
```

Add a `mixing.test.ts` case: with no `profile.json`, `soundReport` emits no `rhythm` issue. With one, a film out of profile gets one `info` issue per figure.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/rhythm.test.ts apps/editor/test/mixing.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`SOUND_TEXTS.rhythm` is `'The sound's {figure} is {value}, your references go from {from} to {to}'`. `figure` is translated through `t('sound.figure.<key>')`.

`sound-profile` has these `ai` notes:
- `when`: "the user gives films whose sound they like";
- `avoid`: "making a profile from one's own film".

- [ ] **Step 4: Run them to see them pass**

Run: same command. Expected: PASS.

---

### Task 11: Path deformers, and Cavalry's names for our tools

**Files:**
- Modify: `packages/core/src/modifiers.ts` (new `deform`; `BUILTIN_MODIFIERS`; `MODIFIER_NOTES`)
- Modify: `packages/core/src/path.ts` (`subdividePath`)
- Test: `packages/core/test/modifiers.test.ts`, `packages/core/test/path.test.ts` (create if it is missing)

**Interfaces:**
- Produces:
  - `subdividePath(p: PathValue, n: number): PathValue`: each segment cut into `n` with `insertPathVertex`, the shape kept.
  - The modifier `deform`, with params:
    - `mode`: `'wave' | 'noise' | 'twist' | 'bend'`, default `'wave'`;
    - `amount`: px for wave and noise, degrees for twist and bend, default 20;
    - `freq`: cycles across the path, default 2;
    - `speed`: cycles/s, default 0;
    - `detail`: subdivisions per segment, 0 to 16, default 4;
    - `seed`: default 0.

    It acts on a `PathValue` (`{ v, i?, o?, closed? }`). Other values pass through. Twist and bend rotate the tangents with their vertex.
  - In `MODIFIER_NOTES`, the Cavalry names, so a request in those terms finds our tool:
    - `wiggle`: "(Cavalry: Noise behaviour)";
    - `loop`: "(Cavalry: Oscillator)";
    - `stagger`: "(Cavalry: Stagger)";
    - `timeField`: "(Cavalry: Falloff, Apply Distance)";
    - `react`: "(Cavalry: Sound behaviour)";
    - `deform`: "(Cavalry: Deformers)".

    And in the assistant's guide for distributions (`packages/assistant/src/index.ts`): "(Cavalry: Duplicator)".

- [ ] **Step 1: Check that modifiers reach path properties**

Write a test that puts `$mod: [{ type: 'deform', … }]` on a `shape` layer's path and evaluates it. If the evaluator skips non-numeric properties for modifiers (`packages/core/src/evaluate.ts`), the fix there is part of this task.

- [ ] **Step 2: Write the failing tests**

```ts
it('subdivides a square without changing its outline', () => { const s = subdividePath(square(100), 4); expect(s.v.length).toBe(16); expect(pathLength(s)).toBeCloseTo(400, 0); });
it('waves a straight line by its amount', () => { const out = deform.apply(line(0, 400), { mode: 'wave', amount: 20, freq: 1, speed: 0, detail: 8, seed: 0 }, ctx(0)) as PathValue; expect(Math.max(...out.v.map((p) => Math.abs(p[1])))).toBeCloseTo(20, 0); });
it('passes a number through', () => { expect(deform.apply(5, defaults(deform), ctx(0))).toBe(5); });
it('is the same at the same time (seek out of order)', () => { /* apply at t=1, t=0, t=1 → equal */ });
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/modifiers.test.ts packages/core/test/path.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement**

- wave: offset along the normal by `amount × sin(2π(freq × u + speed × t))`, with `u` from 0 to 1 along the path;
- noise: `fbm` with the seed, along the normal;
- twist: rotation around the path's centre by `amount × (u − 0.5)`;
- bend: rotation around the first vertex by `amount × u`.

- [ ] **Step 5: Run them to see them pass**

Run: same command. Expected: PASS.

---

### Task 12: Proof: a Cavalry animation imported through Lottie

This follows the feature-proofs rule: real, untouched work found online, its licence checked, the before and after in `out/<topic>/` and in the site's proofs section.

**Files:**
- Create: `out/cavalry-lottie/` (the source `.json`, the frames, the side-by-side), `apps/site/proofs/cavalry-lottie/proof.json`
- Modify: `packages/interop/src/lottie-import.ts` (only for what the proof shows is missing)
- Test: `packages/interop/test/lottie-reading.test.ts`

- [ ] **Step 1: Find the source**

Look for 2 Lottie files exported from Cavalry: on LottieFiles, by searching "Cavalry", and from creators who say they made it in Cavalry. Their licence must allow reuse: the Lottie Simple License, or CC0/CC BY. Record the URL, the author and the licence in `out/cavalry-lottie/SOURCE.md`.

- [ ] **Step 2: Import and render**

Run:
- `pnpm tramme import out/cavalry-lottie/<name>.json --out out/cavalry-lottie/<name>`;
- `pnpm tramme render out/cavalry-lottie/<name> --format png --out out/cavalry-lottie/<name>-tramme`.

Render the source Lottie's frames with `lottie-web` in Chrome (trial server 8790) into `out/cavalry-lottie/<name>-lottie`, then run `pnpm tramme compare out/cavalry-lottie/<name>-lottie out/cavalry-lottie/<name>-tramme --diff out/cavalry-lottie/<name>-diff`.

Expected: the diff per frame, and a side-by-side PNG at 0, 25, 50, 75 and 100 % of the length.

- [ ] **Step 3: For each difference seen, write the failing reading test first**

The test uses the smallest Lottie excerpt that shows it, then the fix goes in `lottie-import.ts`. If no difference is seen, write that in `SOURCE.md` and skip to step 4.

- [ ] **Step 4: Publish the proof**

Write `proof.json`, in the shape of `apps/site/proofs/edit/proof.json`: the source credited, the before/after. The copy says what is shown: no "in Tramme", no negation formulas.

---

### Task 13: Documentation and the one commit

**Files:**
- Modify: `docs/sound-roadmap.md`:
  - tick the box "Pitch matched to the music's key";
  - add the boxes done by tasks 1 to 7 and 10 under the step each belongs to: checks (6), library (2), mixing (7);
  - a line for CLAP under "Principles".
- Modify: `docs/components-roadmap.md` (the `deform` modifier under step 3's neighbours).
- Modify: `CHANGELOG.md`.

- [ ] **Step 1: Run the whole suite**

Run: `pnpm test`. Expected: every test passes, with no new skip.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm -r typecheck` and `pnpm lint`. Expected: no error.

- [ ] **Step 3: Check in the editor**

Use the trial server, port 8790, repo-local state. On a film with music and cues, check:
- `sfx` with a query that only meaning finds;
- a tuned chime;
- a banned sound gone from the search;
- `check` showing the mono and rhythm lines;
- a `deform` wave on a shape.

- [ ] **Step 4: Commit once**

```bash
git add -A
git commit -m "feat(sound): sounds found and judged by meaning (CLAP), tuned to the music, shifted per kind on their cue; mono and rhythm checks; bans; Openverse through the Worker with CC BY, music beds from Jamendo; path deformers; a Cavalry animation imported as proof"
```

## Left out, on purpose

These are in the report but not in its table, so not in this plan:
- earshot's 252 sounds made in code: the recordings-first principle, and no licence for the rendered bank;
- Real SFX's 78 UI sounds: their origin is not stated;
- the detector of real versus synthetic sounds: a second model;
- blind A/B pages;
- `texture.py`, sound on small moves left quiet;
- `bed.py`, a steady bed.

Each can become its own plan.
