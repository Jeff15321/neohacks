import { AssistCreateRequest, AssistDecideRequest } from '@app/contracts';
import { parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { createAssistService } from './service.js';

/** Self-healing runtime agent (HTTP only; logic in service.ts). */
export const registerAssist: RegisterModule = (app, deps) => {
  const svc = createAssistService(deps);
  app.post('/api/assist/decide', async (req, reply) => {
    const body = parseOr400(AssistDecideRequest, req.body, 'POST /api/assist/decide');
    const res = await svc.decide(body, req.traceId);
    if (!res.ok) reply.code(422);
    return res;
  });
  app.post('/api/assist/create', async (req, reply) => {
    const body = parseOr400(AssistCreateRequest, req.body, 'POST /api/assist/create');
    const res = await svc.create(body, req.traceId);
    if (!res.ok) reply.code(422);
    return res;
  });
};
