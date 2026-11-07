/**
 * Phase D: activity model client + suggestions, registered on top of Phase B's Step ingest (index.ts calls
 * `registerActivity(bus)`). Consumes `steps.subscribe`; talks to modules/jobs and modules/widgets via services only.
 */
import type { Bus } from '../../bus.js';
import { ObserveClient } from './activity-client.js';
import { SuggestionManager } from './suggestions.js';

export function registerActivity(bus: Bus) {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const snapshot = () => ({
    state: client.memory, semantic: client.semantic.slice(-30), suggestions: suggestions.all(),
    diag: { queued: client.queued, inFlight: client.busy, ...client.stats, lastJudge: suggestions.lastNote ? `${client.stats.lastJudge ?? ''} · ${suggestions.lastNote}` : client.stats.lastJudge },
  });
  const changed = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; bus.broadcast({ type: 'ACTIVITY_STATE', ...snapshot() }); }, 50);
  };
  const suggestions = new SuggestionManager(bus, changed);
  const client = new ObserveClient(bus, suggestions, changed);
  suggestions.onMemory = (m) => { client.memory = m; changed(); };
  (globalThis as { __wwaObserve?: unknown }).__wwaObserve = { client, suggestions }; // debugging + E10 tool

  bus.use('steps.subscribe')((s, update) => client.onStep(s, update));

  bus.on('ACTIVITY_GET', async () => {
    await Promise.all([client.ready, suggestions.ready]);
    if (!client.memory) await client.refresh();
    return { ...snapshot(), history: client.history.slice(-50) };
  });
  bus.on('ACTIVITY_CLEAR', async () => { await client.clear(); await suggestions.clear(); return snapshot(); });
  bus.on('SUGGESTION_ACTION', async (m) => ({ suggestion: await suggestions.act(m.suggestionId, m.action, {}) }));

  // content script (suggestion card)
  bus.onPage('WWA_SUGGESTION_ACTION', async (m, ctx) => ({ suggestion: await suggestions.act(m.suggestionId, m.action, { tabId: ctx.tabId, windowId: ctx.sender.tab?.windowId }) }));
  bus.onPage('WWA_SUGGESTION_QUERY', async (_m, ctx) => {
    await suggestions.ready;
    let origin = '';
    try { origin = new URL(ctx.tabUrl).origin; } catch { /* no url */ }
    const s = suggestions.visibleFor(origin);
    if (s && ctx.tabId !== undefined && s.tabId !== ctx.tabId) s.tabId = ctx.tabId; // re-surface on the matching origin
    return { suggestion: s };
  });
}
