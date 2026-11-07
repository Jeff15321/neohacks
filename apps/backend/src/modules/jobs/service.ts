import { EventEmitter } from 'node:events';
import { Job, JobResult, type StartJobRequest } from '@app/contracts';
import { isTerminal, randomId, transitionJob, type JobEvent } from '@app/core';
import type { ModuleDeps } from '../types.js';

/**
 * In-process background generation runner (doc §2: jobs survive SW death; the SW long-polls in 25 s slices).
 * State changes go through the pure `transitionJob` machine (packages/core/job-machine) and are persisted to the
 * `jobs` table (owned by this module). Generation itself is the generate module's service (`generate.widget`),
 * reached via the service registry — no module-internal imports.
 *
 * Cancel: marks the job `cancelled` immediately; the in-flight LLM call cannot be aborted (callModel has no signal),
 * so its late result is discarded by the state machine (terminal states are absorbing).
 */
export function createJobsService({ db, services }: ModuleDeps) {
  const ins = db.prepare('INSERT OR REPLACE INTO jobs (id, user_id, kind, status, created_at, updated_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const sel = db.prepare('SELECT body FROM jobs WHERE id = ?');
  const live = new Map<string, Job>();
  const owner = new Map<string, string | undefined>();
  const bus = new EventEmitter();
  bus.setMaxListeners(1000);

  // jobs that were running when the backend died will never finish → fail them (honest, not silently "running")
  try {
    const stale = db.prepare("SELECT body FROM jobs WHERE status IN ('queued','running')").all() as Array<{ body: string }>;
    for (const r of stale) {
      const j = Job.safeParse(JSON.parse(r.body));
      if (j.success) save(transitionJob(j.data, { type: 'fail', error: 'backend restarted while the job was running' }).job);
    }
  } catch { /* fresh db */ }

  function save(j: Job, userId?: string) {
    live.set(j.id, j);
    ins.run(j.id, userId ?? owner.get(j.id) ?? null, j.kind, j.status, j.createdAt, j.updatedAt, JSON.stringify(j));
    bus.emit(j.id, j);
  }
  function apply(id: string, ev: JobEvent): Job | undefined {
    const cur = get(id);
    if (!cur) return undefined;
    const { job, ignored } = transitionJob(cur, ev);
    if (!ignored) save(job);
    return job;
  }
  function get(id: string): Job | undefined {
    const j = live.get(id);
    if (j) return j;
    const row = sel.get(id) as { body: string } | undefined;
    if (!row) return undefined;
    const p = Job.safeParse(JSON.parse(row.body));
    return p.success ? p.data : undefined;
  }

  async function runJob(id: string, req: StartJobRequest, traceId: string) {
    if (apply(id, { type: 'start' })?.status !== 'running') return;
    try {
      const { kind: _k, dedupeKey: _d, ...body } = req;
      apply(id, { type: 'progress', progress: 'generating widget code' });
      const res = await services.use('generate.widget')(body, traceId);
      if (res.ok && res.widget) {
        const result = JobResult.parse({ widget: res.widget, warnings: res.warnings ?? [] });
        apply(id, { type: 'succeed', result });
      } else apply(id, { type: 'fail', error: res.error ?? 'generation failed' });
    } catch (e) {
      apply(id, { type: 'fail', error: String((e as Error)?.message ?? e).slice(0, 500) });
    }
  }

  return {
    /** Start (or reuse: same user + dedupeKey + not failed/cancelled → same job, §7 "one live job per pattern"). */
    start(req: StartJobRequest, traceId: string, userId?: string): Job {
      if (req.dedupeKey) {
        for (const j of live.values()) {
          if (j.dedupeKey === req.dedupeKey && owner.get(j.id) === userId && (j.status === 'queued' || j.status === 'running' || j.status === 'succeeded')) return j;
        }
      }
      const now = Date.now();
      const job: Job = { id: randomId('job'), kind: req.kind, status: 'queued', createdAt: now, updatedAt: now, traceId, progress: 'queued', ...(req.dedupeKey ? { dedupeKey: req.dedupeKey } : {}) };
      owner.set(job.id, userId);
      save(job, userId);
      setImmediate(() => void runJob(job.id, req, traceId));
      return job;
    },
    get,
    /** Long-poll: resolves immediately when terminal or changed since `sinceUpdatedAt`, else on the next change or after `waitS`. */
    wait(id: string, waitS: number, sinceUpdatedAt?: number): Promise<Job | undefined> {
      const j = get(id);
      if (!j || isTerminal(j.status) || waitS <= 0 || (sinceUpdatedAt !== undefined && j.updatedAt > sinceUpdatedAt)) return Promise.resolve(j);
      return new Promise(resolve => {
        const done = (v: Job | undefined) => { clearTimeout(timer); bus.off(id, onChange); resolve(v); };
        const onChange = (nj: Job) => done(nj);
        const timer = setTimeout(() => done(get(id)), waitS * 1000);
        bus.on(id, onChange);
      });
    },
    cancel(id: string): Job | undefined { return apply(id, { type: 'cancel' }); },
    ownerOf: (id: string) => owner.get(id),
  };
}
export type JobsService = ReturnType<typeof createJobsService>;
