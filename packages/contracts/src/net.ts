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
});
export type NetRequestRecord = z.infer<typeof NetRequestRecord>;

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
export interface WebRequestSeen { url: string; method: string; ts: number; statusCode?: number; }
