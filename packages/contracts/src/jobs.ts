import { z } from 'zod';
import { GenerateWidgetRequest } from './api.js';
import { GeneratedWidget } from './widget.js';

/** Background generation jobs. Owned by Phase D. */

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobResult = z.object({ widget: GeneratedWidget, warnings: z.array(z.string()) });
export type JobResult = z.infer<typeof JobResult>;

export const Job = z.object({
  id: z.string(),
  kind: z.enum(['generate', 'regenerate']),
  status: JobStatus,
  progress: z.string().optional(),
  result: JobResult.optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  traceId: z.string().optional(),
  /** Suggestion pipeline dedupe: one live job per pattern, reused while the spec hash is unchanged (§7). */
  dedupeKey: z.string().optional(),
});
export type Job = z.infer<typeof Job>;

/** POST /api/jobs — `{kind, request, spec?, pageContext}` (doc §2) = a GenerateWidgetRequest + kind. */
export const StartJobRequest = GenerateWidgetRequest.extend({
  kind: z.enum(['generate', 'regenerate']),
  dedupeKey: z.string().max(200).optional(),
});
export type StartJobRequest = z.infer<typeof StartJobRequest>;

export const JobResponse = z.object({ ok: z.boolean(), job: Job.optional(), error: z.string().optional() });
export type JobResponse = z.infer<typeof JobResponse>;

export const JOB_LIMITS = { MAX_WAIT_S: 25 } as const;
