import { z } from '@app/contracts';
import { listLlmCalls } from '../../llm/callModel.js';
import { parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';

const Query = z.object({ traceId: z.string().max(64).optional(), limit: z.coerce.number().optional() });

/** Debuggability endpoints (Inspector). Auth-guarded like every /api route. */
export const registerDebug: RegisterModule = (app, { db }) => {
  app.get('/api/debug/llm-calls', async (req) => {
    const q = parseOr400(Query, req.query, 'GET /api/debug/llm-calls');
    return { ok: true, calls: listLlmCalls(db, q) };
  });
};
