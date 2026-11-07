/**
 * §1.4 WorkingMemory patch-op reducer (owner: Phase D). Pure: no chrome.* / node / fastify imports.
 *
 * Tier 2 (and reconsolidation) emit PatchOp[]; this reducer is the ONLY code that changes WorkingMemory, so every
 * state is replayable from (initial memory, op log). Invalid ops (unknown task, duplicate id…) are skipped and
 * reported in `errors` rather than throwing — a sloppy LLM op never corrupts state.
 *
 * Invariants enforced here (not by the prompt): ≤3 active tasks (lowest-confidence evicted as abandoned),
 * ≤2 alternative goal readings per task, recentCompleted ≤20 (oldest dropped), pattern.instanceIds = COMPLETED
 * instances only (uncertain/abandoned never count, §1.5).
 */
import { ACTIVITY_LIMITS as L, type PatchOp, type TaskInstance, type TaskPattern, type WorkingMemory } from '@app/contracts';

export type ReduceEvent =
  | { type: 'completed'; taskId: string; patternId?: string; status: 'completed' | 'uncertain' }
  | { type: 'abandoned'; taskId: string; reason: string }
  | { type: 'flag'; taskId: string; reason: string }
  | { type: 'evicted'; taskId: string };

export interface ReduceResult { memory: WorkingMemory; events: ReduceEvent[]; errors: string[] }

export const emptyMemory = (): WorkingMemory => ({ activeTasks: [], recentCompleted: [], patterns: [], dismissed: [], focus: null });

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);

export function findTask(m: WorkingMemory, id: string): TaskInstance | undefined {
  return m.activeTasks.find(t => t.id === id) ?? m.recentCompleted.find(t => t.id === id);
}

/** Number of COMPLETED instances of a pattern (the only ones that count toward suggestion thresholds). */
export function completedInstances(m: WorkingMemory, patternId: string): number {
  const p = m.patterns.find(x => x.id === patternId);
  return p ? new Set(p.instanceIds).size : 0;
}

function countInstance(m: WorkingMemory, t: TaskInstance, now: number) {
  if (!t.patternId || t.status !== 'completed') return;
  const p = m.patterns.find(x => x.id === t.patternId);
  if (!p) return;
  if (!p.instanceIds.includes(t.id)) p.instanceIds.push(t.id);
  p.lastSeen = now;
}

function endTask(m: WorkingMemory, t: TaskInstance, status: TaskInstance['status'], now: number) {
  m.activeTasks = m.activeTasks.filter(x => x.id !== t.id);
  t.status = status;
  t.endedAt = now;
  delete t.expectedNext;
  m.recentCompleted = [...m.recentCompleted.filter(x => x.id !== t.id), t];
  if (m.recentCompleted.length > L.MAX_RECENT_COMPLETED) m.recentCompleted.splice(0, m.recentCompleted.length - L.MAX_RECENT_COMPLETED);
  if (m.focus === t.id) m.focus = m.activeTasks.at(-1)?.id ?? null;
}

