import { z } from 'zod';
import { msg, usMsg } from './_msg.js';
import { RunTimelineEvent, StepFailureReport, WidgetRun } from '../runtime.js';

/** Owner: Phase C (extension modules/assist). */
export const panel = [
  msg('GET_RUNS', { widgetId: z.string().optional(), limit: z.number().optional() }),
  /** "The agent fixed step X: add this branch to the widget?" → accept creates a new (unapproved) widget version. */
  msg('LEARNED_BRANCH_DECISION', { runId: z.string(), step: z.string(), accept: z.boolean() }),
] as const;
export const page = [] as const;
export const toContent = [] as const;
export const userScript = [
  /** Step postcondition failed (or multiOutcome step): decide → branch / new branch (executed in this worldId) / stop. */
  usMsg('WIDGET_ASSIST', { report: StepFailureReport }),
  /** Run timeline (step, postcondition, branch, danger-guard events). Fire-and-forget. */
  usMsg('WIDGET_RUN_EVENT', { runId: z.string().max(60), event: RunTimelineEvent }),
] as const;
export const broadcast = [
  msg('RUN_UPDATED', { run: WidgetRun }),
] as const;
