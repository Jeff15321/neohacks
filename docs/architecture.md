# Architecture — AI Website Widget Builder

> Status: implemented and verified end-to-end. Empirical evidence for the
> load-bearing claims lives in `docs/feasibility.md` and `poc/run.mjs`.

## System overview

```
┌─────────────────────────── Chrome (MV3) ───────────────────────────┐
│  Side panel (React)  ──runtime.sendMessage──►  Service worker      │
│       ▲ broadcast                                │                 │
│       │                                          │ fetch           │
│  Page │                                          ▼                 │
│  ┌────┴──────────────────────────┐      POST /api/* + token        │
│  │ Generated widget JS           │                                 │
│  │ (USER_SCRIPT world, worldId   │                                 │
│  │  per widget)                  │      ┌───────────────────────┐  │
│  │   └► WidgetAI.inference() ────┼─────►│ Backend (Fastify)     │  │
│  │      chrome.runtime.sendMsg   │      │  /api/generate-widget │  │
│  │             ▲                 │      │  /api/inference       │  │
│  │             └─ onUserScriptMessage     │  Anthropic/OpenAI/Mock│  │
│  │               in SW, origin-checked    └───────────────────────┘  │
│  │ Content script (context.ts): DOM landmarks + skeleton extraction  │
│  └─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Chrome extension (`apps/extension`)

Manifest V3, TypeScript, esbuild (no framework bundler — three iife bundles:
service worker, content script, side-panel React app). Permissions:
`userScripts`, `tabs`, `sidePanel`, `storage`; host: `<all_urls>`.

- **Service worker (`src/background/sw.ts`)** — the orchestrator. Handles:
  - `GENERATE_WIDGET`: resolves the target tab, asks the content script for a
    `PageContext`, POSTs to `/api/generate-widget`, stores the returned widget
    (`chrome.storage.local`), broadcasts it to the panel for review.
  - `RUN_WIDGET`: configures a per-widget user-script world
    (`configureWorld({worldId, messaging:true})`) and executes
    `prelude + generated code` via `chrome.userScripts.execute()` (Chrome 135+,
    immediate injection, result awaitable).
  - `REMOVE_WIDGET`: unregisters, deletes storage, executes a cleanup snippet
    removing `[id^="wwa-"]` roots.
  - `chrome.runtime.onUserScriptMessage`: the *only* channel generated code can
    use to reach the extension. Handles `WIDGET_INFERENCE` (forwards to
    `/api/inference` after grant + origin checks), `WIDGET_LOG`,
    `WIDGET_STATUS`, `WIDGET_STORAGE`.
  - `matchPattern.ts`: match-pattern → RegExp used to scope widgets to origins
    (note: Chrome patterns ignore ports — the regex allows `(:port)?`).
- **Content script (`src/content/context.ts`)** — injected on all http(s) pages
  at `document_idle`. On `WWA_GET_CONTEXT` returns a `PageContext`:
  landmarks (roles/aria-labels/ids/classes), insertion candidates,
  interactive elements, a `domSkeleton` (indented `tag#id.class` tree of the
  main region), and a visible-text sample. This is the model's "eyes".
- **Side panel (`src/sidepanel/main.tsx`)** — React chat UI. Shows generated
  widgets with name/description/grants/matchPatterns, a **code review +
  "Approve & Run" gate** (required by the security model), per-widget status
  pills and a live log stream fed by `WidgetAI.log/status`.
- **Runtime prelude (`src/runtime/widgetSource.ts`)** — wraps generated code
  in an async IIFE and defines `WidgetAI`:
  `inference()` / `log()` / `status()` / `storage` — all implemented on top of
  `chrome.runtime.sendMessage`. Grant strings from widget metadata gate each
  API. Unhandled rejections auto-report `failed`.

### 2. Backend (`apps/backend`)

Fastify + TypeScript (tsx in dev). No database.

- `POST /api/generate-widget` — builds the generation prompt
  (`generation/prompt.ts`: strict-JSON output contract + WidgetAI API docs +
  DOM/safety rules), calls the generation model, validates via
  `generation/parse.ts` (JSON extraction, field/schema checks, banned-construct
  denylist — `eval`, `new Function`, `document.cookie`, XHR, remote `fetch`;
  non-standard selector pseudos; acorn syntax check). **Retries once** with the
  validation error fed back to the model.