/** Apply one op in place. Returns an error string when the op is invalid (state unchanged). */
function applyOne(m: WorkingMemory, op: PatchOp, events: ReduceEvent[], now: number): string | undefined {
  switch (op.op) {
    case 'open_task': {
      if (findTask(m, op.task.id)) return `open_task: id ${op.task.id} exists`;
      const t: TaskInstance = { ...clone(op.task), status: 'active', confidence: clamp01(op.task.confidence) };
      if (t.alternativeGoals) t.alternativeGoals = t.alternativeGoals.slice(-L.MAX_GOAL_READINGS);
      if (m.activeTasks.length >= L.MAX_ACTIVE) {
        const victim = [...m.activeTasks].sort((a, b) => a.confidence - b.confidence)[0]!;
        endTask(m, victim, 'abandoned', now);
        events.push({ type: 'evicted', taskId: victim.id });
      }
      m.activeTasks.push(t);
      m.focus = t.id;
      return;
    }
    case 'attach_steps': {
      const t = m.activeTasks.find(x => x.id === op.taskId);
      if (!t) return `attach_steps: no active task ${op.taskId}`;
      for (const s of op.steps) {
        const i = t.stepRefs.findIndex(r => r.seq === s.seq);
        if (i >= 0) t.stepRefs[i] = s; else t.stepRefs.push(s);
      }
      t.stepRefs.sort((a, b) => a.seq - b.seq);
      if (op.confidence !== undefined) t.confidence = clamp01(op.confidence);
      if (op.expectedNext !== undefined) t.expectedNext = op.expectedNext || undefined;
      if (op.goal && op.goal !== t.goal) t.goal = op.goal;
      m.focus = t.id;
      return;
    }
    case 'fork_hypothesis': {
      const t = m.activeTasks.find(x => x.id === op.taskId);
      if (!t) return `fork_hypothesis: no active task ${op.taskId}`;
      const alts = (t.alternativeGoals ?? []).filter(g => g !== op.goal && g !== t.goal);
      alts.push(op.goal);
      t.alternativeGoals = alts.slice(-L.MAX_GOAL_READINGS);
      return;
    }
    case 'merge_hypotheses': {
      if (op.keepId === op.dropId) return 'merge_hypotheses: same id';
      const keep = m.activeTasks.find(x => x.id === op.keepId);
      const drop = m.activeTasks.find(x => x.id === op.dropId);
      if (!keep || !drop) return `merge_hypotheses: need two active tasks (${op.keepId}, ${op.dropId})`;
      for (const r of drop.stepRefs) if (!keep.stepRefs.some(k => k.seq === r.seq)) keep.stepRefs.push(r);
      keep.stepRefs.sort((a, b) => a.seq - b.seq);
      keep.slots = { ...drop.slots, ...keep.slots };
      keep.sites = [...new Set([...keep.sites, ...drop.sites])];
      keep.confidence = Math.max(keep.confidence, drop.confidence);
      m.activeTasks = m.activeTasks.filter(x => x.id !== drop.id);
      if (m.focus === drop.id) m.focus = keep.id;
      return;
    }
    case 'set_slot': {
      const t = findTask(m, op.taskId);
      if (!t) return `set_slot: no task ${op.taskId}`;
      t.slots[op.name] = { value: op.value.slice(0, 300), provenance: op.provenance };
      return;
    }
    case 'complete_task': {
      const t = m.activeTasks.find(x => x.id === op.taskId);
      if (!t) return `complete_task: no active task ${op.taskId}`;
      // §1.5 "Did it actually complete?": only with completion evidence; otherwise uncertain (never counts).
      const status = op.evidence.trim() ? 'completed' : 'uncertain';
      t.completionEvidence = op.evidence.trim() || undefined;
      endTask(m, t, status, now);
      countInstance(m, t, now);
      events.push({ type: 'completed', taskId: t.id, patternId: t.patternId, status });
      return;
    }
    case 'abandon_task': {
      const t = m.activeTasks.find(x => x.id === op.taskId);
      if (!t) return `abandon_task: no active task ${op.taskId}`;
      endTask(m, t, 'abandoned', now);
      events.push({ type: 'abandoned', taskId: t.id, reason: op.reason });
      return;
    }
    case 'link_pattern': {
      const t = findTask(m, op.taskId);
      if (!t) return `link_pattern: no task ${op.taskId}`;
      const p = m.patterns.find(x => x.id === op.patternId);
      if (!p) return `link_pattern: no pattern ${op.patternId}`;
      if (t.patternId && t.patternId !== p.id) {
        const old = m.patterns.find(x => x.id === t.patternId);
        if (old) old.instanceIds = old.instanceIds.filter(id => id !== t.id);
      }
      t.patternId = p.id;
      countInstance(m, t, now); // already-completed task linked later (reconsolidation)
      return;
    }
    case 'create_pattern': {
      if (m.patterns.some(x => x.id === op.pattern.id)) return `create_pattern: id ${op.pattern.id} exists`;
      const p: TaskPattern = { ...clone(op.pattern), instanceIds: [], lastSeen: now };
      m.patterns.push(p);
      if (m.patterns.length > L.MAX_PATTERNS) m.patterns.sort((a, b) => b.lastSeen - a.lastSeen).splice(L.MAX_PATTERNS);
      // instances given at creation still have to be COMPLETED tasks to count
      for (const id of op.pattern.instanceIds) { const t = findTask(m, id); if (t && !t.patternId) { t.patternId = p.id; countInstance(m, t, now); } }
      return;
    }
    case 'flag_opportunity': {
      const t = findTask(m, op.taskId);
      if (!t) return `flag_opportunity: no task ${op.taskId}`;
      events.push({ type: 'flag', taskId: t.id, reason: op.reason });
      return;
    }
  }
}

/** Pure reducer: (memory, ops) → new memory (input untouched) + events + per-op errors. */
export function reduceActivity(memory: WorkingMemory, ops: PatchOp[], now = Date.now()): ReduceResult {
  const m = clone(memory);
  const events: ReduceEvent[] = [];
  const errors: string[] = [];
  ops.forEach((op, i) => { const e = applyOne(m, op, events, now); if (e) errors.push(`#${i} ${e}`); });
  return { memory: m, events, errors };
}

/** Replay an op log (e.g. the persisted per-batch op history) from an initial memory. */
export function replayActivity(batches: Array<{ ops: PatchOp[]; at: number }>, initial: WorkingMemory = emptyMemory()): WorkingMemory {
  return batches.reduce((m, b) => reduceActivity(m, b.ops, b.at).memory, initial);
}

export function dismissPattern(m: WorkingMemory, patternId: string, reason: string): WorkingMemory {
  const n = clone(m);
  n.dismissed = [...n.dismissed.filter(d => d.patternId !== patternId), { patternId, reason }].slice(-L.MAX_DISMISSED);
  return n;
}

export function restorePattern(m: WorkingMemory, patternId: string): WorkingMemory {
  const n = clone(m);
  n.dismissed = n.dismissed.filter(d => d.patternId !== patternId);
  return n;
}
