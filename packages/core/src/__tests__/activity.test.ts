import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Job, PatchOp, Suggestion, TaskInstance, WorkingMemory } from '@app/contracts';
import { WorkingMemory as WM } from '@app/contracts';
import {
  emptyMemory, reduceActivity, replayActivity, completedInstances, dismissPattern, restorePattern,
  gateJudge, admitSuggestion, judgeScore, specHash, transitionJob, isTerminal, SUGGEST_LIMITS,
} from '../index.js';

const task = (id: string, extra: Partial<TaskInstance> = {}): TaskInstance => ({
  id, goal: `goal ${id}`, status: 'active', confidence: 0.6, stepRefs: [], slots: {}, sites: ['http://x'], ...extra,
});
const pattern = (id: string): PatchOp => ({ op: 'create_pattern', pattern: { id, name: 'Reply to email', abstractSteps: ['open', 'reply', 'type'], parameters: [], instanceIds: [], lastSeen: 0 } });
/** One full "reply" task instance as Tier 2 would emit it. */
const replyInstance = (id: string, seq: number, evidence = 'Draft saved', flag = false): PatchOp[] => [
  { op: 'open_task', task: task(id) },
  { op: 'attach_steps', taskId: id, steps: [{ seq, role: 'essential' }, { seq: seq + 1, role: 'essential' }], confidence: 0.8, goal: 'Reply to email' },
  { op: 'set_slot', taskId: id, name: 'replyText', value: 'Thanks', provenance: 'user-authored' },
  { op: 'link_pattern', taskId: id, patternId: 'p_reply' },
  { op: 'complete_task', taskId: id, evidence },
  ...(flag ? [{ op: 'flag_opportunity', taskId: id, reason: 'repeat' } as PatchOp] : []),
];

// ---------------------------------------------------------------- reducer
test('reducer: open/attach/slot/link/complete → recentCompleted + completed instance counted', () => {
  const r = reduceActivity(emptyMemory(), [pattern('p_reply'), ...replyInstance('t1', 1)], 1000);
  assert.deepEqual(r.errors, []);
  assert.equal(r.memory.activeTasks.length, 0);
  assert.equal(r.memory.recentCompleted[0]!.status, 'completed');
  assert.equal(r.memory.recentCompleted[0]!.goal, 'Reply to email');
  assert.equal(r.memory.recentCompleted[0]!.slots.replyText!.provenance, 'user-authored');
  assert.deepEqual(r.memory.recentCompleted[0]!.stepRefs.map(s => s.seq), [1, 2]);
  assert.equal(completedInstances(r.memory, 'p_reply'), 1);
  assert.deepEqual(r.events.map(e => e.type), ['completed']);
  assert.ok(WM.safeParse(r.memory).success, 'result validates against the WorkingMemory schema');
});

test('reducer is pure: input memory untouched', () => {
  const m0 = emptyMemory();
  const snap = JSON.stringify(m0);
  reduceActivity(m0, [pattern('p'), { op: 'open_task', task: task('a') }]);
  assert.equal(JSON.stringify(m0), snap);
});

test('reducer: complete without evidence → uncertain, never counted', () => {
  const r = reduceActivity(emptyMemory(), [pattern('p_reply'), ...replyInstance('t1', 1, '  ')]);
  assert.equal(r.memory.recentCompleted[0]!.status, 'uncertain');
  assert.equal(completedInstances(r.memory, 'p_reply'), 0);
});

test('reducer: ≤3 active tasks — lowest confidence evicted as abandoned', () => {
  const r = reduceActivity(emptyMemory(), [
    { op: 'open_task', task: task('a', { confidence: 0.9 }) },
    { op: 'open_task', task: task('b', { confidence: 0.2 }) },
    { op: 'open_task', task: task('c', { confidence: 0.5 }) },
    { op: 'open_task', task: task('d', { confidence: 0.7 }) },
  ]);
  assert.deepEqual(r.memory.activeTasks.map(t => t.id), ['a', 'c', 'd']);
  assert.equal(r.memory.recentCompleted[0]!.id, 'b');
  assert.equal(r.memory.recentCompleted[0]!.status, 'abandoned');
  assert.equal(r.memory.focus, 'd');
  assert.ok(r.events.some(e => e.type === 'evicted' && e.taskId === 'b'));
});

