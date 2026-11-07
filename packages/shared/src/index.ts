/**
 * Shared contracts between the Chrome extension, backend service,
 * and AI-generated widget code. Single source of truth — keep in sync.
 */

// ---------------------------------------------------------------------------
// Widget generation contract (backend <-> extension <-> generated code)
// ---------------------------------------------------------------------------

/** Capabilities a generated widget may request via `grants`. */
export type WidgetGrant =
  | 'inference'   // may call WidgetAI.inference -> backend LLM
  | 'log'         // may emit status/log lines to the extension UI
  | 'storage'     // may use WidgetAI.storage (chrome.storage.local sandbox)
  | 'network';    // may inspect captured ops and invoke same-origin requests via WidgetAI.net

/**
 * The structured object the LLM must return to the backend's
 * /api/generate-widget endpoint. `code` is the widget body: it runs inside an
 * async function with `WidgetAI` in scope (see runtime/prelude).
 */
export interface GeneratedWidget {
  /** Short human name, e.g. "Unread Reply Drafter". */
  name: string;
  /** One sentence: what it does. */
  description: string;
  /** Match patterns the widget is allowed to run on, e.g. "*://mail.google.com/*". */
  matchPatterns: string[];
  /** Capabilities requested. Extension enforces; backend validates against a whitelist. */
  grants: WidgetGrant[];
  /**
   * Widget body. Executed as the body of `(async () => { ... })()` with the
   * following identifiers in scope:
   *   WidgetAI    - platform API surface (inference, log, status, storage)
   *   WIDGET_META - { id, name, version }
   * The code should create its own UI (Shadow DOM recommended) and must NOT
   * click send/purchase/delete affordances.
   */
  code: string;
  /** Optional: CSS-free human summary of where the widget will insert itself. */
  insertionHint?: string;
}

// ---------------------------------------------------------------------------
// Network observation + reproduction
// ---------------------------------------------------------------------------

/** How a request was issued by the page. */
export type NetInitiator = 'fetch' | 'xhr' | 'beacon';

/** Serialized body classification (drives replay fidelity). */
export type NetBodyKind = 'text' | 'json' | 'urlencoded' | 'form' | 'binary' | 'stream' | 'none';

/** A user interaction captured in the page, used to explain why a request fired. */
export interface NetTrigger {
  kind: 'click' | 'submit' | 'keydown';
  /** Compact element summary: `button#id.class[aria-label=..]`. */
  target: string;
  /** Short visible text of the target, e.g. "Save draft". */
  text?: string;
  ts: number;
}

/** Full captured request/response record (stored per-tab in the service worker). */
export interface NetRequestRecord {
  id: string;
  tabId: number;
  /** Frame URL that issued the request (top frame or iframe). */
  frameUrl: string;
  url: string;
  method: string;
  initiator: NetInitiator;
  /** Headers the page explicitly set (browser-managed headers like Cookie are absent). */
  requestHeaders?: Record<string, string>;
  contentType?: string;
  bodyKind?: NetBodyKind;
  requestBody?: string;          // capped (~64k)
  status?: number;               // 0/undefined when request failed before a response
  statusText?: string;
  ok?: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;         // capped (~64k); only textual content types
  error?: string;
  startTs: number;
  durationMs?: number;
  /** The user gesture this request is attributed to (time-window correlation). */
  trigger?: NetTrigger;
  /** True when the record was produced by a WidgetAI.net replay, not organic page activity. */
  replay?: boolean;
}

/** Compact view of a captured operation: fed to the LLM prompt, the panel, and widgets. */
export interface NetOpSummary {
  id: string;
  method: string;
  url: string;
  /** pathname + search, for compact display. */
  path: string;
  status?: number;
  ok?: boolean;
  initiator: NetInitiator;
  contentType?: string;
  bodyKind?: NetBodyKind;
  /** Captured request body, truncated (~2k). Widgets can fetch it via operations() too. */
  requestBodyTemplate?: string;
  responseBodySample?: string;
  /** Human summary of the correlated gesture, e.g. `click "Save draft"`. */
  triggerText?: string;
  replay?: boolean;
  ts: number;
}

