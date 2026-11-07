import { z } from 'zod';

/** Decision B: self-healing branching runtime (WidgetAI.step / WidgetAI.assist). Owned by Phase C. */

/** Caps (doc: ≤2 recovery attempts per step, ≤5 interventions per run, per-run timeout). */
export const ASSIST_LIMITS = {
  MAX_ATTEMPTS_PER_STEP: 2,
  MAX_INTERVENTIONS_PER_RUN: 5,
  RUN_TIMEOUT_MS: 300_000,
  DOM_SKELETON_CHARS: 12_000,
  STATE_CHARS: 8_000,
  BRANCH_CODE_CHARS: 12_000,
  RUNS_KEPT: 30,
  EVENTS_PER_RUN: 200,
} as const;

export const AssistDecision = z.object({
  /** Branch id to run, or "new" to request a newly written branch, or "stop". */
  choice: z.string(),
  reason: z.string(),
});
export type AssistDecision = z.infer<typeof AssistDecision>;

export const AssistNewBranch = z.object({
  id: z.string(),
  when: z.string(),
  /** Body of an async function receiving (state, h) and returning the new JSON state. */
  code: z.string(),
  reason: z.string(),
});
export type AssistNewBranch = z.infer<typeof AssistNewBranch>;

export const RunEventKind = z.enum([
  'run-start', 'step-start', 'step-ok', 'expect-fail', 'recheck-ok', 'assist-decide', 'assist-create', 'assist-escalate',
  'branch-run', 'branch-result', 'danger-blocked', 'danger-allowed', 'cap', 'final-failure', 'completed', 'learned-branch',
]);
export type RunEventKind = z.infer<typeof RunEventKind>;

export const RunTimelineEvent = z.object({
  ts: z.number(),
  kind: RunEventKind,
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

export const StepBranchInfo = z.object({ id: z.string().max(80), when: z.string().max(300) });
export type StepBranchInfo = z.infer<typeof StepBranchInfo>;

/** What the prelude reports when a step's postcondition fails (or a multiOutcome step needs a choice). */
export const StepFailureReport = z.object({
  runId: z.string().max(60),
  step: z.string().max(120),
  goal: z.string().max(1000),
  expected: z.string().max(1000),
  observed: z.string().max(2000),
  error: z.string().max(2000).optional(),
  attempt: z.number().int().min(1),
  multiOutcome: z.boolean().optional(),
  branches: z.array(StepBranchInfo).max(10),
  tried: z.array(z.string().max(80)).max(10),
  lastActions: z.array(z.string().max(300)).max(20),
  /** Compact DOM skeleton of the relevant region (UNTRUSTED page content). */
  dom: z.string().max(ASSIST_LIMITS.DOM_SKELETON_CHARS),
  url: z.string().max(2000),
  /** Explicit JSON state handed to branches (in) and returned by them (out). */
  state: z.unknown().optional(),
});
export type StepFailureReport = z.infer<typeof StepFailureReport>;

/** SW → backend POST /api/assist/decide (Haiku). */
export const AssistDecideRequest = StepFailureReport.omit({ runId: true, state: true }).extend({ widgetName: z.string().max(200).optional() });
export type AssistDecideRequest = z.infer<typeof AssistDecideRequest>;
export const AssistDecideResponse = z.object({ ok: z.boolean(), decision: AssistDecision.optional(), error: z.string().optional() });
export type AssistDecideResponse = z.infer<typeof AssistDecideResponse>;

/** SW → backend POST /api/assist/create (tier create = Sonnet, escalate = one Opus attempt). */
export const AssistCreateRequest = AssistDecideRequest.extend({
  tier: z.enum(['create', 'escalate']),
  stateKeys: z.array(z.string().max(80)).max(40).optional(),
  /** compact JSON preview of the run state (core stateShapePreview) so the branch writer uses real ids/indices */
  stateShape: z.string().max(1400).optional(),
  previous: z.object({ code: z.string().max(ASSIST_LIMITS.BRANCH_CODE_CHARS), error: z.string().max(2000) }).optional(),
});
export type AssistCreateRequest = z.infer<typeof AssistCreateRequest>;
export const AssistCreateResponse = z.object({
  ok: z.boolean(), branch: AssistNewBranch.optional(), error: z.string().optional(),
  review: z.object({ safe: z.boolean(), issues: z.array(z.string()) }).optional(),
});
export type AssistCreateResponse = z.infer<typeof AssistCreateResponse>;

/** SW → prelude reply to WIDGET_ASSIST. */
export const AssistAction = z.object({
  action: z.enum(['branch', 'new', 'stop']),
  source: z.enum(['decide', 'create', 'escalate', 'learned', 'cap', 'disabled']),
  reason: z.string(),
  branchId: z.string().optional(),
  /** For action "new": result of executing the new branch in the widget's worldId. */
  result: z.object({ ok: z.boolean(), state: z.unknown().optional(), error: z.string().optional() }).optional(),
});
export type AssistAction = z.infer<typeof AssistAction>;

export const LearnedBranch = z.object({
  step: z.string(),
  id: z.string(),
  when: z.string(),
  code: z.string(),
  reason: z.string(),
  status: z.enum(['candidate', 'pending', 'accepted', 'dismissed']),
});
export type LearnedBranch = z.infer<typeof LearnedBranch>;

export const WidgetRun = z.object({
  id: z.string(),
  widgetId: z.string(),
  widgetName: z.string().optional(),
  version: z.number().optional(),
  traceId: z.string().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  interventions: z.number(),
  events: z.array(RunTimelineEvent),
  narrative: z.string().optional(),
  learned: z.array(LearnedBranch),
});
export type WidgetRun = z.infer<typeof WidgetRun>;
