import { InterpretRecordingRequest, InterpretStepsRequest } from '@app/contracts';
import { parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { createRecordingsService } from './service.js';

/** Phase B: Tier-1 Step Interpreter + Workflow Interpreter (recording → WorkflowSpec). HTTP only; logic in service.ts. */
export const registerRecordings: RegisterModule = (app, deps) => {
  const svc = createRecordingsService(deps);
  deps.services.provide('steps.interpret', (req, traceId) => svc.interpretSteps(req, traceId)); // Phase D: observe Tier 1
  app.post('/api/recordings/steps/interpret', async (req, reply) => {
    const body = parseOr400(InterpretStepsRequest, req.body, 'POST /api/recordings/steps/interpret');
    const res = await svc.interpretSteps(body, req.traceId);
    if (!res.ok) reply.code(422);
    return res;
  });
  app.post('/api/recordings/interpret', async (req, reply) => {
    const body = parseOr400(InterpretRecordingRequest, req.body, 'POST /api/recordings/interpret');
    const res = await svc.interpretRecording(body, req.traceId, req.headers['x-user-id'] as string | undefined);
    if (!res.ok) reply.code(422);
    return res;
  });
};
