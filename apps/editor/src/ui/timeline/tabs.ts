// The tabs above the timeline: the compositions open one beside the other.

import type { TrammeDoc } from '@tramme/core';

/** a composition opened: once, at the end */
export const openTab = (tabs: string[], id: string): string[] => (tabs.includes(id) ? tabs : [...tabs, id]);

/** a tab closed: the active one goes to its neighbour (the one before when it was the last); the last tab stays */
export function closeTab(tabs: string[], active: string, closing: string): { tabs: string[]; active: string } {
  if (tabs.length < 2 || !tabs.includes(closing)) return { tabs, active };
  const next = tabs.filter((x) => x !== closing);
  if (closing !== active) return { tabs: next, active };
  const at = tabs.indexOf(closing);
  return { tabs: next, active: next[Math.min(at, next.length - 1)] };
}

/** the tabs of compositions that still exist, the main one when none is left */
export function pruneTabs(tabs: string[], compositions: TrammeDoc['compositions'], fallback: string): string[] {
  const kept = tabs.filter((id) => compositions[id]);
  return kept.length ? kept : [fallback];
}
