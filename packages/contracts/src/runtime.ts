import { z } from 'zod';

/** Decision B: self-healing branching runtime (WidgetAI.step / WidgetAI.assist). Owned by Phase C. */

export const AssistDecision = z.object({
  /** Branch id to run, or "new" to request a newly written branch, or "stop". */
  choice: z.string(),
  reason: z.string(),
});
export type AssistDecision = z.infer<typeof AssistDecision>;

export const AssistNewBranch = z.object({
  id: z.string(),
  when: z.string(),
  /** Body of an async function receiving (state) and returning the new JSON state. */
  code: z.string(),
  reason: z.string(),
});
export type AssistNewBranch = z.infer<typeof AssistNewBranch>;

export const RunTimelineEvent = z.object({
  ts: z.number(),
  kind: z.enum(['step-start', 'step-ok', 'expect-fail', 'assist-decide', 'assist-create', 'branch-run', 'danger-blocked', 'danger-allowed', 'final-failure', 'completed']),
  step: z.string().optional(),
  detail: z.string().optional(),
  data: z.unknown().optional(),
});
export type RunTimelineEvent = z.infer<typeof RunTimelineEvent>;

export const DangerVerdict = z.object({
  dangerous: z.boolean(),
  reason: z.string().optional(),
  matched: z.string().optional(),
});
export type DangerVerdict = z.infer<typeof DangerVerdict>;
