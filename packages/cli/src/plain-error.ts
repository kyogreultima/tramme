// What a failed command says, its call stack left out. An error thrown in the
// render page comes back through Puppeteer with the page's stack appended
// ("AssetStore.sync (http://127.0.0.1:…/page.js:…)"): the reason is on the
// lines before it, and a caller that keeps only the end of the output (the
// renderer of the exports in the cloud) would keep the stack alone.

/** a line of a call stack: "    at f (file:1:2)", "f (http://…:1:2)", "async g (…)", "file:///x.js:3:4" */
const FRAME = /^\s*at\s+\S|^\s*(?:async\s+)?(?:[^\s()]+\s+)?\(?(?:https?|file|node|blob):\S*:\d+(?::\d+)?\)?\s*$/;

/** the text without its stack frames nor the "Error: " Puppeteer puts before a page's message */
export function plainError(text: string): string {
  return text.split(/\r?\n/).filter((l) => l.trim() && !FRAME.test(l)).map((l) => l.replace(/^\s*(?:Error:\s+)+/, '')).join('\n').trim();
}

/** the reason a command gave at the end of its output, stacks left out */
export function lastReason(output: string, lines = 10): string {
  return plainError(output).split('\n').slice(-lines).join('\n');
}
