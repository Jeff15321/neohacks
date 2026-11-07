import { z } from 'zod';

/** Doc §5: cross-site flows. Owned by Phase F. */

export const WidgetPart = z.object({
  role: z.string(),
  matchPatterns: z.array(z.string()),
  code: z.string(),
  entryUrl: z.string().optional(),
  handlers: z.array(z.string()).optional(),
});
export type WidgetPart = z.infer<typeof WidgetPart>;

export const FlowRunStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

export const FlowRun = z.object({
  runId: z.string(),
  widgetId: z.string(),
  role: z.string(),
  handler: z.string(),
  input: z.unknown(),
  status: FlowRunStatus,
  checkpoint: z.unknown().optional(),
  homeTabId: z.number(),
  targetTabId: z.number().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
});
export type FlowRun = z.infer<typeof FlowRun>;
