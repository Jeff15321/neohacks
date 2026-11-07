import type { Step } from '@app/contracts';

/** Compact, prompt-sized view of a Step (shared by the Tier-1 and Workflow interpreter prompts). */
export function compactStep(s: Step, opts: { skeletonChars?: number } = {}) {
  const max = opts.skeletonChars ?? 600;
  let path = s.url;
  try { const u = new URL(s.url); path = u.pathname + u.hash; } catch { /* keep */ }
  const t = s.action.target;
  return {
    seq: s.seq,
    kind: s.action.kind,
    site: s.origin,
    path,
    pageTitle: s.title,
    target: t ? {
      tag: t.tag, role: t.role, name: t.accessibleName, landmark: t.landmarkPath,
      locators: t.candidates.slice(0, 4).map(c => `${c.kind}: ${c.selector} (${c.matches} match${c.matches === 1 ? '' : 'es'})`),
    } : undefined,
    key: s.action.key,
    value: s.action.valuePreview,
    effects: {
      urlChange: s.effects.urlChange,
      titleChange: s.effects.titleChange,
      appeared: s.effects.addedRegions.map(r => ({ root: r.root, skeleton: r.skeleton.slice(0, max) })),
      removed: s.effects.removedRegions.slice(0, 4),
      liveText: [...s.effects.liveRegionText, ...(s.lateEffects?.liveRegionText ?? [])],
      net: [...s.effects.net, ...(s.lateEffects?.net ?? [])].map(n => `${n.method} ${n.routeTemplate ?? ''} → ${n.status ?? '?'} [${n.opId}]`),
    },
    settled: s.settled,
  };
}