- `POST /api/inference` — the shared AI surface for widgets (the
  `TW_inference` analog). Enforces prompt/context size caps (10k/50k chars,
  mirroring Tweeks' documented limits), a per-widget token-bucket
  (~20 rpm), and wraps the untrusted page data with a defensive system prompt.
- `GET /health`, and static serving of the two fixture apps
  (`/fixture/`, `/fixture-yt/`) for tests/demos.
- **LLM provider abstraction** (`llm/`): `anthropic` (SDK), `openai` (fetch),
  `mock` (deterministic, used by E2E). Selected by `LLM_PROVIDER`.
- Auth: a shared `EXTENSION_AUTH_TOKEN` header gates `/api/*` — not real
  security, just prevents casual quota burn from random pages.

### 3. Generated-widget runtime

The central design decision: **all website-specific behavior lives in
generated code**. The platform provides only generic infrastructure
(inference, logging, storage, execution). There is no `gmail.replyToUnread`
style registry; a Gmail widget must do its own DOM traversal, unread
detection, navigation, extraction, and composer filling. Verified generality:
the same pipeline runs a YouTube comment-analyzer widget (`tests/e2e/
youtube.spec.ts`).

## Data flow (Gmail demo)

1. User opens Gmail, opens side panel, types a request.
2. SW → content script → `PageContext` (landmarks, skeleton, interactive).
3. SW → backend `/api/generate-widget` → LLM → `GeneratedWidget` JSON.
4. Backend validates; on failure retries once with the error as feedback.
5. Panel renders the widget card + code for review. User clicks Approve & Run.
6. SW `configureWorld({worldId, messaging:true})` →
   `userScripts.execute({js:[{code: prelude+body}], world:'USER_SCRIPT',
   worldId, injectImmediately:true})` on the Gmail tab.
7. Widget builds its UI in a Shadow-DOM host (id `wwa-*`), prefers a native
   container, starts its workflow on click:
   find unread rows → open thread → wait → extract body →
   `WidgetAI.inference()` → open Reply → fill contenteditable + InputEvent →
   verify autosave via DOM signal → back → repeat → `status('completed')`.
8. Each `WidgetAI.inference` call travels userScript → `onUserScriptMessage`
   (SW, origin+grant checked) → `/api/inference` → LLM → back.
9. Status/log lines stream to the panel; final status `completed`/`failed`.

## Key design decisions & tradeoffs

| Decision | Why | Tradeoff |
|---|---|---|
| `chrome.userScripts` for execution | Only MV3 API that runs **arbitrary code strings**; USER_SCRIPT world exempt from page CSP (Gmail requires this) | Requires the per-extension "Allow User Scripts" toggle (Chrome ≥138); Chrome Web Store RHC policy would scrutinize this anyway |
| `execute()` + `register()` | Immediate run on an already-loaded page; approved widgets are also `register()`ed so their UI re-injects on subsequent matching page loads | `execute` needs Chrome 135+; re-running injects a second copy (idempotency is the widget's job) |
| USER_SCRIPT world, `worldId` per widget | DOM access + isolation between widgets and from page JS | Cannot read page JS globals — widget must verify via DOM (we hit this exact bug in dev) |
| Shadow DOM for widget UI | Style isolation, no global CSS, host site unaffected | Slightly more verbose generated code |
| Structured `GeneratedWidget` JSON | Grants, matchPatterns, insertionHint are machine-checkable | Model must obey a contract — enforced by validator + retry |
| No DB / no per-widget backend | MVP scope: one generic inference endpoint suffices | No cross-device sync, no widget sharing |
| Mock LLM provider | Deterministic CI; the whole E2E runs in ~6s | Doesn't prove codegen — covered by manual/live runs |

## What was deferred (P2)

- `POST /api/repair-widget` execution-error repair loop (generate.ts already
  supports a `prior` field; the extension doesn't yet auto-feed runtime errors back)
- Streaming codegen progress, multi-widget management UI polish
- `chrome.debugger` fallback path for pre-135 Chrome
