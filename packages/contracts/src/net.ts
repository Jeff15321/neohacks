import { z } from 'zod';

/** How a request was issued by the page. */
export const NetInitiator = z.enum(['fetch', 'xhr', 'beacon']);
export type NetInitiator = z.infer<typeof NetInitiator>;

/** Serialized body classification (drives replay fidelity). */
export const NetBodyKind = z.enum(['text', 'json', 'urlencoded', 'form', 'binary', 'stream', 'none']);
export type NetBodyKind = z.infer<typeof NetBodyKind>;

/** A user interaction captured in the page, used to explain why a request fired. */
export const NetTrigger = z.object({
  kind: z.enum(['click', 'submit', 'keydown']),
  /** Compact element summary: `button#id.class[aria-label=..]`. */
  target: z.string().max(400),
  /** Short visible text of the target, e.g. "Save draft". */
  text: z.string().max(200).optional(),
  ts: z.number(),
  /** Phase B: id of the Step this gesture opened (primary attribution). */
  stepId: z.string().optional(),
});
export type NetTrigger = z.infer<typeof NetTrigger>;

const StrRecord = z.record(z.string(), z.string());

/** Full captured request/response record (stored per-tab in the service worker; raw values never leave the extension). */
export const NetRequestRecord = z.object({
  id: z.string().max(80),
  tabId: z.number(),
  /** Frame URL that issued the request (top frame or iframe). */
  frameUrl: z.string(),
  url: z.string(),
  method: z.string().max(16),
  initiator: NetInitiator,
  /** Headers the page explicitly set (browser-managed headers like Cookie are absent). */
  requestHeaders: StrRecord.optional(),
  contentType: z.string().optional(),
  bodyKind: NetBodyKind.optional(),
  requestBody: z.string().optional(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  ok: z.boolean().optional(),
  responseHeaders: StrRecord.optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
  startTs: z.number(),
  durationMs: z.number().optional(),
  trigger: NetTrigger.optional(),
  /** True when produced by a WidgetAI.net replay, not organic page activity. */
  replay: z.boolean().optional(),
  /** Probe records come from the page's MAIN world, so the page could forge them. */
  provenance: z.literal('page').optional(),
  /** Set by the SW when a matching chrome.webRequest completion was seen (unforgeable). Only confirmed ops are replayable. */
  confirmed: z.boolean().optional(),
  /** Frame id (from the content-script sender). 0 = top frame. */
  frameId: z.number().optional(),
  /** Step open when the request started (stamped by content/netbridge from the Step recorder; primary attribution). */
  stepId: z.string().max(80).optional(),
});
export type NetRequestRecord = z.infer<typeof NetRequestRecord>;

/** Verification tier per op template (doc §4 item 4). Ordered: observed < replayed < verified. */
export const NetTier = z.enum(['observed', 'replayed', 'verified']);
export type NetTier = z.infer<typeof NetTier>;

/** Evidence a widget run passes to `WidgetAI.net.reportVerified` (its read-back success criterion). */
export const NetVerifyEvidence = z.object({
  /** What was read back, e.g. `GET /api/drafts contains "API-authored draft"`. */
  readBack: z.string().max(400),
  /** Optional: what the widget checked, in its own words. */
  detail: z.string().max(400).optional(),
});
export type NetVerifyEvidence = z.infer<typeof NetVerifyEvidence>;

/** A request field whose value came from an earlier response (doc §4 item 3: dependency inference). */
export const NetDependency = z.object({
  /** Request field in this op: `body.csrf`, `header.x-csrf-token`, `query.page_token`. */
  field: z.string(),
  /** Earlier op whose response carried the value. */
  opId: z.string(),
  /** That op's template key, e.g. `GET /api/csrf`. */
  fromTemplate: z.string(),
  /** Path inside that op's response: `token`, `data.csrf`, `items[0].id`, `header:x-csrf-token`. */
  path: z.string(),
});
export type NetDependency = z.infer<typeof NetDependency>;

/** Deterministic op analysis (packages/core/op-analysis). Contains field NAMES/paths only — never raw values. */
export const NetOpAnalysis = z.object({
  /** Route template: `/repos/:owner/:repo/issues/:n`. */
  template: z.string(),
  /** `${METHOD} ${template}` — tiers and grouping are keyed by this. */
  templateKey: z.string(),
  /** Number of captures of this template on the tab. */
  captures: z.number(),
  mutating: z.boolean(),
  /** Dynamic/token fields: secret-named, high-entropy, or opaque values that differ across captures. Keep / re-fetch, never invent. */
  tokenFields: z.array(z.string()),
  /** Human-valued fields that differed across captures (likely user parameters). */
  paramFields: z.array(z.string()),
  dependsOn: z.array(NetDependency),
  /** Client-generated id fields on a mutating op (duplicate/idempotency hint). */
  clientIdFields: z.array(z.string()),
  idempotencyHint: z.string().optional(),
});
export type NetOpAnalysis = z.infer<typeof NetOpAnalysis>;

/** Compact, REDACTED view of a captured operation: fed to the LLM prompt, the panel, and widgets. */
export const NetOpSummary = z.object({
  id: z.string(),
  method: z.string(),
  url: z.string(),
  /** pathname + search, for compact display. */
  path: z.string(),
  status: z.number().optional(),
  ok: z.boolean().optional(),
  initiator: NetInitiator,
  contentType: z.string().optional(),
  bodyKind: NetBodyKind.optional(),
  requestBodyTemplate: z.string().optional(),
  responseBodySample: z.string().optional(),
  /** Human summary of the correlated gesture, e.g. `click "Save draft"`. */
  triggerText: z.string().optional(),
  replay: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  ts: z.number(),
  /** Step this request is attributed to (record stepId, else the correlated gesture's stepId). */
  stepId: z.string().optional(),
  /** How the trigger was attributed: the Step recorder (primary) or the 6 s gesture time window (fallback). */
  attribution: z.enum(['step', 'window']).optional(),
  /** Template-level verification tier (doc §4 item 4). */
  tier: NetTier.optional(),
  tierEvidence: z.string().optional(),
  analysis: NetOpAnalysis.optional(),
  /** Seen by chrome.webRequest only (e.g. worker requests): no bodies, not replayable. */
  browserOnly: z.boolean().optional(),
});
export type NetOpSummary = z.infer<typeof NetOpSummary>;

/** Overrides applied when reproducing a captured request. */
export const NetInvokeOverrides = z.object({
  url: z.string().optional(),
  method: z.string().optional(),
  /** Merged; null deletes a header. */
  headers: z.record(z.string(), z.string().nullable()).optional(),
  /** Full body replacement. Object values are JSON.stringify'd. */
  body: z.unknown().optional(),
  /** Shallow merge into the captured JSON body. */
  mergeBody: z.record(z.string(), z.unknown()).optional(),
});
export type NetInvokeOverrides = z.infer<typeof NetInvokeOverrides>;

/** Fetch-shaped request issued via WidgetAI.net.request (no captured template). */
export const NetDirectRequest = z.object({
  url: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});
export type NetDirectRequest = z.infer<typeof NetDirectRequest>;

/** Result of a replayed/issued page-context request. */
export const NetInvokeResult = z.object({
  ok: z.boolean(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  headers: StrRecord.optional(),
  bodyText: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});
export type NetInvokeResult = z.infer<typeof NetInvokeResult>;

/** Fetch-shaped spec relayed SW → content → MAIN-world probe. */
export const InvokeRequestSpec = z.object({
  url: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});
export type InvokeRequestSpec = z.infer<typeof InvokeRequestSpec>;

/** Minimal chrome.webRequest completion kept for the integrity cross-check. */
export interface WebRequestSeen { url: string; method: string; ts: number; statusCode?: number; type?: string; }
