import {
  ASSIST_LIMITS, AssistAction,
  type AssistCreateRequest, type AssistCreateResponse, type AssistDecideRequest, type AssistDecideResponse, type AssistNewBranch,
  type RunTimelineEvent, type StepFailureReport, type WidgetRun,
} from '@app/contracts';
import { beginAttempt, buildRunNarrative, learnedBranchSnippet, newRunAssistState, planAssist, resolveDecision, reviewBranchCode, type RunAssistState } from '@app/core/assist';
import { checkGeneratedCode } from '@app/core/validate-code';
import { buildBranchSource } from '@app/widget-runtime';
import type { Bus } from '../../bus.js';
import { backend, userScripts } from '../../platform/index.js';
import { RunStore } from './store.js';

const MODEL_LABEL = { decide: 'fast model', create: 'inference model', escalate: 'generation model' } as const;

/**
 * Self-healing runtime (decision B), SW side: owns run timelines, enforces caps, asks the backend agent
 * (decide → create → one escalation), executes agent-written branches in the widget's worldId with explicit
 * JSON state, builds the final-failure narrative and turns successful new branches into "add this branch?" offers.
 */
export class AssistService {
  readonly store = new RunStore();
  private caps = new Map<string, RunAssistState>();
  private created = new Map<string, { step: string; branch: AssistNewBranch }>();

  constructor(private bus: Bus) {}

  private widgetMeta(widgetId: string) {
    const w = this.bus.use('widgets.list')().find(x => x.id === widgetId);
    return { widgetName: w?.name, version: w?.version };
  }

  private getRun(widgetId: string, runId: string, traceId?: string, ts = Date.now()): WidgetRun {
    let r = this.store.get(runId);
    if (!r) {
      r = { id: runId, widgetId, ...this.widgetMeta(widgetId), traceId, startedAt: ts, status: 'running', interventions: 0, events: [], learned: [] };
      this.store.put(r);
    }
    if (r.widgetId !== widgetId) throw new Error('run belongs to another widget');
    return r;
  }

  private push(r: WidgetRun, e: RunTimelineEvent) {
    if (r.events.length >= ASSIST_LIMITS.EVENTS_PER_RUN) return;
    let i = r.events.length;
    while (i > 0 && r.events[i - 1].ts > e.ts) i--;
    r.events.splice(i, 0, e);
  }

  private save(r: WidgetRun, traceId?: string) {
    this.store.put(r);
    this.bus.broadcast({ type: 'RUN_UPDATED', run: r, traceId });
  }

