import {
  PatchOp, SemanticStep, WorkingMemory, z,
  type ObserveStepsResponse, type Step, type SuggestionCandidate, type TaskInstance, type WorkflowSpec,
} from '@app/contracts';
import {
  MIN_JUDGE_SCORE, completedInstances, dismissPattern, emptyMemory, gateJudge, judgeScore, randomId, reduceActivity, restorePattern,
  type ReduceEvent, type SuggestedRecord,
} from '@app/core';
import type { ModuleDeps } from '../types.js';
import { activityStep, type ActivityStepView } from './prompts/compact.js';
import { ACTIVITY_SYSTEM, activityUser } from './prompts/activity.js';
import { activityMock } from './prompts/activity.mock.js';
import { RECONSOLIDATE_SYSTEM, reconsolidateUser } from './prompts/reconsolidate.js';
import { reconsolidateMock } from './prompts/reconsolidate.mock.js';
import { JUDGE_JSON_SCHEMA, JUDGE_SYSTEM, judgeUser } from './prompts/judge.js';
import { judgeMock } from './prompts/judge.mock.js';
import { OPS_JSON_SCHEMA } from './prompts/ops-schema.js';

/** Tunables (doc §1.4). */
export const OBSERVE_LIMITS = { RECENT_CONTEXT: 12, HISTORY: 60, RECON_EVERY: 25, TIER1_WINDOW: 5, OP_LOG: 200, SEEN_IDS: 400 } as const;

/** Per-user persisted state (activity_snapshots.state). WorkingMemory is authoritative here (doc §2). */
interface Snapshot {
  memory: WorkingMemory;
  semantic: SemanticStep[];
  views: ActivityStepView[];
  stepsSinceRecon: number;
  suggested: SuggestedRecord[];
  /** Replay log: every applied op batch (reducer is pure → state = replay(opLog)). */
  opLog: Array<{ at: number; ops: PatchOp[]; source: 'tier2' | 'recon' | 'feedback' }>;
  /** lineage: value hash → seq of the copy/select Step that read it. */
  copies: Record<string, number>;
  seenIds: string[];
}

const emptySnapshot = (): Snapshot => ({ memory: emptyMemory(), semantic: [], views: [], stepsSinceRecon: 0, suggested: [], opLog: [], copies: {}, seenIds: [] });

// LLM-facing op shapes (flat, fully required) → contracts PatchOp
const StepRefs = z.array(z.object({ seq: z.number(), role: z.enum(['essential', 'enabling', 'optional', 'noise']) }));
const LlmOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('open_task'), taskId: z.string(), goal: z.string(), confidence: z.number(), sites: z.array(z.string()).default([]), expectedNext: z.string().default('') }),
  z.object({ op: z.literal('attach_steps'), taskId: z.string(), steps: StepRefs, confidence: z.number().optional(), expectedNext: z.string().optional(), goal: z.string().optional() }),
  z.object({ op: z.literal('fork_hypothesis'), taskId: z.string(), goal: z.string() }),
  z.object({ op: z.literal('merge_hypotheses'), keepId: z.string(), dropId: z.string() }),
  z.object({ op: z.literal('set_slot'), taskId: z.string(), name: z.string(), value: z.string(), provenance: z.string() }),
  z.object({ op: z.literal('complete_task'), taskId: z.string(), evidence: z.string() }),
  z.object({ op: z.literal('abandon_task'), taskId: z.string(), reason: z.string() }),
  z.object({ op: z.literal('link_pattern'), taskId: z.string(), patternId: z.string() }),
  z.object({
    op: z.literal('create_pattern'), patternId: z.string(), name: z.string(), abstractSteps: z.array(z.string()).default([]),
    parameters: z.array(z.object({ name: z.string(), io: z.enum(['input', 'output']), source: z.string() })).default([]), automationIdea: z.string().default(''),
  }),
  z.object({ op: z.literal('flag_opportunity'), taskId: z.string(), reason: z.string() }),
]);
type LlmOp = z.infer<typeof LlmOp>;

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