test('reducer: ≤2 goal readings; merge folds steps/slots; abandon; invalid ops reported not thrown', () => {
  const r = reduceActivity(emptyMemory(), [
    { op: 'open_task', task: task('a') },
    { op: 'fork_hypothesis', taskId: 'a', goal: 'g1' },
    { op: 'fork_hypothesis', taskId: 'a', goal: 'g2' },
    { op: 'fork_hypothesis', taskId: 'a', goal: 'g3' },
    { op: 'open_task', task: task('b', { stepRefs: [{ seq: 9, role: 'enabling' }], slots: { s: { value: 'v', provenance: 'page' } } }) },
    { op: 'merge_hypotheses', keepId: 'a', dropId: 'b' },
    { op: 'attach_steps', taskId: 'zzz', steps: [{ seq: 1, role: 'noise' }] },
    { op: 'complete_task', taskId: 'b', evidence: 'x' },
    { op: 'open_task', task: task('a') },
  ]);
  const a = r.memory.activeTasks.find(t => t.id === 'a')!;
  assert.deepEqual(a.alternativeGoals, ['g2', 'g3']);
  assert.deepEqual(a.stepRefs.map(s => s.seq), [9]);
  assert.equal(a.slots.s!.value, 'v');
  assert.equal(r.memory.activeTasks.length, 1);
  assert.equal(r.errors.length, 3);
  const r2 = reduceActivity(r.memory, [{ op: 'abandon_task', taskId: 'a', reason: 'moved on' }]);
  assert.equal(r2.memory.activeTasks.length, 0);
  assert.equal(r2.memory.recentCompleted.at(-1)!.status, 'abandoned');
  assert.equal(r2.memory.focus, null);
});

test('reducer: recentCompleted capped at 20 (oldest dropped); link_pattern after completion counts (reconsolidation)', () => {
  let m: WorkingMemory = reduceActivity(emptyMemory(), [pattern('p_reply')]).memory;
  for (let i = 0; i < 25; i++) m = reduceActivity(m, [{ op: 'open_task', task: task(`t${i}`) }, { op: 'complete_task', taskId: `t${i}`, evidence: 'ok' }]).memory;
  assert.equal(m.recentCompleted.length, 20);
  assert.equal(m.recentCompleted[0]!.id, 't5');
  assert.equal(completedInstances(m, 'p_reply'), 0);
  m = reduceActivity(m, [{ op: 'link_pattern', taskId: 't24', patternId: 'p_reply' }, { op: 'link_pattern', taskId: 't23', patternId: 'p_reply' }]).memory;
  assert.equal(completedInstances(m, 'p_reply'), 2);
});

test('reducer: replayable from an op log (same final state)', () => {
  const batches = [
    { ops: [pattern('p_reply'), ...replyInstance('t1', 1)], at: 1 },
    { ops: replyInstance('t2', 5), at: 2 },
    { ops: [{ op: 'open_task', task: task('t3') } as PatchOp], at: 3 },
  ];
  let live = emptyMemory();
  for (const b of batches) live = reduceActivity(live, b.ops, b.at).memory;
  assert.deepEqual(replayActivity(batches), live);
  assert.equal(completedInstances(live, 'p_reply'), 2);
});

// ---------------------------------------------------------------- suggestion gating
const run = (batches: PatchOp[][]) => {
  let m = emptyMemory();
  let last = reduceActivity(m, []);
  for (const ops of batches) { last = reduceActivity(m, ops, 100); m = last.memory; }
  return last;
};

test('gate: 1st completed instance (even flagged) → no judge; 2nd flagged → judge', () => {
  const first = run([[pattern('p_reply'), ...replyInstance('t1', 1, 'Draft saved', true)]]);
  const g1 = gateJudge({ memory: first.memory, events: first.events, suggested: [], now: 1000 });
  assert.equal(g1.candidate, undefined);
  assert.match(g1.reason, /1 completed instance/);
  const second = reduceActivity(first.memory, replyInstance('t2', 5, 'Draft saved', true), 200);
  const g2 = gateJudge({ memory: second.memory, events: second.events, suggested: [], now: 1000 });
  assert.equal(g2.candidate?.patternId, 'p_reply');
  assert.equal(g2.candidate?.instances, 2);
});