/** Overrides applied when reproducing a captured request. */
export interface NetInvokeOverrides {
  url?: string;                            // default: captured URL
  method?: string;                         // default: captured method
  headers?: Record<string, string | null>; // merged; null deletes a header
  /** Full body replacement. Object values are JSON.stringify'd. */
  body?: unknown;
  /** Shallow merge into the captured JSON body (captured fields win unless overridden). */
  mergeBody?: Record<string, unknown>;
}

/** Fetch-shaped request issued via WidgetAI.net.request (no captured template). */
export interface NetDirectRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Result of a replayed/issued page-context request. */
export interface NetInvokeResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  /** Response body, capped (~50k). */
  bodyText?: string;
  durationMs?: number;
  error?: string;
}

export interface WidgetRecord extends GeneratedWidget {
  /** Stable widget id assigned by the extension ("w_<random>"). */
  id: string;
  /** Monotonic version; bumped on regenerate/repair. */
  version: number;
  createdAt: number;
  /** Origin the widget was generated for (display + enforcement). */
  origin: string;
  status: WidgetStatus;
  /** Last reported failure detail (used by the repair flow). */
  lastError?: string;
  /** The natural-language request that produced this widget. */
  originalRequest?: string;
}

export type WidgetStatus =
  | 'generating' | 'generated' | 'validating' | 'ready'
  | 'running' | 'completed' | 'failed' | 'removed';

// ---------------------------------------------------------------------------
// Page context extraction (content script -> extension -> backend)
// ---------------------------------------------------------------------------

export interface Landmark {
  tag: string;
  id?: string;
  classes?: string;
  role?: string;
  ariaLabel?: string;
  /** up to 3 data-* attributes, e.g. {"data-legacy-message-id": "m1"} */
  dataAttrs?: Record<string, string>;
  text?: string;          // truncated visible text
  rect?: { x: number; y: number; w: number; h: number };
}

export interface PageContext {
  url: string;
  origin: string;
  title: string;
  /** High-signal landmark elements: toolbars, navs, mains, buttons, inputs. */
  landmarks: Landmark[];
  /** Candidate containers where a widget could be inserted. */
  insertionCandidates: Landmark[];
  /** Short visible-text sample for grounding (capped server-side). */
  textSample: string;
  /** Interactive elements (buttons/links/inputs) summary. */
  interactive: Landmark[];
  /** Nested skeleton of the main content region (depth-limited, text-truncated). */
  domSkeleton?: string;
  /** Recently observed network operations on this tab (correlated with user actions). */
  networkOps?: NetOpSummary[];
}

// ---------------------------------------------------------------------------
// Backend API
// ---------------------------------------------------------------------------

export interface GenerateWidgetRequest {
  request: string;                 // user's natural-language request
  pageContext: PageContext;
  /** Optional prior widget to repair/iterate on. */
  prior?: { code: string; error?: string; feedback?: string };
}

export interface GenerateWidgetResponse {
  ok: boolean;
  widget?: GeneratedWidget;
  /** Non-fatal caveats from the generator, e.g. "can't persist across sessions". */
  warnings: string[];
  /** If generation refused/failed, why. */
  error?: string;
}

export interface InferenceRequest {
  prompt: string;                  // capped server-side (~10k chars)
  context?: unknown;               // structured data, capped (~50k serialized)
  /** Optional system-style instruction, still untrusted. */
  instruction?: string;
}

export interface InferenceResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ApiError { ok: false; error: string; }

// ---------------------------------------------------------------------------
// Extension internal messaging (side panel <-> service worker)
// ---------------------------------------------------------------------------

export type PanelToSW =
  | { type: 'PANEL_READY' }
  | { type: 'GENERATE_WIDGET'; request: string; tabId?: number }
  | { type: 'RUN_WIDGET'; widgetId: string; tabId?: number }
  | { type: 'REPAIR_WIDGET'; widgetId: string; instruction?: string }
  | { type: 'REMOVE_WIDGET'; widgetId: string }
  | { type: 'LIST_WIDGETS' }
  | { type: 'GET_PAGE_CONTEXT'; tabId?: number }
  | { type: 'GET_HEALTH' }
  | { type: 'GET_NET_OPS'; tabId?: number }
  | { type: 'NET_REPLAY'; opId: string; overrides?: NetInvokeOverrides; tabId?: number };

