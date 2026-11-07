import { z } from 'zod';
import { msg } from './_msg.js';
import { Suggestion, WorkingMemory } from '../activity.js';
import { SemanticStep } from '../steps.js';

/**
 * Owner: Phase D (extension modules/observe: ObserveClient + suggestions). Step ingest messages are Phase B's
 * (messages/record.ts).
 */
const SuggestionAction = z.enum(['accept', 'not_now', 'never', 'retry', 'restore']);

const ObserveDiag = z.object({
  queued: z.number(), inFlight: z.boolean(), sent: z.number(), calls: z.number(), lastMs: z.number().optional(),
  lastError: z.string().optional(), lastJudge: z.string().optional(),
});

export const panel = [
  /** Activity tab: WorkingMemory + suggestions + client diagnostics. */
  msg('ACTIVITY_GET', {}),
  /** Clear observation: backend WorkingMemory + local queue + suggestions history. */
  msg('ACTIVITY_CLEAR', {}),
  msg('SUGGESTION_ACTION', { suggestionId: z.string(), action: SuggestionAction }),
] as const;

/** content script → SW */
export const page = [
  /** Suggestion card button. */
  msg('WWA_SUGGESTION_ACTION', { suggestionId: z.string(), action: SuggestionAction }),
  /** Content script asks on load whether a suggestion card should be shown for this page. */
  msg('WWA_SUGGESTION_QUERY', {}),
] as const;

/** SW → content script */
export const toContent = [
  /** Show/update (suggestion) or hide (null) the in-page suggestion card. */
  msg('WWA_SUGGESTION', { suggestion: Suggestion.nullable() }),
] as const;

export const userScript = [] as const;

export const broadcast = [
  msg('ACTIVITY_STATE', { state: WorkingMemory.nullable(), semantic: z.array(SemanticStep).optional(), suggestions: z.array(Suggestion), diag: ObserveDiag }),
  msg('SUGGESTION_UPDATED', { suggestion: Suggestion }),
  /** Accept → the approval card for `widgetId` is ready in the Create tab. */
  msg('SUGGESTION_ACCEPTED', { suggestionId: z.string(), widgetId: z.string() }),
] as const;
