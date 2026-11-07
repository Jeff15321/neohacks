import { FLOW_LIMITS, type FlowCallOpts, type FlowRun, type WidgetPart, type WidgetRecord } from '@app/contracts';
import { createFlowRun, flowWaitReply, isFlowTerminal, matchesAny, randomId, transitionFlow, type FlowMachineEvent } from '@app/core';
import { buildPartSource } from '@app/widget-runtime';
import type { Bus } from '../../bus.js';
import { alarms, tabs, userScripts } from '../../platform/index.js';
import { FlowStore } from './store.js';

const ALARM = 'wwa-flow:';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errMsg = (e: unknown) => String((e as Error)?.message ?? e);

/**
 * Doc §5 FlowCoordinator. Every state change goes through `transitionFlow` (core) and is persisted to
 * storage.session before effects run (inject / re-inject / cleanup / return focus).
 */
export class FlowService {
  readonly store = new FlowStore();
  private waiters = new Map<string, Set<() => void>>();
  /** E7 / debugging: timings per run (ms from call to terminal). */
  readonly timings: Array<{ runId: string; activate: boolean; ms: number; status: string }> = [];

  constructor(private bus: Bus) {}

  private widget(id: string): WidgetRecord {
    const w = this.bus.use('widgets.get')(id);
    if (!w) throw new Error('unknown widget');
    if (!w.approved) throw new Error('widget not approved');
    return w;
  }
  private part(w: WidgetRecord, role: string): WidgetPart {
    const p = w.parts?.find(x => x.role === role);
    if (!p) throw new Error(`widget has no part with role "${role}"`);
    return p;
  }

  /** Apply one machine event; persist; broadcast; perform effects. Returns the transition. */
  async apply(runId: string, e: FlowMachineEvent) {
    await this.store.ready;
    const run = this.store.get(runId);
    if (!run) throw new Error(`unknown flow run ${runId}`);
    const t = transitionFlow(run, e, Date.now());
    if (!t.changed) return t;
    await this.store.put(t.run);
    this.bus.broadcast({ type: 'FLOW_RUN_UPDATE', run: t.run, traceId: t.run.traceId });
    for (const fx of t.effects) {
      if (fx === 'cleanup') await this.cleanup(t.run);
      if (fx === 'returnFocus') void tabs.activate(t.run.homeTabId);
      if (fx === 'inject' || fx === 'reinject') void this.injectWhenReady(t.run.runId);
    }
    return t;
  }

  private async cleanup(run: FlowRun) {
    await alarms.clear(ALARM + run.runId);
    this.timings.push({ runId: run.runId, activate: run.activate !== false, ms: (run.updatedAt ?? Date.now()) - run.createdAt, status: run.status });
    if (this.timings.length > 50) this.timings.shift();
    for (const fn of this.waiters.get(run.runId) ?? []) fn();
    this.waiters.delete(run.runId);
    if (run.targetTabId !== undefined) {
      try { await userScripts.execute(run.targetTabId, `(() => { const h = document.getElementById('wwa-flow-pill'); if (h) h.remove(); return true; })()`, `${run.widgetId}#${run.role}`); }
      catch { /* tab gone */ }
    }
  }

