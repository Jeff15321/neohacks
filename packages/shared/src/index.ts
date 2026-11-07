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
  | 'storage';    // may use WidgetAI.storage (chrome.storage.local sandbox)

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
  | { type: 'REPAIR_WIDGET'; widgetId: string }
  | { type: 'REMOVE_WIDGET'; widgetId: string }
  | { type: 'LIST_WIDGETS' }
  | { type: 'GET_PAGE_CONTEXT'; tabId?: number }
  | { type: 'GET_HEALTH' };

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
  | { type: 'ERROR'; message: string; widgetId?: string };

// ---------------------------------------------------------------------------
// Generated-widget -> service worker messaging (chrome.runtime.onUserScriptMessage)
// ---------------------------------------------------------------------------

export type UserScriptMsg =
  | { type: 'WIDGET_INFERENCE'; widgetId: string; requestId: string; prompt: string; context?: unknown; instruction?: string }
  | { type: 'WIDGET_STORAGE'; widgetId: string; requestId: string; op: 'get' | 'set' | 'remove'; key: string; value?: unknown }
  | { type: 'WIDGET_LOG'; widgetId: string; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'WIDGET_STATUS'; widgetId: string; status: 'running' | 'completed' | 'failed'; detail?: string };

export type UserScriptRequestMsg = Extract<UserScriptMsg, { requestId: string }>;

export type UserScriptReply =
  | { ok: true; text?: string; value?: unknown }
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
} as const;
