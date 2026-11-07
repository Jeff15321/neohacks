import { z } from 'zod';
import { SemanticStep, Step } from './steps.js';
import { WorkflowSpec } from './workflow.js';

/** Doc §1.4: Tier-2 activity model. Owned by Phase D. */

export const StepRole = z.enum(['essential', 'enabling', 'optional', 'noise']);
export type StepRole = z.infer<typeof StepRole>;

export const ACTIVITY_LIMITS = { MAX_ACTIVE: 3, MAX_GOAL_READINGS: 2, MAX_RECENT_COMPLETED: 20, MAX_PATTERNS: 50, MAX_DISMISSED: 100 } as const;

export const TaskInstance = z.object({
  id: z.string(),
  goal: z.string(),
  patternId: z.string().optional(),
  status: z.enum(['active', 'completed', 'abandoned', 'uncertain']),
  confidence: z.number(),
  stepRefs: z.array(z.object({ seq: z.number(), role: StepRole })),
  slots: z.record(z.string(), z.object({ value: z.string(), provenance: z.string() })),
  completionEvidence: z.string().optional(),
  sites: z.array(z.string()),
  expectedNext: z.string().optional(),
  alternativeGoals: z.array(z.string()).max(2).optional(),
  /** Phase D: wall-clock of completion/abandon (display + cooldowns only; never used to decide boundaries). */
  endedAt: z.number().optional(),
});
export type TaskInstance = z.infer<typeof TaskInstance>;

export const TaskPattern = z.object({
  id: z.string(),
  name: z.string(),
  abstractSteps: z.array(z.string()),
  parameters: z.array(z.object({ name: z.string(), io: z.enum(['input', 'output']), source: z.string() })),
  /** COMPLETED instances only (uncertain/abandoned instances never count — §1.5). */
  instanceIds: z.array(z.string()),
  automationIdea: z.string().optional(),
  lastSeen: z.number(),
});
export type TaskPattern = z.infer<typeof TaskPattern>;

export const WorkingMemory = z.object({
  activeTasks: z.array(TaskInstance).max(3),
  recentCompleted: z.array(TaskInstance).max(20),
  patterns: z.array(TaskPattern),
  dismissed: z.array(z.object({ patternId: z.string(), reason: z.string() })),
  focus: z.string().nullable(),
});
export type WorkingMemory = z.infer<typeof WorkingMemory>;

const StepRefs = z.array(z.object({ seq: z.number(), role: StepRole }));

export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('open_task'), task: TaskInstance }),
  z.object({ op: z.literal('attach_steps'), taskId: z.string(), steps: StepRefs, confidence: z.number().optional(), expectedNext: z.string().optional(), goal: z.string().optional() }),
  z.object({ op: z.literal('fork_hypothesis'), taskId: z.string(), goal: z.string() }),
  z.object({ op: z.literal('merge_hypotheses'), keepId: z.string(), dropId: z.string() }),
  z.object({ op: z.literal('set_slot'), taskId: z.string(), name: z.string(), value: z.string(), provenance: z.string() }),
  z.object({ op: z.literal('complete_task'), taskId: z.string(), evidence: z.string() }),
  z.object({ op: z.literal('abandon_task'), taskId: z.string(), reason: z.string() }),
  z.object({ op: z.literal('link_pattern'), taskId: z.string(), patternId: z.string() }),
  z.object({ op: z.literal('create_pattern'), pattern: TaskPattern }),
  z.object({ op: z.literal('flag_opportunity'), taskId: z.string(), reason: z.string() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const Suggestion = z.object({
  id: z.string(),
  patternId: z.string(),
  title: z.string(),
  why: z.string(),
  score: z.number(),
  taskIds: z.array(z.string()),
  status: z.enum(['generating', 'ready', 'failed', 'dismissed', 'accepted']),
  jobId: z.string().optional(),
  /** Phase D widening: what the speculative generation job is asked to build. */
  request: z.string().optional(),
  spec: WorkflowSpec.optional(),
  /** Observed steps shown under "Details" (the explanation surface). */
  details: z.array(z.string()).optional(),
  origin: z.string().optional(),
  tabId: z.number().optional(),
  createdAt: z.number().optional(),
  error: z.string().optional(),
  widgetId: z.string().optional(),
  /** "Not now": hidden from the page, still listed in the Activity tab. */
  snoozed: z.boolean().optional(),
  /** Accept pressed while generating → open the approval card as soon as the job is ready. */
  acceptPending: z.boolean().optional(),
  traceId: z.string().optional(),
});
export type Suggestion = z.infer<typeof Suggestion>;

// ---------------------------------------------------------------- SW ↔ backend (/api/observe/*)

/** Judge output, as returned by the backend (the SW turns it into a Suggestion + a generation job). */
export const SuggestionCandidate = z.object({
  id: z.string(),
  patternId: z.string(),
  title: z.string(),
  why: z.string(),
  score: z.number(),
  taskIds: z.array(z.string()),
  request: z.string(),
  spec: WorkflowSpec.optional(),
  details: z.array(z.string()),
});
export type SuggestionCandidate = z.infer<typeof SuggestionCandidate>;

export const ObserveStepsRequest = z.object({
  steps: z.array(Step).min(1).max(60),
});
export type ObserveStepsRequest = z.infer<typeof ObserveStepsRequest>;

export const ObserveStepsResponse = z.object({
  ok: z.boolean(),
  state: WorkingMemory,
  semantic: z.array(SemanticStep),
  ops: z.array(PatchOp),
  suggestions: z.array(SuggestionCandidate),
  /** Pipeline diagnostics (Inspector): which tiers ran and why the Judge did / did not run. */
  diag: z.object({ tier1Ms: z.number(), tier2Ms: z.number(), judgeMs: z.number().optional(), reconsolidated: z.boolean(), judge: z.string(), opErrors: z.array(z.string()) }),
  error: z.string().optional(),
});
export type ObserveStepsResponse = z.infer<typeof ObserveStepsResponse>;

export const ObserveStateResponse = z.object({ ok: z.boolean(), state: WorkingMemory, semantic: z.array(SemanticStep) });
export type ObserveStateResponse = z.infer<typeof ObserveStateResponse>;

export const ObserveFeedbackRequest = z.object({ patternId: z.string().min(1).max(200), reason: z.string().max(500).optional() });
export type ObserveFeedbackRequest = z.infer<typeof ObserveFeedbackRequest>;