  /** Home part → start a run. Returns immediately with the runId (the home long-polls FLOW_WAIT). */
  async call(homeWidgetId: string, role: string, handler: string, input: unknown, opts: FlowCallOpts, homeTabId: number | undefined, traceId: string) {
    await this.store.ready;
    if (homeWidgetId.includes('#')) throw new Error('parts cannot start flows (WidgetAI.flow.call is home-only)');
    if (homeTabId === undefined) throw new Error('WidgetAI.flow.call needs a tab');
    const w = this.widget(homeWidgetId);
    const part = this.part(w, role);
    if (part.handlers?.length && !part.handlers.includes(handler)) throw new Error(`part "${role}" has no handler "${handler}"`);
    if (opts.openUrl && !matchesAny(part.matchPatterns, opts.openUrl)) throw new Error(`openUrl ${opts.openUrl} is outside part "${role}"'s approved sites`);
    if (JSON.stringify(input ?? null).length > FLOW_LIMITS.MAX_JSON_BYTES) throw new Error('flow input too large');
    const run = createFlowRun({ runId: randomId('fr'), widgetId: w.id, role, handler, input, homeTabId, timeoutMs: opts.timeoutMs, activate: opts.activate !== false, traceId }, Date.now());
    await this.store.put(run);
    await alarms.create(ALARM + run.runId, run.deadline!);
    this.bus.broadcast({ type: 'FLOW_RUN_UPDATE', run, traceId });
    void this.open(run.runId, part, opts).catch(e => this.apply(run.runId, { type: 'error', error: errMsg(e) }));
    return { runId: run.runId };
  }

  /** Coordinator step 2: find a tab matching the part's patterns, or create one at openUrl/entryUrl. */
  private async open(runId: string, part: WidgetPart, opts: FlowCallOpts) {
    const run = this.store.get(runId)!;
    const activate = opts.activate !== false;
    let tab: chrome.tabs.Tab | undefined;
    if (opts.reuseTab !== false) {
      const all = (await tabs.query({})).filter(t => t.id !== undefined && t.id !== run.homeTabId && !!t.url && matchesAny(part.matchPatterns, t.url));
      tab = (opts.openUrl && all.find(t => t.url!.startsWith(opts.openUrl!))) || all[0];
    }
    if (!tab) {
      const url = opts.openUrl ?? part.entryUrl;
      if (!url) throw new Error(`no open tab matches part "${part.role}" and it has no entryUrl`);
      tab = await tabs.create(url, activate);
    } else if (activate) await tabs.activate(tab.id!);
    await this.apply(runId, { type: 'tab', tabId: tab.id! });
  }

  /** Wait for tabs status "complete" on an allowed URL + a content-script ping (coordinator step 2). */
  private async waitReady(run: FlowRun, part: WidgetPart) {
    const tabId = run.targetTabId!;
    for (;;) {
      const cur = this.store.get(run.runId);
      if (!cur || isFlowTerminal(cur.status)) return false;
      if (Date.now() > (cur.deadline ?? 0)) return false;
      const t = await tabs.get(tabId).catch(() => undefined);
      if (!t) { await this.apply(run.runId, { type: 'tabClosed', tabId }); return false; }
      if (t.status === 'complete' && t.url && matchesAny(part.matchPatterns, t.url)) {
        const pong = await tabs.send<{ ok?: boolean }>(tabId, { type: 'WWA_PING' }).catch(() => undefined);
        if (pong?.ok) return true;
      }
      await sleep(150);
    }
  }

  private async injectWhenReady(runId: string) {
    const run = this.store.get(runId);
    if (!run || run.status !== 'running' || run.stage !== 'loading') return;
    try {
      const w = this.widget(run.widgetId);
      const part = this.part(w, run.role);
      if (!(await this.waitReady(run, part))) return;
      const cur = this.store.get(runId)!;
      if (cur.status !== 'running' || cur.stage !== 'loading') return;
      const t = await this.apply(runId, { type: 'injected' });
      if (t.run.status !== 'running') return;
      const worldId = `${w.id}#${part.role}`;
      await userScripts.configureWorld(worldId);
      const src = buildPartSource(w, part, {
        runId, handler: cur.handler, input: cur.input, resumeState: cur.checkpoint, activate: cur.activate !== false, homeName: w.name, n: t.run.injections,
      }, cur.traceId ?? '');
      const res = await userScripts.execute(cur.targetTabId!, src, worldId);
      const err = res?.[0]?.error;
      if (err) await this.apply(runId, { type: 'error', error: `part "${part.role}" failed to start: ${err}` });
    } catch (e) {
      await this.apply(runId, { type: 'error', error: errMsg(e) }).catch(() => {});
    }
  }

