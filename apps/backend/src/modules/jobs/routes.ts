import { JOB_LIMITS, StartJobRequest, z } from '@app/contracts';
import { HttpError, parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { createJobsService } from './service.js';

const WaitQuery = z.object({ wait: z.coerce.number().min(0).max(JOB_LIMITS.MAX_WAIT_S).optional(), since: z.coerce.number().optional() });

/** Phase D: background generation jobs (doc §2). HTTP only; logic in service.ts. */
export const registerJobs: RegisterModule = (app, deps) => {
  const svc = createJobsService(deps);
  const mustGet = (id: string, userId?: string) => {
    const j = svc.get(id);
    const owner = svc.ownerOf(id);
    if (!j || (owner && userId && owner !== userId)) throw new HttpError(404, `job ${id} not found`, 'not_found');
    return j;
  };
  app.post('/api/jobs', async (req) => {
    const body = parseOr400(StartJobRequest, req.body, 'POST /api/jobs');
    return { ok: true, job: svc.start(body, req.traceId, req.userId) };
  });
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    mustGet(req.params.id, req.userId);
    const q = parseOr400(WaitQuery, req.query, 'GET /api/jobs/:id');
    return { ok: true, job: await svc.wait(req.params.id, q.wait ?? 0, q.since) };
  });
  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    mustGet(req.params.id, req.userId);
    return { ok: true, job: svc.cancel(req.params.id) };
  });
};
