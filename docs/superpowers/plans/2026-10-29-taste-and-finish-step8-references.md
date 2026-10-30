# Taste and finish, step 8: a library of references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assistant and the critic can read, in words, what makes a frame or a cut work and which faults to avoid:
- composition, hierarchy, type, contrast, rhythm, transitions, the link between picture and sound;
- the faults: empty scenes, generic motion, mismatched material, repeated compositions.

Tramme's own best films join the library with the reasons they work. The library is watched for convergence: when the films kept start to share one look, the assistant is told and the own entries weigh less.

**Architecture:**
- **The shipped entries:** a hand-written catalogue `apps/editor/data/references.json`, closed tags, no media, copied by the build to `dist/references/catalogue.json` and loaded lazily, as the typeface catalogue is.
- **Search:** a `references` tool searches it by words. The word normalisation of the typeface search (case, plurals, filler words) moves into one shared module that both use.
- **Own films:** a `reference-keep` tool writes the user's own entry to the library shared by the projects, the way `component-keep` keeps a component (`reference-<slug>.js`). The entry holds the reasons in words and the facts read from the document: palette, typefaces, kinds of picture from the film plan.
- **Convergence:** a pure function over the own entries gives a similarity, and the tool's answer warns past a threshold.
- **The critic:** its system text gets the fault entries' one-line titles, a few hundred tokens.

**Tech Stack:** TypeScript (Node 24, vitest), `apps/editor` (`apps/editor/build.ts`, the library API in `apps/editor/src/api.ts`), `@tramme/assistant`, `@tramme/core` (`toLab` and `deltaE` from step 5, for the palette distance).

**Spec:** [docs/superpowers/specs/2026-10-29-taste-and-finish-design.md](../specs/2026-10-29-taste-and-finish-design.md), section "8. A library of references". It builds on:
- step 2: the typeface catalogue's loading and search (`apps/editor/src/typefaces/catalogue.ts`, `search.ts`);
- step 3: the film plan's kinds, read for an own entry;
- step 6: `CRITIC_SYSTEM`, which gains the faults.

Decided here, from the spec's "Left to the builder":
- **Format:** one JSON catalogue for the shipped entries, one library file per own entry.
- **Cost:** the references stay out of the cached prompt. The assistant reads them through the tool, a few entries at a time.

## Global Constraints

- In words, never copied media: no entry holds an image, a video, a url to a film or a frame, or a description precise enough to rebuild one shot. An entry describes a principle and how to see it, at most 900 characters.
- Taste, not templates: an entry is a principle, never a recipe of values (no "use 72 px titles and #0A84FF"). The library spans styles and genres and holds no house look.
- Nothing tuned on one video: no entry is written from the test briefs or their likely films; the test brief prompts are checked against the catalogue by a test (Task 1). Marketing and bilal are not described in any entry.
- One mechanism: the reading and the keeping are tools of the vocabulary (`use_tool` and the `/` menu).
- Shared modules, no copies:
  - one word normalisation for the typeface search and the references;
  - the library's file calls as `component-keep` makes them;
  - `toLab` and `deltaE` from core (step 5) for palettes.

  Audit your diff for duplication before handing over.
- New user-visible strings go through `t()` (en and fr, French in "vous"); no em dash in user-visible text. The catalogue's entries are read by the model and stay in English, as the tools' descriptions do.
- Commits carry no Claude attribution; one commit per task.

## Review Focus

- A query with no match, or only filler words: the answer gives the entries of the closest tag and says no entry matched, never an empty list.
- `reference-keep` on a project with no film plan, no font asset or no colour token: the entry is kept with what is known, and the missing facts are left out rather than guessed.
- The library unreachable (no server, folder storage without a library): `references` still answers from the shipped catalogue and says the own films could not be read. `reference-keep` reports the error and writes nothing.
- Convergence with fewer than three own films: no warning.
- An own entry kept twice for the same project: the second replaces the first (the project id is in the entry), with no duplicate.

---

### Task 1: The shipped catalogue

