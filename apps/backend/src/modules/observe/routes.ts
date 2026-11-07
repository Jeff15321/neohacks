import { ObserveFeedbackRequest, ObserveStepsRequest } from '@app/contracts';
import { parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { createObserveService } from './service.js';

/**
 * Phase D: passive activity model (doc §1.4). HTTP only; logic in service.ts.
 * WorkingMemory is keyed by the install id (`x-user-id`; "anon" without one).
 */
export const registerObserve: RegisterModule = (app, deps) => {
  const svc = createObserveService(deps);
  const uid = (u?: string) => u ?? 'anon';
  app.post('/api/observe/steps', async (req) => {
    const body = parseOr400(ObserveStepsRequest, req.body, 'POST /api/observe/steps');
    return svc.processSteps(uid(req.userId), body.steps, req.traceId, body.eval);
  });
  app.get('/api/observe/state', async (req) => {
    const s = svc.state(uid(req.userId));
    return { ok: true, state: s.memory, semantic: s.semantic, opLog: s.opLog };
  });
  app.post('/api/observe/dismiss', async (req) => {
    const body = parseOr400(ObserveFeedbackRequest, req.body, 'POST /api/observe/dismiss');
    return { ok: true, state: await svc.dismiss(uid(req.userId), body.patternId, body.reason ?? 'never for this') };
  });
  app.post('/api/observe/restore', async (req) => {
    const body = parseOr400(ObserveFeedbackRequest, req.body, 'POST /api/observe/restore');
    return { ok: true, state: await svc.restore(uid(req.userId), body.patternId) };
  });
  app.delete('/api/observe/state', async (req) => ({ ok: true, state: await svc.clear(uid(req.userId)) }));
};