/** Validate + map LLM ops; invalid ones are dropped and reported (boundary: LLM → observe). */
export function toPatchOps(raw: unknown, now: number): { ops: PatchOp[]; errors: string[] } {
  const list = (raw as { ops?: unknown[] } | null)?.ops;
  if (!Array.isArray(list)) return { ops: [], errors: ['[LLM→observe] output has no ops array'] };
  const ops: PatchOp[] = [];
  const errors: string[] = [];
  list.forEach((o, i) => {
    const r = LlmOp.safeParse(o);
    if (!r.success) { errors.push(`[LLM→observe] op #${i} invalid: ${r.error.issues[0]?.message ?? 'parse'}`); return; }
    const op = mapOp(r.data, now);
    const v = PatchOp.safeParse(op);
    if (v.success) ops.push(v.data); else errors.push(`[LLM→observe] op #${i} (${r.data.op}) invalid after mapping`);
  });
  return { ops, errors };
}

function mapOp(o: LlmOp, now: number): unknown {
  switch (o.op) {
    case 'open_task': {
      const task: TaskInstance = { id: o.taskId, goal: o.goal, status: 'active', confidence: o.confidence, stepRefs: [], slots: {}, sites: o.sites, ...(o.expectedNext ? { expectedNext: o.expectedNext } : {}) };
      return { op: 'open_task', task };
    }
    case 'attach_steps':
      return { op: 'attach_steps', taskId: o.taskId, steps: o.steps, confidence: o.confidence, expectedNext: o.expectedNext, ...(o.goal ? { goal: o.goal } : {}) };
    case 'create_pattern':
      return { op: 'create_pattern', pattern: { id: o.patternId, name: o.name, abstractSteps: o.abstractSteps, parameters: o.parameters, instanceIds: [], lastSeen: now, ...(o.automationIdea ? { automationIdea: o.automationIdea } : {}) } };
    default:
      return o;
  }
}

const JudgeOut = z.object({
  suggest: z.boolean(), reason: z.string(), title: z.string(), why: z.string(),
  value: z.number(), confidence: z.number(), feasibility: z.number(), request: z.string(),
  spec: z.object({
    goal: z.string(), placement: z.string(),
    inputs: z.array(z.object({ name: z.string(), source: z.string() })),
    outputs: z.array(z.object({ name: z.string(), sink: z.string() })),
    steps: z.array(z.object({ intent: z.string(), role: z.enum(['essential', 'conditional', 'optional']) })),
    successCriteria: z.array(z.string()), consequentialActions: z.array(z.string()),
  }),
});

/** Mechanical-transfer evidence: sink Steps (paste / typed input) in the task whose value hash was read by an earlier copy/select. */
function lineageByTask(snap: Snapshot, tasks: TaskInstance[]): Record<string, number> {
  const out: Record<string, number> = {};
  const bySeq = new Map(snap.views.map(v => [v.seq, v]));
  for (const t of tasks) {
    let n = 0;
    for (const r of t.stepRefs) {
      const v = bySeq.get(r.seq);
      if (v?.lineage && (v.kind === 'paste' || v.kind === 'input-commit') && snap.copies[v.lineage] !== undefined && snap.copies[v.lineage]! < v.seq) n++;
    }
    out[t.id] = n;
  }
  return out;
}

