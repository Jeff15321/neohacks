import { z } from 'zod';
import { WorkflowSpec } from './workflow.js';
import { DATA_LIMITS, DataCollectionName } from './data.js';

/** Capabilities a generated widget may request via `grants`. Later phases extend this enum (data, flow). */
export const WidgetGrant = z.enum([
  'inference', // may call WidgetAI.inference -> backend LLM
  'log',       // may emit status/log lines to the extension UI
  'storage',   // may use WidgetAI.storage (chrome.storage.local sandbox, per widget)
  'network',   // may inspect captured ops and invoke same-origin requests via WidgetAI.net
  'data',      // may read/write the user's WidgetAI.db collections it declares in `collections` (Phase A)
]);
export type WidgetGrant = z.infer<typeof WidgetGrant>;

/**
 * The structured object the generator LLM returns (validated by the backend).
 * `code` is the widget body: it runs inside an async function with `WidgetAI` in scope.
 */
export const GeneratedWidget = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  /** Match patterns the widget is allowed to run on, e.g. "*://mail.google.com/*". */
  matchPatterns: z.array(z.string()).min(1),
  grants: z.array(WidgetGrant),
  code: z.string().min(20),
  insertionHint: z.string().max(200).optional(),
  /** Plain-language plan shown on the approval card ("What it will do"). */
  plan: z.array(z.string().max(300)).max(12).optional(),
  /** Short "what changed" summary for edit/repair turns. */
  changeSummary: z.string().max(400).optional(),
  /** Anything the widget may do that sends/publishes/deletes (flagged on the approval card). */
  consequentialActions: z.array(z.string().max(200)).max(10).optional(),
  /** WidgetAI.db collections the widget reads/writes (grant "data"); shown on the approval card (Phase A). */
  collections: z.array(DataCollectionName).max(DATA_LIMITS.MAX_DECLARED_COLLECTIONS).optional(),
});
export type GeneratedWidget = z.infer<typeof GeneratedWidget>;

export const WidgetStatus = z.enum([
  'generating', 'generated', 'validating', 'ready',
  'running', 'completed', 'failed', 'removed',
]);
export type WidgetStatus = z.infer<typeof WidgetStatus>;

export const WidgetRecord = GeneratedWidget.extend({
  /** Stable widget id assigned by the extension ("w_<random>"). */
  id: z.string(),
  /** Monotonic version; bumped on regenerate/repair/edit. */
  version: z.number(),
  createdAt: z.number(),
  /** Origin the widget was generated for (display + enforcement). */
  origin: z.string(),
  status: WidgetStatus,
  /** Only approved widgets are ever registered or executed. */
  approved: z.boolean(),
  lastError: z.string().optional(),
  originalRequest: z.string().optional(),
  /** traceId of the generation that produced this version. */
  traceId: z.string().optional(),
  /** Phase B: the recorded WorkflowSpec this widget was generated from (reused for edits and repair). */
  spec: WorkflowSpec.optional(),
  /** Conversation turns for this widget (user + generator), newest last. */
  thread: z.array(z.object({
    role: z.enum(['user', 'generator']),
    text: z.string(),
    version: z.number().optional(),
    ts: z.number(),
  })).optional(),
});
export type WidgetRecord = z.infer<typeof WidgetRecord>;
