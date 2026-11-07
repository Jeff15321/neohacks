import { z } from 'zod';
import { LineageEdge, LocatorBundle, SemanticStep, SkeletonFragment, Step, StepNetEffect } from './steps.js';

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
  windowId: z.number().optional(),
  stoppedAt: z.number().optional(),
  /** Step seqs the user struck from the review sheet ("ignore step 3"). */
  struck: z.array(z.number()).optional(),
  /** Answers to the interpreter's openQuestions. */
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  error: z.string().optional(),
});
export type RecordingSession = z.infer<typeof RecordingSession>;

/** Compact per-Step evidence handed to the generator (§3 "spec + evidence fragments, not a click list"). */
export const EvidenceStep = z.object({
  seq: z.number(),
  kind: z.string(),
  url: z.string(),
  target: LocatorBundle.optional(),
  valuePreview: z.string().optional(),
  addedRegions: z.array(SkeletonFragment),
  liveRegionText: z.array(z.string()),
  net: z.array(StepNetEffect),
  meaning: z.string().optional(),
});
export type EvidenceStep = z.infer<typeof EvidenceStep>;

// ------------------------------------------------------------------ backend API (modules/recordings)

/** POST /api/recordings/steps/interpret — Tier-1 Step Interpreter (Haiku). */
export const InterpretStepsRequest = z.object({ steps: z.array(Step).min(1).max(20), recent: z.array(SemanticStep).max(20).optional() });
export type InterpretStepsRequest = z.infer<typeof InterpretStepsRequest>;
export const InterpretStepsResponse = z.object({ ok: z.boolean(), semantic: z.array(SemanticStep), error: z.string().optional() });
export type InterpretStepsResponse = z.infer<typeof InterpretStepsResponse>;

/** POST /api/recordings/interpret — Workflow Interpreter (Opus). */
export const InterpretRecordingRequest = z.object({
  recordingId: z.string(),
  steps: z.array(Step).min(1).max(200),
  semantic: z.array(SemanticStep).optional(),
  struck: z.array(z.number()).optional(),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  instructions: z.string().max(4000).optional(),
  /** Spec from the previous interpretation (re-interpret after edits). */
  prior: WorkflowSpec.optional(),
  pages: z.array(z.object({ url: z.string(), title: z.string(), skeleton: z.string().optional() })).max(10).optional(),
});
export type InterpretRecordingRequest = z.infer<typeof InterpretRecordingRequest>;
export const InterpretRecordingResponse = z.object({ ok: z.boolean(), spec: WorkflowSpec.optional(), error: z.string().optional(), traceId: z.string().optional() });
export type InterpretRecordingResponse = z.infer<typeof InterpretRecordingResponse>;
