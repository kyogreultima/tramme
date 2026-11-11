// The guides: the parts of the assistant's knowledge only some work needs (a
// video where someone speaks, writing a node plugin, shorts, stock libraries…).
// They leave the system prompt, which every request of every turn reads again,
// and are read once, when the work needs them (the read_guide tool). The prompt
// keeps a line per guide saying when to read it. The texts stay where they are
// written (docs/document.md, the instructions): a guide is one of their parts.

export interface Guide {
  name: string;
  /** when to read it, as the prompt's index says */
  line: string;
  text: string;
}

interface Part { name: string; line: string }

/** the sections of the reference (docs/document.md, by their "## " heading) read on demand */
const REFERENCE_GUIDES: Record<string, Part> = {
  'Node plugins': { name: 'node-plugins', line: 'before writing a node plugin (write_file in plugins/): its module, schema, drawing, tools and what a tool\'s context offers' },
  'Typefaces': { name: 'typefaces', line: 'the font assets the typefaces tools bring in, and their records' },
  'Film plan and style frames': { name: 'film-plan', line: 'the film plan\'s file, its kinds of picture and the style frames, before writing a plan' },
  'Surfaces': { name: 'surfaces', line: 'the surfaces under and over a scene (paper, gradients, grain, glows): their presets' },
  'Stock': { name: 'stock', line: 'the free libraries (photos, clips, textures, environments, models) and their credits' },
  'Tilts, the corner pin and the push-in': { name: 'tilts', line: 'layers turned in perspective, a picture pinned on four corners, the push-in' },
  'Interface pieces, finance charts and the comparison': { name: 'interface', line: 'interface pieces (device frames, rows, cards, toasts, tables), finance charts, the comparison with a style frame' },
  'The critic and the takes': { name: 'critic', line: 'the review by the critic and the takes of a scene' },
  'Scene by scene': { name: 'scenes', line: 'a long film built scene by scene, each apart' },
  'The library of references': { name: 'references', line: 'the library of the craft\'s references and the films kept' },
};

/** the chapters of the instructions (by the start of their first line) read on demand */
const INSTRUCTION_GUIDES: Record<string, Part> = {
  'Dressing a video where someone speaks:': { name: 'speaking', line: 'a video where someone speaks: cuts, fillers, captions, titles, cut-outs, tracking' },
  'A story that keeps score': { name: 'events', line: 'a story that keeps score (money, points): event lists, counters, tags, receipts' },
  'Clips:': { name: 'clips', line: 'a clip made from words or from a still (generate-video)' },
  'Hydracept:': { name: 'hydracept', line: 'pictures, clips, sounds and voices made through Hydracept' },
  'Sources:': { name: 'sources', line: 'a project holding the video\'s material (documents, pictures, footage, sounds): read it all, the brief, the directions' },
  'Shorts:': { name: 'shorts', line: 'a long video cut into shorts' },
};

/**
 * The instructions and the reference cut in two: what every request reads,
 * with an index of the guides at its end, and the guides themselves.
 */
export function splitGuides(instructions: string, reference: string): { core: string; guides: Guide[] } {
  const guides: Guide[] = [];
  const kept = instructions.split('\n\n').filter((block) => {
    const part = Object.entries(INSTRUCTION_GUIDES).find(([start]) => block.startsWith(start))?.[1];
    if (part) guides.push({ ...part, text: block });
    return !part;
  });
  const sections = reference.split(/\n(?=## )/);
  const refKept = sections.filter((section) => {
    const heading = /^## (.+)/.exec(section)?.[1]?.trim();
    const part = heading ? REFERENCE_GUIDES[heading] : undefined;
    if (part) guides.push({ ...part, text: section.trim() });
    return !part;
  });
  const index = `Guides: read one (read_guide with its name) before the work it covers, once in a conversation; the rules above stand without them.\n${guides.map((g) => `- ${g.name}: ${g.line}`).join('\n')}`;
  return { core: `${kept.join('\n\n')}\n\n${refKept.join('\n').trim()}\n\n${index}`, guides };
}
