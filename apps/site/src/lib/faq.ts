// The questions people ask first, with answers checked against the README, the
// docs and the code. Shown by components/Faq.astro and told to the search
// engines (lib/site.ts). Plain text: no markup.

import { FORMATS } from './formats';

export interface Question { q: string; a: string }

const formats = FORMATS.map((f) => f.name).join(', ');

export const FAQ: Question[] = [
  {
    q: 'Is Tramme free?',
    a: 'Yes, to use, in the browser and on the desktop. Its source is available under the Functional Source License: you can read it, run it and change it. The only thing that can cost money is the AI provider you choose for the assistant, billed by that provider to your own account.',
  },
  {
    q: 'Can I use Tramme for client work?',
    a: 'Yes. The films you make with Tramme are yours, and making them for clients or inside your company is a normal use. The licence reserves one thing: offering Tramme itself, or a product with substantially the same functions, to others as a commercial product or service. Each version becomes Apache-2.0 two years after its release.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. The app in the browser works without one: your projects stay in your browser, and your provider keys stay in a key vault the editor cannot read.',
  },
  {
    q: 'Does it work offline?',
    a: 'The desktop app does, and so does the web app once your browser has installed it. Only the assistant needs a connection, to reach the AI provider you chose.',
  },
  {
    q: 'Where do my projects live?',
    a: 'On the desktop, in a folder of your computer (Documents/Tramme by default). In the browser, in the browser itself. A project is a file you can export, keep and open again: a .tramme archive.',
  },
  {
    q: 'Which formats can I export?',
    a: `${formats}. The preview and the export are drawn by the same engine, so what you see is what you get. MOV comes from the command line.`,
  },
  {
    q: 'Which AI does the assistant use?',
    a: 'Claude, or models from OpenAI, Gemini, OpenRouter and Z.AI, with your own keys. It shows each change as a take you keep or set aside, and it asks before anything that costs money, such as a transcription.',
  },
  {
    q: 'Can I add my own effects and layers?',
    a: 'Yes. A project can bring its own layer types, effects and modifiers as plugins, small JavaScript modules, and the assistant can write one for your project when something is missing.',
  },
  {
    q: 'Which systems does the desktop app run on?',
    a: 'Windows, macOS and Linux. The installers are not signed by a known publisher yet, so the system may ask you to confirm the first launch: the download page says how.',
  },
];
