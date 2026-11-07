import { z } from 'zod';
import { LineageEdge, LocatorBundle } from './steps.js';

/** Doc §3: output of the Workflow Interpreter (recording → spec). Owned by Phase B. */
export const WorkflowSpec = z.object({
  goal: z.string(),
  trigger: z.object({ site: z.string(), placement: z.string() }),
  inputs: z.array(z.object({ name: z.string(), source: z.string() })),
  outputs: z.array(z.object({ name: z.string(), sink: z.string() })),
  steps: z.array(z.object({
    intent: z.string(),
    site: z.string(),
    role: z.enum(['essential', 'conditional', 'optional']),
    evidence: z.object({
      stepSeq: z.array(z.number()),
      locators: z.array(LocatorBundle).optional(),
      regionSkeleton: z.string().optional(),
      netOpIds: z.array(z.string()).optional(),
    }),
  })),
  dataFlow: z.array(LineageEdge),
  successCriteria: z.array(z.string()),
  consequentialActions: z.array(z.string()),
  strategyHints: z.array(z.object({ step: z.number(), strategy: z.enum(['dom', 'network', 'hybrid']), reason: z.string() })),
  openQuestions: z.array(z.string()),
});
export type WorkflowSpec = z.infer<typeof WorkflowSpec>;

export const RecordingStatus = z.enum(['recording', 'stopped', 'interpreting', 'ready']);
export type RecordingStatus = z.infer<typeof RecordingStatus>;

export const RecordingSession = z.object({
  id: z.string(),
  startedAt: z.number(),
  startTab: z.number(),
  tabs: z.array(z.number()),
  steps: z.array(z.number()),
  instructions: z.string().optional(),
  status: RecordingStatus,
  traceId: z.string().optional(),
});
export type RecordingSession = z.infer<typeof RecordingSession>;