/** Content-script -> service worker page-side events (net records, gestures). */
export type PageToSW =
  | { type: 'WWA_NET_RECORD'; record: NetRequestRecord }
  | { type: 'WWA_GESTURE'; gesture: NetTrigger }
  | { type: 'WWA_NET_HELLO'; frameUrl: string };

export interface HealthInfo {
  userScripts: boolean;
  backend: 'ok' | 'down' | 'unauthorized';
  backendUrl: string;
  widgets: number;
}

export type SWToPanel =
  | { type: 'GENERATION_PROGRESS'; stage: string; detail?: string }
  | { type: 'WIDGET_GENERATED'; widget: WidgetRecord }
  | { type: 'WIDGET_STATUS'; widgetId: string; status: WidgetStatus; log?: string }
  | { type: 'WIDGET_LIST'; widgets: WidgetRecord[] }
  | { type: 'PAGE_CONTEXT'; context: PageContext }
  | { type: 'NET_OPS'; tabId: number; ops: NetOpSummary[]; probeAlive: boolean }
  | { type: 'ERROR'; message: string; widgetId?: string };

/** Service worker -> content script (relayed to the MAIN-world netprobe). */
export type SWToContent =
  | { type: 'WWA_NET_INVOKE'; invokeId: string; request: { url: string; method: string; headers?: Record<string, string>; body?: string } }
  | { type: 'WWA_NET_PING' };

// ---------------------------------------------------------------------------
// Generated-widget -> service worker messaging (chrome.runtime.onUserScriptMessage)
// ---------------------------------------------------------------------------

export type UserScriptMsg =
  | { type: 'WIDGET_INFERENCE'; widgetId: string; requestId: string; prompt: string; context?: unknown; instruction?: string }
  | { type: 'WIDGET_STORAGE'; widgetId: string; requestId: string; op: 'get' | 'set' | 'remove'; key: string; value?: unknown }
  | { type: 'WIDGET_LOG'; widgetId: string; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'WIDGET_STATUS'; widgetId: string; status: 'running' | 'completed' | 'failed'; detail?: string }
  | { type: 'WIDGET_NET_OPS'; widgetId: string; requestId: string }
  | { type: 'WIDGET_NET_INVOKE'; widgetId: string; requestId: string; opId: string; overrides?: NetInvokeOverrides }
  | { type: 'WIDGET_NET_REQUEST'; widgetId: string; requestId: string; request: NetDirectRequest };

export type UserScriptRequestMsg = Extract<UserScriptMsg, { requestId: string }>;

export type UserScriptReply =
  | { ok: true; text?: string; value?: unknown; operations?: NetOpSummary[]; result?: NetInvokeResult }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Limits (mirror backend enforcement)
// ---------------------------------------------------------------------------

export const LIMITS = {
  PROMPT_MAX_CHARS: 10_000,
  CONTEXT_MAX_CHARS: 50_000,
  INFERENCE_TIMEOUT_MS: 120_000,
  INFERENCE_RPM_PER_WIDGET: 20,
  GENERATION_TIMEOUT_MS: 180_000,
  /** Network capture caps. */
  NET_MAX_RECORDS_PER_TAB: 80,
  NET_MAX_GESTURES_PER_TAB: 30,
  NET_BODY_STORE_CHARS: 64_000,
  NET_BODY_SUMMARY_CHARS: 2_000,
  NET_RESPONSE_SAMPLE_CHARS: 600,
  NET_INVOKE_TIMEOUT_MS: 30_000,
  NET_INVOKE_RESULT_CHARS: 50_000,
  /** Correlation window: a request counts as gesture-triggered if it starts within this many ms after the gesture. */
  NET_TRIGGER_WINDOW_MS: 6_000,
} as const;
