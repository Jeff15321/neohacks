import type { Bus } from '../../bus.js';
import { JobClient } from './service.js';

/** Phase D: JobClient — background generation jobs (long-poll). See README.md. */
export function registerJobs(bus: Bus) {
  const jobs = new JobClient(bus);
  bus.provide('jobs.start', (req, traceId, onUpdate) => jobs.start(req, traceId, onUpdate));
  bus.provide('jobs.cancel', (id) => jobs.cancel(id));
  bus.provide('jobs.get', (id) => jobs.get(id));
  bus.on('JOBS_LIST', async () => { await jobs.ready; return { jobs: jobs.list() }; });
  bus.on('JOB_CANCEL', async (m) => { await jobs.cancel(m.jobId); });
  return jobs;
}