export function createObserveService({ cfg, db, callModel, services }: ModuleDeps) {
  const load = db.prepare('SELECT state FROM activity_snapshots WHERE user_id = ?');
  const save = db.prepare('INSERT OR REPLACE INTO activity_snapshots (user_id, updated_at, state) VALUES (?, ?, ?)');
  const del = db.prepare('DELETE FROM activity_snapshots WHERE user_id = ?');
  /** Per-user serialization: one pipeline run at a time even if two clients post concurrently. */
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const p = (chains.get(userId) ?? Promise.resolve()).then(fn, fn);
    chains.set(userId, p.catch(() => {}));
    return p;
  };

  function get(userId: string): Snapshot {
    const row = load.get(userId) as { state: string } | undefined;
    if (!row) return emptySnapshot();
    try {
      const s = { ...emptySnapshot(), ...JSON.parse(row.state) } as Snapshot;
      const m = WorkingMemory.safeParse(s.memory);
      s.memory = m.success ? m.data : emptyMemory();
      return s;
    } catch { return emptySnapshot(); }
  }
  function put(userId: string, s: Snapshot) {
    s.semantic = s.semantic.slice(-OBSERVE_LIMITS.HISTORY);
    s.views = s.views.slice(-OBSERVE_LIMITS.HISTORY);
    s.opLog = s.opLog.slice(-OBSERVE_LIMITS.OP_LOG);
    s.seenIds = s.seenIds.slice(-OBSERVE_LIMITS.SEEN_IDS);
    const copies = Object.entries(s.copies).sort((a, b) => b[1] - a[1]).slice(0, 200);
    s.copies = Object.fromEntries(copies);
    save.run(userId, Date.now(), JSON.stringify(s));
  }

  async function tier1(steps: Step[], recent: SemanticStep[], traceId: string): Promise<SemanticStep[]> {
    const interpret = services.use('steps.interpret');
    return Promise.all(steps.map(async (s) => {
      try {
        const r = await interpret({ steps: [s], recent: recent.slice(-OBSERVE_LIMITS.TIER1_WINDOW) }, traceId);
        const sem = r.semantic[0];
        if (r.ok && sem) return { ...sem, seq: s.seq };
      } catch { /* fall through */ }
      return { seq: s.seq, verb: s.action.kind, object: s.action.accessibleName?.slice(0, 40) ?? 'page', entities: {}, isNavigationOnly: s.action.kind === 'navigate' || s.action.kind === 'tab-switch', readsData: [], writesData: [] };
    }));
  }

  async function llmOps(stage: string, system: string, user: string, mock: typeof activityMock, traceId: string, now: number) {
    const res = await callModel({
      stage, model: cfg.models.inference, effort: 'low', system, messages: [{ role: 'user', content: user }],
      maxTokens: 4096, jsonSchema: OPS_JSON_SCHEMA, timeoutMs: 60_000, traceId, mock,
    });
    let parsed: { ops: PatchOp[]; errors: string[] };
    try { parsed = toPatchOps(extractJson(res.text), now); } catch (e) { parsed = { ops: [], errors: [`[LLM→observe] ${stage} output is not JSON: ${String((e as Error).message).slice(0, 120)}`] }; }
    res.report(parsed.errors.length === 0, parsed.errors.join('; ') || undefined);
    return parsed;
  }

  async function judge(snap: Snapshot, cand: { taskId: string; patternId: string; instances: number; mechanical: boolean; flagReason: string }, lineage: Record<string, number>, traceId: string): Promise<{ suggestion?: SuggestionCandidate; verdict: string; ms: number }> {
    const t0 = Date.now();
    const m = snap.memory;
    const pattern = m.patterns.find(p => p.id === cand.patternId)!;
    const instances = m.recentCompleted.filter(t => pattern.instanceIds.includes(t.id));
    const bySeq = new Map(snap.views.map(v => [v.seq, v]));
    const instView = instances.map(t => ({
      taskId: t.id, goal: t.goal, slots: t.slots, completionEvidence: t.completionEvidence, sites: t.sites,
      steps: t.stepRefs.map(r => ({ seq: r.seq, role: r.role, meaning: bySeq.get(r.seq)?.meaning ?? bySeq.get(r.seq)?.kind })),
    }));
    const current = instances.find(t => t.id === cand.taskId) ?? instances.at(-1);
    const site = current?.sites[0] ?? snap.views.at(-1)?.site ?? '';
    const res = await callModel({
      stage: 'observe.judge', model: cfg.models.generation, effort: 'medium', system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: judgeUser({
        site, pattern, instances: instView, completedInstances: cand.instances, mechanicalEvidence: { lineageEdges: lineage[cand.taskId] ?? 0 },
        flagReason: cand.flagReason, pageTitle: snap.views.at(-1)?.title,
        dismissed: m.dismissed.map(d => ({ ...d, name: m.patterns.find(p => p.id === d.patternId)?.name })),
      }) }],
      maxTokens: 4096, jsonSchema: JUDGE_JSON_SCHEMA, timeoutMs: 90_000, traceId, mock: judgeMock,
    });
    let out: z.infer<typeof JudgeOut>;
    try { out = JudgeOut.parse(extractJson(res.text)); res.report(true); }
    catch (e) { res.report(false, `[LLM→observe] invalid observe.judge output: ${String((e as Error).message).slice(0, 200)}`); return { verdict: 'judge output invalid', ms: Date.now() - t0 }; }
    const score = judgeScore(out);
    if (!out.suggest) return { verdict: `judge declined: ${out.reason}`, ms: Date.now() - t0 };
    if (score < MIN_JUDGE_SCORE) return { verdict: `judge score ${score} < ${MIN_JUDGE_SCORE}`, ms: Date.now() - t0 };
    const cited = instances.flatMap(t => t.stepRefs.filter(r => r.role !== 'noise').map(r => r.seq));
    const spec: WorkflowSpec = {
      goal: out.spec.goal,
      trigger: { site, placement: out.spec.placement },
      inputs: out.spec.inputs, outputs: out.spec.outputs,
      steps: out.spec.steps.map(s => ({ intent: s.intent, site, role: s.role, evidence: { stepSeq: current ? current.stepRefs.filter(r => r.role !== 'noise').map(r => r.seq) : cited } })),
      dataFlow: [], successCriteria: out.spec.successCriteria, consequentialActions: out.spec.consequentialActions,
      strategyHints: [], openQuestions: [],
    };
    const details = instView.map(i => `${i.goal}: ${i.steps.filter(s => s.role !== 'noise').map(s => s.meaning).join(' → ')}${i.completionEvidence ? ` (${i.completionEvidence})` : ''}`);
    return {
      verdict: `suggest (score ${score})`, ms: Date.now() - t0,
      suggestion: { id: randomId('sg'), patternId: cand.patternId, title: out.title.slice(0, 120), why: out.why.slice(0, 240), score, taskIds: instances.map(t => t.id), request: out.request.slice(0, 4000), spec, details },
    };
  }

  async function processSteps(userId: string, steps: Step[], traceId: string): Promise<ObserveStepsResponse> {
    const snap = get(userId);
    const now = Date.now();
    const seen = new Set(snap.seenIds);
    const fresh = steps.filter(s => !seen.has(s.id)).sort((a, b) => a.seq - b.seq);
    const diag: ObserveStepsResponse['diag'] = { tier1Ms: 0, tier2Ms: 0, reconsolidated: false, judge: 'not run', opErrors: [] };
    if (!fresh.length) return { ok: true, state: snap.memory, semantic: [], ops: [], suggestions: [], diag: { ...diag, judge: 'duplicate steps' } };

    // Tier 1 (parallel, stateless + 5-label window)
    let t0 = Date.now();
    const sem = await tier1(fresh, snap.semantic, traceId);
    diag.tier1Ms = Date.now() - t0;
    const views = fresh.map((s, i) => activityStep(s, sem[i]));
    for (const s of fresh) {
      snap.seenIds.push(s.id);
      if ((s.action.kind === 'copy' || s.action.kind === 'select') && s.action.valueHash) snap.copies[s.action.valueHash] = s.seq;
    }
    const recent = snap.views.slice(-OBSERVE_LIMITS.RECENT_CONTEXT);
    snap.semantic.push(...sem);
    snap.views.push(...views);

    // Tier 2 (stateful: WorkingMemory + last ~12 steps + NEW steps → patch ops)
    t0 = Date.now();
    const lineageHint = lineageByTask(snap, snap.memory.activeTasks);
    const t2 = await llmOps('observe.activity', ACTIVITY_SYSTEM, activityUser(snap.memory, recent, views, { lineageEdgesByActiveTask: lineageHint, completedInstancesByPattern: Object.fromEntries(snap.memory.patterns.map(p => [p.id, completedInstances(snap.memory, p.id)])) }), activityMock, traceId, now);
    diag.tier2Ms = Date.now() - t0;
    let r = reduceActivity(snap.memory, t2.ops, now);
    diag.opErrors.push(...t2.errors, ...r.errors);
    snap.memory = r.memory;
    snap.opLog.push({ at: now, ops: t2.ops, source: 'tier2' });
    const events: ReduceEvent[] = [...r.events];
    const allOps = [...t2.ops];
    snap.stepsSinceRecon += fresh.length;

    // Reconsolidation: on task completion and every 25 Steps (corrects drift; cannot flag)
    if (events.some(e => e.type === 'completed') || snap.stepsSinceRecon >= OBSERVE_LIMITS.RECON_EVERY) {
      const rc = await llmOps('observe.reconsolidate', RECONSOLIDATE_SYSTEM, reconsolidateUser(snap.memory, snap.views.slice(-OBSERVE_LIMITS.HISTORY)), reconsolidateMock, traceId, now);
      const ops = rc.ops.filter(o => o.op !== 'flag_opportunity');
      r = reduceActivity(snap.memory, ops, now);
      diag.opErrors.push(...rc.errors, ...r.errors);
      snap.memory = r.memory;
      snap.opLog.push({ at: now, ops, source: 'recon' });
      events.push(...r.events.filter(e => e.type !== 'flag'));
      allOps.push(...ops);
      snap.stepsSinceRecon = 0;
      diag.reconsolidated = true;
    }

    // Tier 3: deterministic gate, then the Judge
    const suggestions: SuggestionCandidate[] = [];
    const lineage = lineageByTask(snap, snap.memory.recentCompleted);
    const gate = gateJudge({ memory: snap.memory, events, suggested: snap.suggested, lineageByTask: lineage, now });
    diag.judge = `gate: ${gate.reason}`;
    if (gate.candidate) {
      const j = await judge(snap, gate.candidate, lineage, traceId);
      diag.judge = j.verdict;
      diag.judgeMs = j.ms;
      if (j.suggestion) { suggestions.push(j.suggestion); snap.suggested.push({ patternId: j.suggestion.patternId, at: now }); }
    }
    put(userId, snap);
    return { ok: true, state: snap.memory, semantic: sem, ops: allOps, suggestions, diag };
  }

  return {
    processSteps: (userId: string, steps: Step[], traceId: string) => serial(userId, () => processSteps(userId, steps, traceId)),
    state(userId: string) { const s = get(userId); return { memory: s.memory, semantic: s.semantic, opLog: s.opLog }; },
    dismiss: (userId: string, patternId: string, reason: string) => serial(userId, async () => {
      const s = get(userId);
      s.memory = dismissPattern(s.memory, patternId, reason);
      put(userId, s);
      return s.memory;
    }),
    restore: (userId: string, patternId: string) => serial(userId, async () => {
      const s = get(userId);
      s.memory = restorePattern(s.memory, patternId);
      s.suggested = s.suggested.filter(x => x.patternId !== patternId);
      put(userId, s);
      return s.memory;
    }),
    /** Clear observation (tasks, patterns, history); negative feedback (dismissed patterns) is kept. */
    clear: (userId: string) => serial(userId, async () => {
      const dismissed = get(userId).memory.dismissed;
      del.run(userId);
      if (!dismissed.length) return emptyMemory();
      const s = emptySnapshot();
      s.memory.dismissed = dismissed;
      put(userId, s);
      return s.memory;
    }),
  };
}
