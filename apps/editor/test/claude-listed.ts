// What a listing of the Claude models says, as the assistant's registry holds it
// after the companion or the key was asked: the tests that need a model's
// thinking or effort levels set it, and clear it after.

import { setClaudeModels, type ClaudeModel } from '@tramme/assistant';

export const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const CLAUDE: ClaudeModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', adaptive: true, efforts: [...ALL_EFFORTS], line: 'opus', recommended: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', adaptive: true, efforts: [...ALL_EFFORTS], line: 'sonnet' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', adaptive: false, efforts: [], line: 'haiku' },
];

export const listClaude = (list: ClaudeModel[] = CLAUDE) => setClaudeModels(list);
export const unlistClaude = () => setClaudeModels([]);
