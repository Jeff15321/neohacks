/**
 * Doc §5 FlowRun state machine (owner: Phase F). Pure: no chrome.* / node / fastify imports.
 * The SW coordinator (extension modules/flow) persists the run after every transition and performs the
 * returned effects (inject / re-inject / cleanup / return focus); this file decides what happens.
 */
import { FLOW_LIMITS, type FlowRun, type FlowRunStatus } from '@app/contracts';

export type FlowMachineEvent =
  | { type: 'tab'; tabId: number }                     // target tab found/created; waiting for load + content ping
  | { type: 'injected' }                               // part executed in the target tab
  | { type: 'navigated'; tabId: number }               // tabs.onUpdated complete on the target tab after injection
  | { type: 'checkpoint'; state: unknown }
  | { type: 'result'; ok: boolean; result?: unknown; error?: string }
  | { type: 'tabClosed'; tabId: number }
  | { type: 'timeout' }
  | { type: 'cancel'; reason?: string }
  | { type: 'error'; error: string };

export type FlowEffect = 'inject' | 'reinject' | 'cleanup' | 'returnFocus';

export interface FlowTransition { run: FlowRun; changed: boolean; effects: FlowEffect[]; rejected?: string }

export const isFlowTerminal = (s: FlowRunStatus) => s === 'succeeded' || s === 'failed' || s === 'cancelled';

export interface NewFlowRun {
  runId: string; widgetId: string; role: string; handler: string; input: unknown; homeTabId: number;
  timeoutMs?: number; activate?: boolean; traceId?: string;
}

export const clampFlowTimeout = (ms?: number) =>
  Math.min(FLOW_LIMITS.MAX_TIMEOUT_MS, Math.max(5_000, Math.round(ms ?? FLOW_LIMITS.DEFAULT_TIMEOUT_MS)));

export function createFlowRun(p: NewFlowRun, now: number): FlowRun {
  return {
    runId: p.runId, widgetId: p.widgetId, role: p.role, handler: p.handler, input: p.input, homeTabId: p.homeTabId,
    status: 'pending', stage: 'opening', createdAt: now, updatedAt: now, deadline: now + clampFlowTimeout(p.timeoutMs),
    injections: 0, activate: p.activate ?? true, traceId: p.traceId, events: [{ ts: now, event: 'created', detail: `${p.role}.${p.handler}` }],
  };
}

const ev = (run: FlowRun, now: number, event: string, detail?: string): FlowRun =>
  ({ ...run, updatedAt: now, events: [...(run.events ?? []), { ts: now, event, ...(detail ? { detail } : {}) }].slice(-40) });

function end(run: FlowRun, now: number, status: FlowRunStatus, fields: Partial<FlowRun>, event: string, detail?: string): FlowTransition {
  const r = ev({ ...run, ...fields, status, stage: 'done' }, now, event, detail);
  return { run: r, changed: true, effects: run.activate ? ['cleanup', 'returnFocus'] : ['cleanup'] };
}

const same = (run: FlowRun, rejected?: string): FlowTransition => ({ run, changed: false, effects: [], rejected });

/** Sink "success" = handler returned `{ok:true, ...}` (doc §5.8: evidence read back). Anything else fails the run. */
export function sinkOk(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === true;
}

export function transitionFlow(run: FlowRun, e: FlowMachineEvent, now: number): FlowTransition {
  if (isFlowTerminal(run.status)) {
    return same(run, e.type === 'checkpoint' ? `run ${run.status}` : undefined);
  }
  switch (e.type) {
    case 'tab':
      return { run: ev({ ...run, status: 'running', stage: 'loading', targetTabId: e.tabId }, now, 'tab', String(e.tabId)), changed: true, effects: ['inject'] };
    case 'injected': {
      const injections = (run.injections ?? 0) + 1;
      if (injections > FLOW_LIMITS.MAX_INJECTIONS) return end(run, now, 'failed', { error: `too many re-injections (${injections - 1})` }, 'failed');
      return { run: ev({ ...run, stage: 'injected', injections }, now, injections > 1 ? 'reinjected' : 'injected', String(injections)), changed: true, effects: [] };
    }
    case 'navigated':
      if (e.tabId !== run.targetTabId || run.stage !== 'injected') return same(run);
      return { run: ev({ ...run, stage: 'loading' }, now, 'navigated'), changed: true, effects: ['reinject'] };
    case 'checkpoint':
      if (run.status !== 'running') return same(run, 'run not running');
      return { run: ev({ ...run, checkpoint: e.state }, now, 'checkpoint'), changed: true, effects: [] };
    case 'result':
      if (run.status !== 'running') return same(run, 'run not running');
      if (!e.ok) return end(run, now, 'failed', { error: `sink handler failed: ${e.error ?? 'unknown error'}` }, 'failed', e.error);
      if (!sinkOk(e.result)) return end(run, now, 'failed', { result: e.result, error: 'sink returned without {ok:true} (result not verified)' }, 'failed');
      return end(run, now, 'succeeded', { result: e.result }, 'succeeded');
    case 'tabClosed':
      if (e.tabId === run.targetTabId) return end(run, now, 'failed', { error: 'target tab was closed before the flow finished' }, 'failed', 'target tab closed');
      if (e.tabId === run.homeTabId) return end(run, now, 'cancelled', { error: 'home tab was closed' }, 'cancelled', 'home tab closed');
      return same(run);
    case 'timeout':
      return end(run, now, 'failed', { error: `flow timed out after ${Math.round(((run.deadline ?? now) - run.createdAt) / 1000)} s` }, 'failed', 'timeout');
    case 'cancel':
      return end(run, now, 'cancelled', { error: `cancelled${e.reason ? `: ${e.reason}` : ''}` }, 'cancelled', e.reason);
    case 'error':
      return end(run, now, 'failed', { error: e.error }, 'failed', e.error);
  }
}

/** Shape the home part's FLOW_WAIT reply: resolves on success, rejects (with the reason) otherwise. */
/** (Field is `success`, not `ok`: the bus reply envelope owns `ok`.) */
export function flowWaitReply(run: FlowRun): { done: boolean; success?: boolean; result?: unknown; reason?: string; status: FlowRunStatus } {
  if (!isFlowTerminal(run.status)) return { done: false, status: run.status };
  if (run.status === 'succeeded') return { done: true, success: true, result: run.result, status: run.status };
  return { done: true, success: false, reason: run.error ?? run.status, status: run.status };
}