test('gate: not at a task boundary / not flagged / dismissed / cooldown / uncertain → no judge', () => {
  const base = run([[pattern('p_reply'), ...replyInstance('t1', 1)]]).memory;
  const noBoundary = reduceActivity(base, [{ op: 'open_task', task: task('t2') }, { op: 'flag_opportunity', taskId: 't2', reason: 'x' }]);
  assert.match(gateJudge({ memory: noBoundary.memory, events: noBoundary.events, suggested: [], now: 0 }).reason, /no task boundary/);
  const unflagged = reduceActivity(base, replyInstance('t2', 5));
  assert.match(gateJudge({ memory: unflagged.memory, events: unflagged.events, suggested: [], now: 0 }).reason, /not flagged/);
  const second = reduceActivity(base, replyInstance('t2', 5, 'saved', true));
  const dm = dismissPattern(second.memory, 'p_reply', 'never');
  assert.match(gateJudge({ memory: dm, events: second.events, suggested: [], now: 0 }).reason, /dismissed/);
  assert.ok(gateJudge({ memory: restorePattern(dm, 'p_reply'), events: second.events, suggested: [], now: 0 }).candidate);
  assert.match(gateJudge({ memory: second.memory, events: second.events, suggested: [{ patternId: 'p_reply', at: 0 }], now: 1000 }).reason, /cooldown/);
  assert.ok(gateJudge({ memory: second.memory, events: second.events, suggested: [{ patternId: 'p_reply', at: 0 }], now: SUGGEST_LIMITS.PATTERN_COOLDOWN_MS + 1 }).candidate);
  const unc = reduceActivity(base, replyInstance('t2', 5, '', true));
  assert.match(gateJudge({ memory: unc.memory, events: unc.events, suggested: [], now: 0 }).reason, /uncertain/);
});

test('gate: 1 instance + strong mechanical-transfer evidence (≥3 lineage edges) → judge', () => {
  const first = run([[pattern('p_reply'), ...replyInstance('t1', 1, 'Issue created', true)]]);
  assert.equal(gateJudge({ memory: first.memory, events: first.events, suggested: [], lineageByTask: { t1: 2 }, now: 0 }).candidate, undefined);
  const g = gateJudge({ memory: first.memory, events: first.events, suggested: [], lineageByTask: { t1: 3 }, now: 0 });
  assert.equal(g.candidate?.mechanical, true);
});

const sug = (id: string, patternId: string, extra: Partial<Suggestion> = {}): Suggestion => ({ id, patternId, title: 't', why: 'w', score: 0.5, taskIds: [], status: 'ready', ...extra });

test('dedupe: dismissed pattern / live suggestion for pattern / one visible at a time (higher score replaces)', () => {
  assert.equal(admitSuggestion([], { patternId: 'p', score: 0.5 }, new Set(['p'])).admit, false);
  assert.equal(admitSuggestion([sug('s1', 'p')], { patternId: 'p', score: 0.9 }, new Set()).admit, false);
  assert.equal(admitSuggestion([sug('s1', 'p', { status: 'dismissed' })], { patternId: 'p', score: 0.5 }, new Set()).admit, true);
  assert.equal(admitSuggestion([sug('s1', 'q', { score: 0.6 })], { patternId: 'p', score: 0.5 }, new Set()).admit, false);
  assert.deepEqual(admitSuggestion([sug('s1', 'q', { score: 0.4 })], { patternId: 'p', score: 0.5 }, new Set()), { admit: true, reason: 'outranks s1', replace: 's1' });
  assert.equal(admitSuggestion([sug('s1', 'q', { snoozed: true })], { patternId: 'p', score: 0.1 }, new Set()).admit, true);
  assert.equal(judgeScore({ value: 0.9, confidence: 0.8, feasibility: 0.5 }), 0.36);
  assert.equal(specHash({ a: 1 }), specHash({ a: 1 }));
  assert.notEqual(specHash({ a: 1 }), specHash({ a: 2 }));
});

// ---------------------------------------------------------------- job state machine
test('job machine: queued→running→succeeded; cancel absorbs late results; illegal events ignored', () => {
  const j0: Job = { id: 'j', kind: 'generate', status: 'queued', createdAt: 0, updatedAt: 0 };
  const j1 = transitionJob(j0, { type: 'start' }, 1).job;
  assert.equal(j1.status, 'running');
  assert.equal(transitionJob(j0, { type: 'succeed', result: { widget: {} as never, warnings: [] } }).ignored, true);
  const done = transitionJob(j1, { type: 'succeed', result: { widget: { name: 'w' } as never, warnings: [] } }, 2).job;
  assert.equal(done.status, 'succeeded');
  assert.ok(isTerminal(done.status));
  const cancelled = transitionJob(j1, { type: 'cancel' }, 3).job;
  assert.equal(cancelled.status, 'cancelled');
  const late = transitionJob(cancelled, { type: 'succeed', result: { widget: { name: 'w' } as never, warnings: [] } });
  assert.equal(late.ignored, true);
  assert.equal(late.job.result, undefined);
  assert.equal(transitionJob(done, { type: 'cancel' }).ignored, true);
  assert.equal(transitionJob(j1, { type: 'fail', error: 'boom' }).job.error, 'boom');
});
