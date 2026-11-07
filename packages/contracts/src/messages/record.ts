import { z } from 'zod';
import { msg } from './_msg.js';
import { SemanticStep, Step, StepDraft, StepLateEffects } from '../steps.js';
import { RecordingSession, WorkflowSpec } from '../workflow.js';
import { WidgetRecord } from '../widget.js';

/**
 * Owner: Phase B — Step pipeline (extension modules/observe: seq + store) and recording (modules/record).
 * All Phase-B messages live here (messages/observe.ts is left to Phase D).
 */
const Answers = z.array(z.object({ question: z.string().max(500), answer: z.string().max(2000) })).max(20);

export const panel = [
  /** Start a window-global recording on the active (or given) tab. Same as the toggle-recording command. */
  msg('REC_START', { tabId: z.number().optional() }),
  msg('REC_STOP', {}),
  /** Current/last session + its Steps + Tier-1 meanings + spec. */
  msg('REC_GET', {}),
  /** (Re-)run the Workflow Interpreter with review-sheet edits. */
  msg('REC_INTERPRET', { struck: z.array(z.number()).optional(), answers: Answers.optional(), instructions: z.string().max(4000).optional() }),
  /** Generate a widget from the session's spec (optionally user-edited). */
  msg('REC_GENERATE', { spec: WorkflowSpec.optional(), instructions: z.string().max(4000).optional() }),
  msg('REC_DISCARD', {}),
  /** Recent Steps from the observe store (Inspector). */
  msg('GET_STEPS', { limit: z.number().optional() }),
] as const;

/** content script → SW */
export const page = [
  msg('WWA_STEP', { step: StepDraft }),
  msg('WWA_STEP_LATE', { stepId: z.string(), late: StepLateEffects }),
  /** Content script asks on load whether to capture Steps / show the REC pill. */
  msg('WWA_REC_QUERY', {}),
  /** REC pill clicked. */
  msg('WWA_REC_STOP', {}),
] as const;

/** SW → content script */
export const toContent = [
  msg('WWA_REC_STATE', { capture: z.boolean(), recording: z.boolean(), stepCount: z.number().optional() }),
  /** Commit pending input + close the open Step now (before stop). */
  msg('WWA_STEPS_FLUSH', {}),
] as const;

export const userScript = [] as const;

export const broadcast = [
  msg('REC_STATE', { session: RecordingSession.nullable() }),
  msg('STEP_ADDED', { step: Step, recording: z.boolean() }),
  msg('STEP_UPDATED', { step: Step }),
  msg('STEP_MEANING', { seq: z.number(), semantic: SemanticStep }),
  msg('REC_SPEC', { spec: WorkflowSpec.nullable(), error: z.string().optional() }),
  msg('REC_WIDGET', { widget: WidgetRecord }),
] as const;
