import { GenerateWidgetRequest } from '@app/contracts';
import { parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { createGenerateService } from './service.js';

export const registerGenerate: RegisterModule = (app, deps) => {
  const svc = createGenerateService(deps);
  app.post('/api/generate-widget', async (req, reply) => {
    const body = parseOr400(GenerateWidgetRequest, req.body, 'POST /api/generate-widget');
    const res = await svc.generateWidget(body, req.traceId);
    if (!res.ok) reply.code(422);
    return res;
  });
};
