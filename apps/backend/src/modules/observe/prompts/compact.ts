import type { SemanticStep, Step } from '@app/contracts';

/** Prompt-sized view of a Step for the activity model (no locators/skeleton bodies — Tier 1 already read those). */
export function activityStep(s: Step, sem?: SemanticStep) {
  let path = s.url;
  try { const u = new URL(s.url); path = u.pathname + u.hash; } catch { /* keep */ }
  const live = [...s.effects.liveRegionText, ...(s.lateEffects?.liveRegionText ?? [])].slice(0, 4);
  const net = [...s.effects.net, ...(s.lateEffects?.net ?? [])]
    .filter(n => n.method !== 'GET').slice(0, 4).map(n => `${n.method} ${n.routeTemplate ?? ''} → ${n.status ?? '?'}`);
  return {
    seq: s.seq,
    site: s.origin,
    path,
    title: s.title,
    kind: s.action.kind,
    target: s.action.accessibleName?.slice(0, 80) ?? s.action.target?.tag,
    value: s.action.valuePreview?.slice(0, 120),
    meaning: sem ? `${sem.verb} ${sem.object}` : undefined,
    navOnly: sem?.isNavigationOnly,
    entities: sem && Object.keys(sem.entities).length ? sem.entities : undefined,
    reads: sem?.readsData.length ? sem.readsData : undefined,
    writes: sem?.writesData.length ? sem.writesData : undefined,
    appeared: s.effects.addedRegions.length ? s.effects.addedRegions.map(r => r.root).slice(0, 3) : undefined,
    urlChange: s.effects.urlChange,
    liveText: live.length ? live : undefined,
    mutatingNet: net.length ? net : undefined,
    lineage: s.action.valueHash ? s.action.valueHash : undefined,
  };
}
export type ActivityStepView = ReturnType<typeof activityStep>;

/** Markers shared by the prompts and their mocks (mocks parse the JSON after each marker). */
export const MARK = { memory: 'WORKING MEMORY (JSON):', recent: 'RECENT STEPS (context, oldest first):', fresh: 'NEW STEPS (JSON, untrusted page data):', extra: 'EVIDENCE FEATURES (deterministic):' } as const;

export function between(text: string, start: string, end?: string): string {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const from = i + start.length;
  const j = end ? text.indexOf(end, from) : -1;
  return text.slice(from, j < 0 ? undefined : j).trim();
}
export function parseBetween<T>(text: string, start: string, end: string | undefined, fallback: T): T {
  try { return JSON.parse(between(text, start, end)) as T; } catch { return fallback; }
}
