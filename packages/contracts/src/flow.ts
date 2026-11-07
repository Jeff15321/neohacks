import { z } from 'zod';

/** Doc §5: cross-site flows. Owned by Phase F. */

export const FLOW_LIMITS = {
  /** Default / max run timeout (chrome.alarms; min alarm delay in Chrome is 30 s for packed, ~any for unpacked). */
  DEFAULT_TIMEOUT_MS: 120_000,
  MAX_TIMEOUT_MS: 600_000,
  /** Re-injections after mid-handler navigations before the run fails. */
  MAX_INJECTIONS: 5,
  /** Finished runs kept for the panel trace. */
  HISTORY: 30,
  /** FLOW_WAIT long-poll slice. */
  WAIT_SLICE_MS: 20_000,
  MAX_JSON_BYTES: 64_000,
} as const;

export const PART_ROLE_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const HANDLER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

export const WidgetPart = z.object({
  role: z.string(),
  matchPatterns: z.array(z.string()),
  code: z.string(),
  entryUrl: z.string().optional(),
  handlers: z.array(z.string()).optional(),
});
export type WidgetPart = z.infer<typeof WidgetPart>;

export const FlowRunStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type FlowRunStatus = z.infer<typeof FlowRunStatus>;

/** Coordinator sub-stage of a non-terminal run (for resume decisions + the panel). */
export const FlowStage = z.enum(['opening', 'loading', 'injected', 'done']);
export type FlowStage = z.infer<typeof FlowStage>;

export const FlowCallOpts = z.object({
  openUrl: z.string().optional(),
  reuseTab: z.boolean().optional(),
  activate: z.boolean().optional(),
  timeoutMs: z.number().optional(),
});
export type FlowCallOpts = z.infer<typeof FlowCallOpts>;

export const FlowEvent = z.object({ ts: z.number(), event: z.string(), detail: z.string().optional() });

export const FlowRun = z.object({
  runId: z.string(),
  widgetId: z.string(),
  role: z.string(),
  handler: z.string(),
  input: z.unknown(),
  status: FlowRunStatus,
  stage: FlowStage.optional(),
  checkpoint: z.unknown().optional(),
  homeTabId: z.number(),
  targetTabId: z.number().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  deadline: z.number().optional(),
  injections: z.number().optional(),
  activate: z.boolean().optional(),
  traceId: z.string().optional(),
  events: z.array(FlowEvent).optional(),
});
export type FlowRun = z.infer<typeof FlowRun>;

/** What a sink handler must return (doc §5.8): evidence read back from the target site. */
export const FlowSinkResult = z.object({
  ok: z.boolean(),
  evidence: z.object({ url: z.string().optional(), id: z.string().optional(), text: z.string().optional() }).optional(),
}).passthrough();
export type FlowSinkResult = z.infer<typeof FlowSinkResult>;
