// How often the page asks about an export in the cloud (CloudRender.tsx): soon
// at first (a short export is told quickly), then less and less often as it
// goes on, up to LATEST; with the page in the background, once a minute (the
// notification of the system still comes), and at once when it comes back.

const FIRST = 4000, LATEST = 30_000, HIDDEN = 60_000, GROWTH = 1.5;

/** the wait before the next question, after `questions` asked since the export was asked for */
export const nextWait = (questions: number, background: boolean) => (background ? HIDDEN : Math.min(LATEST, Math.round(FIRST * GROWTH ** questions)));
