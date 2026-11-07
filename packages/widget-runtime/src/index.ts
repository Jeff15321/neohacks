import { bridgeSection } from './sections/bridge.js';
import { coreSection } from './sections/core.js';
import { netSection } from './sections/net.js';
import { stepSection } from './sections/step.js';
import { dbSection } from './sections/db.js';
import { flowSection, type FlowInvocation } from './sections/flow.js';
export type { FlowInvocation } from './sections/flow.js';

/** Phase C: source for agent-written branches executed in the widget's worldId (JSON state in/out). */
export { buildBranchSource, HELPERS_SRC } from './sections/helpers.js';

export interface WidgetSourceInput {
  id: string;
  name: string;
  version: number;
  grants: string[];
  code: string;
  /** Phase F: sink-part invocation baked into the prelude (doc §5 coordinator step 3). */
  flowInvocation?: FlowInvocation | null;
}

/**
 * Prelude sections, in order. Each section adds members to `__api` (never reassigns it).
 * One file per owner: step.ts (C: step/assist/danger guard), db.ts (A), flow.ts (F) — edit only your file.
 */
const SECTIONS: Array<(w: WidgetSourceInput) => string> = [
  () => coreSection(),
  () => netSection(),
  () => stepSection(),
  () => dbSection(),
  (w) => flowSection(w.flowInvocation),
];

/** The prelude alone (bridge + all sections + frozen WidgetAI). */
export function buildPrelude(w: WidgetSourceInput, traceId: string): string {
  return bridgeSection({ id: w.id, name: w.name, version: w.version, grants: w.grants, traceId })
    + SECTIONS.map(s => s(w)).join('\n')
    + '\nconst WidgetAI = Object.freeze(__api);\n';
}

/**
 * Full JavaScript source injected via chrome.userScripts.execute()/register():
 *   (async () => { <prelude>; <generated widget code> })().catch(report failed)
 */
export function buildWidgetSource(w: WidgetSourceInput, traceId = ''): string {
  return `(async () => {
${buildPrelude(w, traceId)}
${w.code}
})().catch((err) => {
  try { chrome.runtime.sendMessage({ type: 'WIDGET_STATUS', widgetId: ${JSON.stringify(w.id)}, traceId: ${JSON.stringify(traceId)}, status: 'failed', detail: String(err && err.message || err) }); } catch (e) {}
  console.error('[widget ${w.id}]', err);
});`;
}

/** Cleanup snippet: remove DOM the widget added (roots use wwa- prefix ids). Known limitation: removes every wwa- root on the page. */
export function buildCleanupSource(_widgetId: string): string {
  return `(() => { const n = document.querySelectorAll('[id^="wwa-"]'); n.forEach(e => e.remove()); return { removed: n.length }; })()`;
}

/**
 * Phase F: source for a bundle part (sink) executed by the flow coordinator. The part runs in its own world
 * (`<widgetId>#<role>`) with the same prelude (incl. the Phase C danger guard) and the invocation baked in.
 */
export function buildPartSource(w: { id: string; name: string; version: number; grants: string[] }, part: { role: string; code: string },
  inv: FlowInvocation, traceId = ''): string {
  return buildWidgetSource({ id: `${w.id}#${part.role}`, name: w.name, version: w.version, grants: w.grants, code: part.code, flowInvocation: inv }, traceId);
}