**Files:**
- Create: `apps/editor/data/references.json`, `apps/editor/src/references/catalogue.ts`
- Modify: `apps/editor/build.ts` (copy to `dist/references/catalogue.json`, beside the typefaces' copy)
- Test: `apps/editor/test/references.test.ts`

**Interfaces:**
- Produces:
  - `REF_TAGS: readonly string[]`, a closed list:
    - craft: `composition`, `hierarchy`, `type`, `contrast`, `colour`, `light`, `material`, `depth`, `camera`, `rhythm`, `cut`, `transition`, `continuity`, `sound`, `density`, `ending`, `opening`, `pacing`, `legibility`;
    - kinds of picture: `interface`, `kinetic-type`, `object`, `data`, `diagram`, `photo`, `3d`, `character`, `map`;
    - kinds of film: `launch`, `explainer`, `dressing`, `data-story`, `teaser`, `ad`, `announcement`, `tutorial`.
  - `interface Reference { id: string; kind: 'principle' | 'fault'; title: string; tags: string[]; text: string; see?: string; fix?: string }`. `see` says how to spot it in a film; `fix` is for a fault.
  - `loadReferences(): Promise<Reference[]>` (module cache; a failed fetch is not cached and throws `the reference library could not be read (HTTP n)`)
- [ ] **Step 1: Write the failing tests** over the file:
  - at least 45 principles and 20 faults;
  - ids unique and `/^[a-z0-9-]+$/`; every tag in `REF_TAGS`;
  - `text` 120 to 900 characters;
  - no entry holds `http`, `www.`, `.mp4`, `.png`, a hex colour, or a number followed by `px`;
  - every craft tag is used by at least two entries;
  - none of the proper nouns of the test brief prompts (words starting with a capital that are not the first word of a sentence, read from `bench/briefs.json` where `split` is `test`) appears in any entry.
- [ ] **Step 2: Run** `npx vitest run apps/editor/test/references.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the entries** by hand, in plain English, each one principle, across styles and genres.
  - Principles, among them:
    - one idea per shot;
    - the subject shown up close;
    - a frame with a light;
    - one accent held for the whole film;
    - few sizes, short lines;
    - type entering on the cut;
    - an element of one shot becomes the next;
    - real-looking detail in every frame;
    - the hero moment prepared by a silence;
    - the camera moving with intent;
    - planes separated by depth;
    - an ending that says where to go;
    - contrast of scale between two shots;
    - holding a frame long enough to read;
    - a cut on the beat's downbeat versus a cut on the phrase;
    - motion that answers the sound;
    - negative space as a choice;
    - a data story's one number;
    - a talking video covered every 10 to 20 s;
    - a title over the speaker between illustrations.
  - Faults: the empty scene; one form in every scene; generic motion (everything fades and slides up); material that does not match (a photo next to flat vector); a palette that drifts; text too small for the format; the logo too early; a transition on every cut; sound on every element; a frame without light; type in three families; a placeholder left in; the speaker alone for 30 s; repeated compositions; a camera drift with no reason.

  Then implement `loadReferences` and the build copy.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(references): principles and faults of the craft, in words`

### Task 2: One word normalisation, and the search

**Files:**
- Create: `apps/editor/src/words.ts` (moved from `apps/editor/src/typefaces/search.ts`: the normalisation of a query into words, plural folding, filler words), `apps/editor/src/references/search.ts`
- Modify: `apps/editor/src/typefaces/search.ts` (imports `words.ts`)
- Test: `apps/editor/test/references.test.ts`, `apps/editor/test/typefaces.test.ts` (unchanged and passing)

**Interfaces:**
- Produces:
  - `queryWords(q: string): string[]` (lower case, accents removed, plurals folded, filler dropped)
  - `searchReferences(refs: Reference[], query: string, o?: { kind?: Reference['kind']; tags?: string[]; count?: number }): { found: Reference[]; closest: boolean }`. A tag match counts 2, a title word 2, a text word 1, `count` defaults to 4. With no score, the entries of the tag closest by name come back, with `closest: true`.
- [ ] **Step 1: Write the failing tests**:
  - `queryWords('Transitions between Scenes')` is `['transition', 'scene']`.
  - `searchReferences(refs, 'transitions between scenes')` finds entries tagged `transition` first.
  - `'talking video coverage'` finds the coverage principle and the speaker-alone fault.
  - `'zzz'` gives `closest: true` and at least one entry.
  - `kind: 'fault'` gives faults only.
  - The typeface tests pass unchanged.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it, and move the normalisation out of the typeface search.
- [ ] **Step 4: Run** `npx vitest run apps/editor/test/references.test.ts apps/editor/test/typefaces.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(search): one normalisation of words for typefaces and references; the references searched`

### Task 3: Own films kept, and convergence watched

**Files:**
- Create: `apps/editor/src/references/own.ts`, `apps/editor/src/references/tools.ts` (exports `REFERENCE_TOOLS`: `references`, `reference-keep`)
- Modify: `apps/editor/src/vocabulary.ts`, `apps/editor/src/i18n/en.json`, `fr.json`
- Test: `apps/editor/test/references.test.ts`

**Interfaces:**
- Consumes: `loadReferences`, `searchReferences` (Tasks 1 and 2); `parsePlan`, `FILM_PLAN_PATH` (step 3); `toLab`, `deltaE` (`packages/core/src/picture.ts`, step 5); the library's file calls as `component-keep` uses them (`api.libraryPut`, `api.libraryGet`, `api.library`, and folder storage through `installFile` as `library-add` does).
- Produces:
  - `interface OwnReference { id: string; project: string; kept: string; title: string; why: string; tags: string[]; facts: { palette: string[]; fonts: string[]; kinds: string[]; format: string } }`
  - `factsOf(doc: TrammeDoc, plan: FilmPlan | null): OwnReference['facts']` (the colour tokens' values, the font assets' families, the plan's kinds in scene order, the format)
  - `similarity(a: OwnReference['facts'], b: OwnReference['facts']): number`, 0 to 1. It is the mean of three parts:
    - the palette: the matched colours' Lab distance, mapped so 0 means the same colours;
    - the fonts: the Jaccard index of the families;
    - the kinds: the Jaccard index of the kinds used, plus the share of the scene order they share.
  - `convergence(own: OwnReference[], last = 5): { score: number; shared: string[] } | null`. It is the mean pairwise similarity of the last `last` entries, or null for fewer than three. `shared` names what they share: "the same two fonts", "a dark plate with one blue accent" (colours named in words, from hue and lightness), "interface scenes in every film".
  - tool `references` with input `{ query: string; kind?: 'principle' | 'fault'; count?: number }`. Its text gives each entry's title, text, `see` and `fix`, then up to two own films matching the query, ranked lower by `1 - convergence.score` when the score is over 0.6. When the score is over 0.6 it adds one line: `Your kept films are converging on one look (<shared>): take this film elsewhere.`
  - tool `reference-keep` with input `{ title: string; why: string; tags: string[] }`. It refuses a `why` under 80 characters: the reasons in words are the entry. It writes `reference-<slug(project)>.js` (an ES module exporting the entry, like the component files) to the library, replacing the same project's entry.
- [ ] **Step 1: Write the failing tests**:
  - `factsOf` of a document with tokens `plate`, `accent`, a font asset `Inter (text)` and a plan of kinds `interface, type` gives them.
  - `similarity` of two equal facts is 1, of a dark blue film and a warm paper serif film under 0.3.
  - `convergence` of two entries is null. Five entries of the same palette and fonts score over 0.8, with `shared` naming the fonts.
  - `references` with five converging own films and a query matching them holds the converging line.
  - `reference-keep` with a short `why` is an error. Kept twice for one project, one file is written each time under the same name.
  - With the library unreachable (stub throws), `references` still answers from the catalogue and says the own films could not be read.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** it.
  - `references`, `ai.when`: before directing a film or a dressing, with two or three words of what is hard in it, and when the critic names a fault.
  - `reference-keep`, `ai.when`: when the user says a film is good or keeps it, with the reasons it works in words. `ai.avoid`: keeping a film nobody judged.
- [ ] **Step 4: Run** the tests and `npx vitest run apps/editor/test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(references): own films kept with their reasons, and convergence onto one look watched`

### Task 4: The guide and the critic

**Files:**
- Modify: `packages/assistant/src/index.ts` (`INSTRUCTIONS`: one bullet in `Direction:`; `CRITIC_SYSTEM` gains a `Faults to name when you see them:` list), `apps/editor/src/critic/tool.ts` (step 6: the faults' titles passed into the critic's system text from `loadReferences`, cached for the session), `packages/assistant/test/fixtures/system-before.txt`
- Test: `packages/assistant/test/system.test.ts`, `packages/assistant/test/critic.test.ts`, `apps/editor/test/critic.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - `.fixed` holds in `Direction:` the words `references` and `never copy`.
  - The critic's system text built by `critique` holds the titles of the catalogue's faults and stays under 1 500 characters for that part.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Write** the bullet: before directing, read what the craft says about the hard part of this film (use_tool "references", two or three words). The entries are principles, never a look to copy. Keep a film the user liked, with why it works in words (reference-keep). When the references say your kept films converge, take this one elsewhere.

  Then build the faults' list for the critic: `- <title>`, one line each.
- [ ] **Step 4: Update the fixture.** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(assistant): the craft's references before directing, and the faults for the critic`

### Task 5: Docs, a dev run, whole-branch check

**Files:**
- Modify: `docs/document.md` (the two tools; where own entries live), `docs/taste-finish-roadmap.md` (tick step 8, link this plan), `CHANGELOG.md`

- [ ] **Step 1: Document and tick.**
- [ ] **Step 2: Verify** `npm run typecheck`, `npm test`. Expected: all pass.
- [ ] **Step 3: Audit the diff for duplication.** Look for a second word normaliser, a second catalogue loader beside the typefaces' (if both differ only in path, make one `loadData(path, what)` and use it for both), and a second library writer. Fix what you find.
- [ ] **Step 4: With the user's go**, on the trial server, run two dev briefs. Note in the PR:
  - which references were read and whether the direction cites a principle;
  - the critic's fixes, and whether they name a fault of the list;
  - the cost added by the tool calls.
- [ ] **Step 5: Commit** `docs: the library of references, the roadmap and the changelog`
