/**
 * JobClient (Phase D): starts backend generation jobs and long-polls them in 25 s slices (doc §2 — the job lives
 * in the backend so it survives SW suspension). Known jobs are kept in storage.session and polling resumes after
 * an SW restart. Every change is broadcast (JOB_UPDATED) and delivered to the starter's `onUpdate`.
 */
import { Job, JobResponse, type StartJobRequest } from '@app/contracts';
import { isTerminal } from '@app/core';
import type { Bus } from '../../bus.js';
import { backend, storage } from '../../platform/index.js';

const KEY = 'wwa_jobs';
const WAIT_S = 25;

export class JobClient {
  private jobs = new Map<string, Job>();
  private listeners = new Map<string, Set<(j: Job) => void>>();
  private polling = new Set<string>();
  readonly ready: Promise<void>;

  constructor(private bus: Bus) {
    this.ready = (async () => {
      const saved = await storage.session.get<unknown[]>(KEY);
      for (const raw of saved ?? []) { const r = Job.safeParse(raw); if (r.success) this.jobs.set(r.data.id, r.data); }
      for (const j of this.jobs.values()) if (!isTerminal(j.status)) void this.poll(j.id);
    })();
  }

  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt); }
  get(id: string) { return this.jobs.get(id); }

  async start(req: StartJobRequest, traceId: string, onUpdate?: (j: Job) => void): Promise<Job> {
    await this.ready;
    const r = await backend.post<JobResponse>('/api/jobs', req, traceId);
    const job = r.ok && r.job ? Job.parse(r.job) : null;
    if (!job) throw new Error(r.error ?? 'job start failed');
    if (onUpdate) this.on(job.id, onUpdate);
    this.update(job);
    if (!isTerminal(job.status)) void this.poll(job.id);
    return job;
  }

  on(id: string, fn: (j: Job) => void) {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn);
    this.listeners.set(id, set);
  }

  async cancel(id: string) {
    const r = await backend.request<JobResponse>('DELETE', `/api/jobs/${encodeURIComponent(id)}`, undefined).catch(() => null);
    const j = r?.job ? Job.safeParse(r.job) : null;
    if (j?.success) this.update(j.data);
  }

  private update(job: Job) {
    const prev = this.jobs.get(job.id);
    this.jobs.set(job.id, job);
    if (this.jobs.size > 30) for (const old of this.list().slice(30)) this.jobs.delete(old.id);
    void storage.session.set(KEY, this.list());
    if (prev && prev.updatedAt === job.updatedAt && prev.status === job.status) return;
    this.bus.broadcast({ type: 'JOB_UPDATED', job, traceId: job.traceId });
    for (const fn of this.listeners.get(job.id) ?? []) { try { fn(job); } catch (e) { console.warn('[wwa] job listener failed', e); } }
  }

  /** Long-poll until terminal. Network errors back off (2 s → 30 s) instead of giving up. */
  private async poll(id: string) {
    if (this.polling.has(id)) return;
    this.polling.add(id);
    let backoff = 2000;
    try {
      for (;;) {
        const cur = this.jobs.get(id);
        if (!cur || isTerminal(cur.status)) return;
        try {
          const r = await backend.get<JobResponse>(`/api/jobs/${encodeURIComponent(id)}?wait=${WAIT_S}&since=${cur.updatedAt}`);
          const j = r.job ? Job.safeParse(r.job) : null;
          if (j?.success) this.update(j.data);
          else if (!r.ok) { this.update({ ...cur, status: 'failed', error: r.error ?? 'job lost', updatedAt: Date.now() }); return; }
          backoff = 2000;
        } catch (e) {
          if (/not found/i.test(String((e as Error)?.message))) { this.update({ ...cur, status: 'failed', error: 'job not found on the backend', updatedAt: Date.now() }); return; }
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    } finally { this.polling.delete(id); }
  }
}