  /** Timeline event from the prelude. Returns the narrative when the run ends in failure. */
  onEvent(widgetId: string, runId: string, e: RunTimelineEvent, traceId: string): { narrative?: string } {
    const r = this.getRun(widgetId, runId, traceId, e.ts);
    if (e.kind === 'run-start') r.startedAt = Math.min(r.startedAt, e.ts);
    this.push(r, e);
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.kind === 'branch-result' && d.ok === true && (d.source === 'create' || d.source === 'escalate')) {
      const c = this.created.get(`${runId}|${d.branchId}`);
      if (c && !r.learned.some(l => l.step === c.step && l.id === c.branch.id)) {
        r.learned.push({ step: c.step, id: c.branch.id, when: c.branch.when, code: c.branch.code, reason: c.branch.reason, status: 'candidate' });
        this.push(r, { ts: e.ts + 1, kind: 'learned-branch', step: c.step, data: { branchId: c.branch.id } });
      }
    }
    let narrative: string | undefined;
    if (e.kind === 'completed' || e.kind === 'final-failure') {
      r.status = e.kind === 'completed' ? 'completed' : 'failed';
      r.endedAt = e.ts;
      for (const l of r.learned) if (l.status === 'candidate') l.status = 'pending';
      if (r.status === 'failed') { narrative = buildRunNarrative(r, e.detail); r.narrative = narrative; }
      this.caps.delete(runId);
    }
    this.save(r, traceId);
    return narrative ? { narrative } : {};
  }

  private agentEvent(r: WidgetRun, kind: RunTimelineEvent['kind'], step: string, data: Record<string, unknown>, detail?: string) {
    this.push(r, { ts: Date.now(), kind, step, detail, data });
  }

  /** WIDGET_ASSIST: decide what to do for one recovery attempt (caps enforced here, not trusted to the prelude). */
  async assist(widgetId: string, report: StepFailureReport, tabId: number | undefined, traceId: string): Promise<AssistAction> {
    const r = this.getRun(widgetId, report.runId, traceId);
    const stop = (source: AssistAction['source'], reason: string): AssistAction => {
      this.agentEvent(r, 'cap', report.step, { source }, reason);
      this.save(r, traceId);
      return { action: 'stop', source, reason };
    };
    if (!this.bus.use('settings.get')().assist) return stop('disabled', 'agent assistance is switched off in settings (assist flag)');
    if (tabId === undefined) return stop('cap', 'no tab for this widget run');
    const caps = this.caps.get(r.id) ?? newRunAssistState(r.startedAt);
    this.caps.set(r.id, caps);
    // ≤2 recovery attempts per step *invocation* (a step name may run once per email); the run cap is global
    if (report.attempt === 1) caps.steps[report.step] = { attempts: 0, tried: [], newCount: 0 };
    const plan = planAssist(caps, report.step, Date.now());
    if (plan.kind === 'stop') return stop('cap', plan.reason);
    const s = beginAttempt(caps, report.step);
    r.interventions = caps.interventions;
    const { runId: _r, state, ...rest } = report;

    // an agent-written branch that already fixed this step earlier in the run is re-used first (no LLM call)
    const reuse = plan.kind === 'decide' ? r.learned.find(l => l.step === report.step && !s.tried.includes(l.id)) : undefined;
    if (reuse) {
      s.tried.push(reuse.id);
      this.agentEvent(r, 'branch-run', report.step, { branchId: reuse.id, source: 'learned' }, 're-using the branch the agent wrote earlier in this run');
      this.save(r, traceId);
      const result = await this.execBranch(tabId, widgetId, reuse.code, state);
      return AssistAction.parse({ action: 'new', source: 'learned', branchId: reuse.id, reason: `re-used agent branch "${reuse.id}" (${reuse.when})`, result });
    }
    const req: AssistDecideRequest = { ...rest, widgetName: r.widgetName };

    let tier: 'create' | 'escalate' = 'escalate';
    if (plan.kind === 'decide') {
      let decision: { choice: string; reason: string };
      try {
        const res = await backend.post<AssistDecideResponse>('/api/assist/decide', req, traceId);
        decision = res.ok && res.decision ? res.decision : { choice: 'new', reason: `decide failed (${res.error ?? 'no decision'}) → writing a new branch` };
      } catch (e) { decision = { choice: 'new', reason: `decide unavailable (${String((e as Error).message)}) → writing a new branch` }; }
      this.agentEvent(r, 'assist-decide', report.step, { choice: decision.choice, reason: decision.reason, model: MODEL_LABEL.decide, attempt: report.attempt });
      const resolved = resolveDecision(decision, report);
      if (resolved.kind === 'stop') { this.save(r, traceId); return { action: 'stop', source: 'decide', reason: `agent stopped: ${resolved.reason}` }; }
      if (resolved.kind === 'branch') { this.save(r, traceId); return { action: 'branch', source: 'decide', branchId: resolved.branchId, reason: decision.reason }; }
      tier = 'create';
    }

    s.newCount++;
    const stateKeys = state && typeof state === 'object' ? Object.keys(state as object).slice(0, 40) : [];
    const creq: AssistCreateRequest = { ...req, tier, stateKeys, previous: s.lastNew };
    let cres: AssistCreateResponse;
    try { cres = await backend.post<AssistCreateResponse>('/api/assist/create', creq, traceId); }
    catch (e) { cres = { ok: false, error: String((e as Error).message) }; }
    const kind = tier === 'create' ? 'assist-create' : 'assist-escalate';
    if (!cres.ok || !cres.branch) {
      const error = `${tier} failed: ${cres.error ?? 'no branch'}`;
      s.lastNew = { code: '(none)', error };
      this.agentEvent(r, kind, report.step, { branchId: '(none)', model: MODEL_LABEL[tier], reason: error });
      this.save(r, traceId);
      return { action: 'new', source: tier, branchId: `${tier}-failed`, reason: error, result: { ok: false, error } };
    }
    const b = cres.branch;
    // defense in depth: the SW re-validates + re-reviews before executing anything
    const v = checkGeneratedCode(b.code, { maxChars: ASSIST_LIMITS.BRANCH_CODE_CHARS });
    const review = reviewBranchCode(b.code);
    if (!v.ok || !review.safe) {
      const error = `branch rejected by SW review: ${v.ok ? review.issues.join('; ') : v.error}`;
      s.lastNew = { code: b.code.slice(0, ASSIST_LIMITS.BRANCH_CODE_CHARS), error };
      this.agentEvent(r, kind, report.step, { branchId: b.id, when: b.when, model: MODEL_LABEL[tier], reason: error });
      this.save(r, traceId);
      return { action: 'new', source: tier, branchId: b.id, reason: error, result: { ok: false, error } };
    }
    const branchId = s.tried.includes(b.id) ? `${b.id}-${s.attempts}` : b.id;
    s.tried.push(branchId);
    this.created.set(`${r.id}|${branchId}`, { step: report.step, branch: { ...b, id: branchId } });
    this.agentEvent(r, kind, report.step, { branchId, when: b.when, reason: b.reason, model: MODEL_LABEL[tier], code: b.code.slice(0, 2000) });
    this.agentEvent(r, 'branch-run', report.step, { branchId, source: tier }, 'agent-written branch executed in the widget world');
    this.save(r, traceId);

    const result = await this.execBranch(tabId, widgetId, b.code, state);
    s.lastNew = { code: b.code.slice(0, ASSIST_LIMITS.BRANCH_CODE_CHARS), error: result.ok ? 'ran without error but the postcondition was still false' : (result.error ?? 'failed') };
    return AssistAction.parse({ action: 'new', source: tier, branchId, reason: b.reason, result });
  }

  /** Execute an agent-written branch in the widget's worldId: explicit JSON state in → {ok, state, error} out. */
  private async execBranch(tabId: number, widgetId: string, code: string, state: unknown): Promise<{ ok: boolean; state?: unknown; error?: string }> {
    let result: { ok: boolean; state?: unknown; error?: string };
    try {
      const out = await userScripts.execute(tabId, buildBranchSource(code, state ?? {}), widgetId);
      const raw = out?.[0] as { result?: unknown; error?: string } | undefined;
      const res = raw?.result as { ok?: boolean; state?: unknown; error?: string } | null | undefined;
      result = res && typeof res.ok === 'boolean' ? { ok: res.ok, state: res.state, error: res.error } : { ok: false, error: raw?.error ?? 'branch produced no result' };
    } catch (e) { result = { ok: false, error: `execute failed: ${String((e as Error).message)}` }; }
    if (result.state !== undefined && JSON.stringify(result.state).length > ASSIST_LIMITS.STATE_CHARS) result = { ...result, state: undefined };
    return result;
  }

  /** "The agent fixed step X: add this branch to the widget?" */
  async learnedDecision(runId: string, step: string, accept: boolean, traceId: string) {
    const r = this.store.get(runId);
    if (!r) throw new Error('run not found');
    const l = r.learned.find(x => x.step === step && (x.status === 'pending' || x.status === 'candidate'));
    if (!l) throw new Error(`no pending learned branch for step "${step}"`);
    if (!accept) { l.status = 'dismissed'; this.save(r, traceId); return { run: r }; }
    const w = this.bus.use('widgets.list')().find(x => x.id === r.widgetId);
    if (!w) throw new Error('widget no longer installed');
    const code = `${learnedBranchSnippet(step, l)}\n${w.code}`;
    const check = checkGeneratedCode(code);
    if (!check.ok) throw new Error(`learned branch makes the widget invalid: ${check.error}`);
    const widget = await this.bus.use('widgets.newVersion')(w.id, code, `Added agent-learned branch "${l.id}" for step "${step}" (${l.when})`, traceId);
    l.status = 'accepted';
    this.save(r, traceId);
    return { run: r, widget };
  }
}
