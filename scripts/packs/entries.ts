// A pack entry's line in the assistant's prompt: what the node, effect or tool
// is for, in one short line, read from the notes its author wrote for the
// assistant (ai.when), else its description, else its title.

/** the most a line holds (the prompt carries one per entry, in the cached part) */
export const LINE_MAX = 110;

export interface Described {
  ai?: { when?: string };
  description?: string;
  title?: string;
  name?: string;
  type?: string;
}

/** where the headline of a note ends: a full stop or a semicolon before a space, or a colon after a phrase long enough to name the need; never inside brackets or quotes, nor in "e.g." */
function headlineEnd(text: string): number {
  let depth = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === '"') quoted = !quoted;
    else if (depth || quoted) continue;
    else if ((c === '.' || c === ';') && (i + 1 === text.length || text[i + 1] === ' ') && !/[a-z]\.[a-z]$/i.test(text.slice(Math.max(0, i - 3), i))) return i;
    else if (c === ':' && i >= 20) return i;
  }
  return -1;
}

/** the need an entry answers: the headline of its notes, on one line, clipped */
export function needLine(item: Described): string {
  const said = item.ai?.when || item.description || item.title || item.name || item.type || '';
  const flat = said.replace(/\s+/g, ' ').trim();
  const end = headlineEnd(flat);
  const line = (end > 0 ? flat.slice(0, end) : flat).trim();
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1).trimEnd()}…` : line;
}
