/**
 * Jobs state machine (owner: Phase D): queued → running → succeeded | failed, and cancel from any non-terminal
 * state. Terminal states are absorbing — a late result for a cancelled job is discarded, never applied.
 * Pure: no chrome.* / node / fastify imports.
 */
import type { Job, JobResult, JobStatus } from '@app/contracts';

export type JobEvent =
  | { type: 'start' }
  | { type: 'progress'; progress: string }
  | { type: 'succeed'; result: JobResult }
  | { type: 'fail'; error: string }
  | { type: 'cancel' };

export const TERMINAL: ReadonlySet<JobStatus> = new Set(['succeeded', 'failed', 'cancelled']);
export const isTerminal = (s: JobStatus) => TERMINAL.has(s);

const NEXT: Record<JobStatus, Partial<Record<JobEvent['type'], JobStatus>>> = {
  queued: { start: 'running', cancel: 'cancelled', fail: 'failed' },
  running: { progress: 'running', succeed: 'succeeded', fail: 'failed', cancel: 'cancelled' },
  succeeded: {}, failed: {}, cancelled: {},
};

/** Returns the next job, or `{job, ignored:true}` (unchanged) when the event is not allowed in this state. */
export function transitionJob(job: Job, ev: JobEvent, now = Date.now()): { job: Job; ignored: boolean } {
  const to = NEXT[job.status][ev.type];
  if (!to) return { job, ignored: true };
  const next: Job = { ...job, status: to, updatedAt: now };
  if (ev.type === 'progress') next.progress = ev.progress;
  if (ev.type === 'start') next.progress = 'running';
  if (ev.type === 'succeed') { next.result = ev.result; next.progress = 'done'; }
  if (ev.type === 'fail') { next.error = ev.error; next.progress = 'failed'; }
  if (ev.type === 'cancel') next.progress = 'cancelled';
  return { job: next, ignored: false };
}
