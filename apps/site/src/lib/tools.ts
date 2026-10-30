// What a motion designer looks for first, before any detail, by what it is for
// (Tools.astro). Each group points to the docs page that holds it.

export interface ToolGroup { name: string; text: string; doc: string; tools: string[] }

export const TOOL_GROUPS: ToolGroup[] = [
  {
    name: 'Motion',
    text: 'Set a key, shape its ease, let the usual behaviours do the rest.',
    doc: 'editor',
    tools: ['Keyframes', 'Graph editor', 'Wiggle, loop, spring', 'Time displacement', 'Frame-by-frame drawing'],
  },
  {
    name: 'Building',
    text: 'Films inside films, parts reused, shapes that draw themselves.',
    doc: 'editor',
    tools: ['Precompositions', 'Components', 'Masks and mattes', 'Self-drawing strokes'],
  },
  {
    name: 'The picture',
    text: 'A camera with depth, the look of the frame, effects that stay the same on every render.',
    doc: 'editor',
    tools: ['2.5D camera', 'Motion blur', 'Colour grading', 'Chroma key', 'Shaders', 'Particles', 'Transitions'],
  },
  {
    name: 'Sound and speech',
    text: 'Cut a talk on its words, caption it, put the sound under the picture.',
    doc: 'montage',
    tools: ['Captions from speech', 'Sound library'],
  },
  {
    name: 'Delivery',
    text: 'The film in the format it is going to.',
    doc: 'editor',
    tools: ['Transparent video', 'Lottie'],
  },
];
