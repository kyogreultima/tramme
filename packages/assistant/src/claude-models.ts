// The Claude models, as they are listed now. Nothing here is a list of
// models: they come from the Agent SDK (the Claude Code login the companion
// runs) or from the Anthropic API (the key of the server or the vault), each
// with what it says of itself: its name, its effort levels, its adaptive
// thinking. The newest models appear without a change to the code.

/** how hard a model works on a turn: thinking depth, care, checks */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];

export interface ClaudeModel {
  /** the model's identifier for the Messages API and the Agent SDK */
  id: string;
  /** the name shown under "Claude" in the model menu */
  label: string;
  /** whether it thinks when it needs to (adaptive thinking) */
  adaptive: boolean;
  /** the effort levels it offers, none when it has no such setting */
  efforts: Effort[];
  /** its line (opus, sonnet, haiku…), when the listing says */
  line?: string;
  /** the model the listing recommends by itself */
  recommended?: boolean;
}

const levels = (values: unknown): Effort[] => (Array.isArray(values) ? EFFORTS.filter((e) => values.includes(e)) : []);

/** a row of the Agent SDK's `supportedModels()` */
interface SdkRow { value?: string; resolvedModel?: string; displayName?: string; supportedEffortLevels?: string[]; supportsAdaptiveThinking?: boolean }

/**
 * The models of the Agent SDK's listing: one per model, by the id each row
 * resolves to (the aliases `opus` and `sonnet` and the explicit ids of the same
 * model are one), in the SDK's order; the `default` row only says which is recommended.
 */
export function parseSdkModels(rows: SdkRow[]): ClaudeModel[] {
  if (!Array.isArray(rows)) return [];
  const models = new Map<string, ClaudeModel>();
  let recommended: string | undefined;
  for (const row of rows) {
    const id = row?.resolvedModel ?? row?.value;
    if (typeof id !== 'string' || !id) continue;
    if (row.value === 'default') { recommended = id; continue; }
    if (models.has(id)) continue;
    models.set(id, { id, label: row.displayName || id, adaptive: row.supportsAdaptiveThinking === true, efforts: levels(row.supportedEffortLevels) });
  }
  const list = [...models.values()];
  const best = list.find((m) => m.id === recommended);
  if (best) best.recommended = true;
  return list;
}

const yes = (c: unknown): boolean => (c as { supported?: unknown } | null | undefined)?.supported === true;

/**
 * The models of the Anthropic API's listing (`GET /v1/models`): the active ones, in the
 * API's order (the newest first), each with the effort levels and the adaptive
 * thinking of its capabilities. The "Claude" of a display name is dropped: the menu says it.
 */
export function parseApiModels(body: unknown): ClaudeModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((m: { id?: unknown; display_name?: unknown; lifecycle?: unknown; line?: unknown; capabilities?: Record<string, any> | null }) => {
    if (typeof m?.id !== 'string' || !m.id || (m.lifecycle && m.lifecycle !== 'active')) return [];
    const effort = m.capabilities?.effort;
    const model: ClaudeModel = {
      id: m.id,
      label: (typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id).replace(/^Claude\s+/, ''),
      adaptive: yes(m.capabilities?.thinking?.types?.adaptive),
      efforts: yes(effort) ? EFFORTS.filter((e) => yes(effort[e])) : [],
    };
    if (typeof m.line === 'string') model.line = m.line;
    return [model];
  });
}

/**
 * The model taken when none was chosen: the one the listing recommends, else the
 * newest of the Opus line (Tramme's choice of a strong model), else the first.
 */
export function defaultClaudeModel(list: ClaudeModel[] = registry): string | undefined {
  return (list.find((m) => m.recommended) ?? list.find((m) => m.line === 'opus') ?? list.find((m) => /^claude-opus/.test(m.id)) ?? list[0])?.id;
}

// ── what the assistant knows of them ─────────────────────────
// The last listing, set by whoever got it (the editor, the companion), read by
// the code that needs a model's name, its effort levels or its thinking.
let registry: ClaudeModel[] = [];

export function setClaudeModels(list: ClaudeModel[]) { registry = list; }
export const claudeModels = (): ClaudeModel[] => registry;
export const claudeModel = (id: string): ClaudeModel | undefined => registry.find((m) => m.id === id);
/** whether the model thinks when it needs to (false for a model the listing does not know) */
export const isAdaptive = (id: string): boolean => claudeModel(id)?.adaptive === true;