  /** Coordinator step 4: target tab finished loading again while the handler runs → re-inject with resumeState. */
  async onTabComplete(tabId: number) {
    await this.store.ready;
    for (const run of this.store.active()) {
      if (run.targetTabId !== tabId || run.status !== 'running' || run.stage !== 'injected') continue;
      // still the same document (e.g. a late "complete" for the initial load)? the part's world remembers its run
      const alive = await userScripts.execute(tabId, `globalThis.__wwaFlowHandled || null`, `${run.widgetId}#${run.role}`)
        .then(r => String(r?.[0]?.result ?? '')).catch(() => '');
      if (alive.startsWith(run.runId + ':')) continue;
      await this.apply(run.runId, { type: 'navigated', tabId });
    }
  }

  async onTabRemoved(tabId: number) {
    await this.store.ready;
    for (const run of this.store.active()) if (run.targetTabId === tabId || run.homeTabId === tabId) await this.apply(run.runId, { type: 'tabClosed', tabId });
  }

  async onAlarm(name: string) {
    if (!name.startsWith(ALARM)) return;
    await this.store.ready;
    const run = this.store.get(name.slice(ALARM.length));
    if (run && !isFlowTerminal(run.status)) await this.apply(run.runId, { type: 'timeout' });
  }

  /** SW (re)start: runs whose deadline passed while the SW was down fail now; others keep their alarms. */
  async recover() {
    await this.store.ready;
    for (const run of this.store.active()) {
      if (Date.now() > (run.deadline ?? 0)) await this.apply(run.runId, { type: 'timeout' });
      else await alarms.create(ALARM + run.runId, run.deadline!);
    }
  }

  // ---- user-script facing ----
  private own(runId: string, widgetId: string, sink: boolean): FlowRun {
    const run = this.store.get(runId);
    if (!run) throw new Error(`unknown flow run ${runId}`);
    const expected = sink ? `${run.widgetId}#${run.role}` : run.widgetId;
    if (widgetId !== expected) throw new Error('flow run belongs to another widget/part');
    return run;
  }

  async wait(runId: string, widgetId: string) {
    await this.store.ready;
    const run = this.own(runId, widgetId, false);
    if (!isFlowTerminal(run.status)) {
      await new Promise<void>(resolve => {
        const set = this.waiters.get(runId) ?? new Set();
        const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
        const timer = setTimeout(done, FLOW_LIMITS.WAIT_SLICE_MS);
        set.add(done); this.waiters.set(runId, set);
      });
    }
    return flowWaitReply(this.store.get(runId)!);
  }

  async cancel(runId: string, widgetId: string | null, reason: string) {
    await this.store.ready;
    if (widgetId !== null) this.own(runId, widgetId, false);
    const t = await this.apply(runId, { type: 'cancel', reason });
    return { status: t.run.status };
  }

  async result(runId: string, widgetId: string, tabId: number | undefined, ok: boolean, result: unknown, error?: string) {
    await this.store.ready;
    const run = this.own(runId, widgetId, true);
    if (tabId !== run.targetTabId) throw new Error('flow result from a tab that is not the run target');
    const t = await this.apply(runId, { type: 'result', ok, result, error });
    return { status: t.run.status };
  }

  async checkpoint(runId: string, widgetId: string, state: unknown) {
    await this.store.ready;
    this.own(runId, widgetId, true);
    if (JSON.stringify(state ?? null).length > FLOW_LIMITS.MAX_JSON_BYTES) throw new Error('checkpoint state too large');
    const t = await this.apply(runId, { type: 'checkpoint', state });
    if (t.rejected) throw new Error(`flow run is ${t.run.status}: ${t.run.error ?? t.rejected}`);
    return {};
  }

  async status(runId: string, widgetId: string) {
    await this.store.ready;
    const run = this.own(runId, widgetId, true);
    return { status: run.status, cancelled: run.status === 'cancelled' };
  }
}
