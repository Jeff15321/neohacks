import { z } from 'zod';

/** Background generation jobs. Owned by Phase D. */

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z.object({
  id: z.string(),
  kind: z.enum(['generate', 'regenerate']),
  status: JobStatus,
  progress: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  traceId: z.string().optional(),
});
export type Job = z.infer<typeof Job>;
