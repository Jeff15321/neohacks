import { z } from 'zod';

/** Doc §1.4: Tier-2 activity model. Owned by Phase D. */

export const StepRole = z.enum(['essential', 'enabling', 'optional', 'noise']);

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
});
export type TaskInstance = z.infer<typeof TaskInstance>;

export const TaskPattern = z.object({
  id: z.string(),
  name: z.string(),
  abstractSteps: z.array(z.string()),
  parameters: z.array(z.object({ name: z.string(), io: z.enum(['input', 'output']), source: z.string() })),
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

export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('open_task'), task: TaskInstance }),
  z.object({ op: z.literal('attach_steps'), taskId: z.string(), steps: z.array(z.object({ seq: z.number(), role: StepRole })) }),
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
});
export type Suggestion = z.infer<typeof Suggestion>;
