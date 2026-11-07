import { z } from 'zod';
import { msg, usMsg } from './_msg.js';
import { FlowCallOpts, FlowRun } from '../flow.js';

/** Owner: Phase F (extension modules/flow). */
export const panel = [
  msg('GET_FLOW_RUNS', {}),
  msg('CANCEL_FLOW_RUN', { runId: z.string() }),
] as const;
export const page = [] as const;
export const toContent = [] as const;
/**
 * Home part: FLOW_CALL (starts a run, returns runId) → FLOW_WAIT (long-poll until terminal) / FLOW_CANCEL.
 * Sink part (widgetId "<id>#<role>"): FLOW_RESULT, FLOW_CHECKPOINT, FLOW_STATUS (cancelled?).
 */
export const userScript = [
  usMsg('FLOW_CALL', { role: z.string(), handler: z.string(), input: z.unknown(), opts: FlowCallOpts.optional() }),
  usMsg('FLOW_WAIT', { runId: z.string() }),
  usMsg('FLOW_CANCEL', { runId: z.string() }),
  usMsg('FLOW_RESULT', { runId: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
  usMsg('FLOW_CHECKPOINT', { runId: z.string(), state: z.unknown() }),
  usMsg('FLOW_STATUS', { runId: z.string() }),
] as const;
export const broadcast = [
  msg('FLOW_RUN_UPDATE', { run: FlowRun }),
] as const;
