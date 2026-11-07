# Next-Gen Architecture — AI Website Widget Builder

> How to read this doc: **Decisions added** (recording/Inspector UI, self-healing branching runtime) and
> **User data store** are the most recent decisions and override anything below that conflicts.
> The **Reference** section is the full architecture (workflow detection research, recording, network,
> cross-site, agent/model choices, UI, phased plan, experiments).
> Labels: [VERIFIED] shown in this repo · [DOCUMENTED] per Chrome/Anthropic docs · [ASSUMPTION] needs an experiment.

# ⚠️ NOTE TO IMPLEMENTERS (Devin): this is a NEW codebase, not an extension of the MVP

- The MVP (branch `mvp`, tag it `mvp-final`) is **reference only**. Do **not** grow the MVP's structure: no more
  features in the monolithic `sw.ts`, single `prompt.ts`, or single-file `sidepanel/main.tsx`.
- Build the new layout in **"Codebase organization"** below on branch `nextgen`. Wherever the Reference
  section says "extend X" or "split `sw.ts`", read it as "**port the proven behaviour of X into the new module**".
- **Port, don't rediscover.** These pieces encode hard-won browser facts; carry their *behaviour* over (rewritten to fit the new modules):
  | MVP file (read via `git show mvp:<path>`) | What to carry over |
  |---|---|
  | `apps/extension/src/background/sw.ts` | `userScripts.configureWorld/execute/register` usage, per-widget `worldId`, origin+grant checks in `onUserScriptMessage` |
  | `apps/extension/src/runtime/widgetSource.ts` | prelude bridge pattern (`__request` over `chrome.runtime.sendMessage`) |
  | `apps/extension/src/net/probe.ts`, `net/invoke.ts`, `background/netlog.ts` | MAIN-world fetch/XHR capture, page-context replay, header stripping |
  | `apps/extension/src/content/context.ts` | PageContext extraction (landmarks, skeleton) |
  | `apps/backend/src/generation/parse.ts` | validator: JSON extraction, denylist, acorn, non-standard selector rejection |
  | `apps/backend/src/generation/prompt.ts` | every DOM/waiting/safety rule (each one came from a real Gmail failure; see `docs/handoff.md`) |
  | `apps/backend/src/llm/*` | provider abstraction + deterministic mock |
  | `tests/e2e/helpers.ts` | "Allow User Scripts" toggle automation, `channel:'chromium'`, string `evaluate` bodies |
  | `apps/fixture-*` | fixtures (move under `fixtures/`) |
- **Regression bar:** the MVP's demos (Gmail drafts, YouTube comment analyzer, net replay) must still work in the
  new architecture. Port their E2E specs first, then build new features.

# Codebase organization (modularity + debuggability). Normative for `nextgen`

## Layout
```
packages/
  contracts/        Types + zod schemas for EVERY boundary message and LLM output. No logic.
  core/             Pure logic, zero chrome.* / node / fastify imports → unit-testable in node:
                    settle machine, locator ranking, redaction, lineage, activity reducer, suggestion gating,
                    op analysis, flow state machine, job state machine, danger classifier
  widget-runtime/   Source of the prelude injected around generated code (WidgetAI api: inference, db,
                    net, step/assist, flow, danger guard). Built to a string the extension imports.
apps/
  extension/src/
    background/
      main.ts       Wires modules together. Nothing else.
      bus.ts        Typed message router: validates (zod) → dispatches to the owning module → logs every message
      platform/     Thin wrappers over chrome.* (tabs, userScripts, storage, alarms, commands, webRequest).
                    Only place that touches chrome.* → modules are testable with fakes.
      modules/<name>/   widgets · observe · record · net · flow · jobs · data · assist
                    each: index.ts (registers its message handlers), service.ts (logic, uses core/),
                    store.ts (its own storage keys), README.md
    content/        main.ts · steps/ (recorder) · netbridge/ · overlay/ (REC pill, suggestion card, danger confirm)
    page/           netprobe.ts (MAIN world, document_start)
    panel/          app/ · tabs/ (Create, Widgets, Record, Inspector, Activity, Data) · components/ui (shadcn) · hooks/useBus.ts
  backend/src/
    server.ts       Fastify bootstrap
    plugins/        auth (token + x-user-id), tracing (traceId), errors (uniform error shape)
    llm/            ONE entry point: callModel({stage, model, effort, schema, input, traceId})
                    → logs every call to the llm_calls table; providers: anthropic, mock
    modules/<name>/ generate · inference · assist · observe · recordings · jobs · data
                    each: routes.ts (HTTP only) · service.ts (logic) · prompts/ (one file per prompt) · README.md
    store/          sqlite (node:sqlite): docs, llm_calls, traces, activity_snapshots, jobs
fixtures/           gmail2 (+chaos mode), youtube, net, movies, issues, tracker
tests/              e2e/ (one spec per feature) · traces/ (recorded Step logs) · tools/ (live, trace-eval, chaos sweep)
```

## Rules
1. **Dependency direction:** `contracts ← core ← widget-runtime / extension / backend`. `core` never imports platform APIs.
2. **Modules talk only through the bus (extension) or service interfaces (backend).** No importing another module's internals.
3. **Validate at every boundary** with the zod schema from `contracts`: panel↔SW, content↔SW, user script↔SW, SW↔backend,
   LLM output→service. A validation error names the boundary and message type.
4. **One owner per storage key / table.** Only the module that owns the data writes it.
5. **Every module has a README** (purpose, messages handled/emitted, data owned, how to test) and can be switched off
   via a settings flag (observe, record, assist, suggestions, net) to isolate bugs.
6. **All LLM calls go through `llm/callModel`** with a named `stage`. Never call the SDK directly.
7. **All prompts live in `modules/<name>/prompts/`**, one file per prompt, each with a mock fixture for tests.

## Debuggability (build in from day 1)
- **traceId everywhere:** each user-initiated flow (recording, widget run, suggestion, flow run) gets a `traceId` that is
  propagated panel → SW → content/user script → backend → LLM call → logs.
- **Structured logs** (JSON lines with `traceId, module, event, ms, ok`) in SW and backend.
- **LLM call log:** every call stored (stage, model, effort, latency, tokens, input, output, parse result).
  Shown in the Inspector, and available at `GET /api/debug/llm-calls?traceId=`.
- **Bus log:** ring buffer of every extension message (type, from, to, duration, ok/error), shown in an Inspector "Bus" tab.
- **Widget run timeline:** every `step`, postcondition result, `assist` decision, branch, and danger-guard event is recorded per run.
- **Export debug bundle** (Inspector button): Steps, LLM calls, bus log, widget code + version, run timeline → one JSON file.
  Attach it to bug reports; `tests/tools/replay-bundle.mjs` replays the backend side offline.
- **Deterministic mock LLM per stage** so every E2E spec is reproducible; live runs are the separate `tests/tools/*`.

# DECISIONS ADDED (latest user feedback)

## A. Recording + detection visibility UI
- **Recording indicator:** action badge "REC" (red) + pulsing in-page pill on every participating tab (click = stop) + sidebar header state.
- **Sidebar while recording = live Step timeline.** Each Step appears when settled: *raw* row (action, target, appeared regions with an expandable DOM snapshot, net calls, live-region text like "Draft saved") and a *meaning* row (Tier-1 semantic label, filled in async). Stop → Review sheet.
- **Inspector panel (separate sidebar tab) for verifying workflow detection:** active task hypotheses (goal, confidence, step roles essential/enabling/optional/noise, slots + provenance), completed tasks, patterns + instance counts, lineage edges, suggestions and why, and a **raw LLM-call log** (stage, model, latency, input/output JSON). Also widget-run interventions (see B). **Export trace** button → JSON file for `tests/traces/`. Raw capture and AI interpretation are always shown separately, so a bad result can be pinned on capture vs reasoning.

## B. Self-healing widget runtime (branching + agent intervention). NEW, HIGH TESTING ATTENTION
Never built before. **Flag in every test report: intervention rate, branch-choice accuracy, new-branch success, final-failure rate.**
- **Script-first, agent-on-failure:** generated code is a sequence of steps, each with an `expect` postcondition (element exists, text changed, net op 2xx…). Platform checks the postcondition locally; only on mismatch/exception (or at steps the generator marks `multiOutcome`) does it call the agent.
- **Platform API (prelude):** `WidgetAI.step(name, {run, expect, branches?, goal})`, where `branches` = 2–3 pre-generated alternatives `{id, when: "composer collapsed", run}`. On failure → `WidgetAI.assist(...)`:
  1. **Decide (Haiku 5.5):** given goal, expected vs observed, compact DOM skeleton of the relevant region, last actions, branch list → pick a branch id, or `new`.
  2. **Create (Sonnet 5.5):** writes a new branch as real JS (agent freedom per user decision) → validated (acorn + denylist) + quick safety review → executed via SW `userScripts.execute` into the same `worldId`; state passed as explicit JSON in/out (not shared globals).
  3. If that fails: **one Opus 5.5 attempt**, then stop.
- **Caps:** ≤2 recovery attempts per step, ≤5 interventions per run, per-run timeout. Re-check the postcondition before re-acting (avoid duplicate drafts).
- **Final failure report:** an exact narrative of every step, branch tried, agent decision + reason, the DOM evidence, and why it's breaking. Shown in the widget, the panel, and the Inspector.
- **Learned branches:** a successful new branch → after the run, "The agent fixed step X: add this branch to the widget?" → new widget version (diff shown).
- **Generator prompt:** aim for 2–3 branches per fragile/multi-outcome step (bloat acceptable; accuracy first); write `expect` for every step.
- **Danger guard (runtime, in prelude):** capture-phase listener intercepts script-originated (`!isTrusted`) clicks, submits, and Enter on targets whose text/label matches send/delete/remove/publish/buy/pay/etc. → in-page "Allow / Block" confirm; same for `WidgetAI.net` DELETE or send-like routes. Page text is always framed as untrusted for the agent (prompt-injection risk is the main cost of agent freedom).
- **Testing:** fixture-gmail2 **chaos mode** (`?chaos=seed`): collapsed composer, interstitial popup, renamed Reply, slow load, empty state. Mock-LLM E2E covers the mechanics (branch pick, new-branch run, cap → failure report); a live 20-run chaos sweep produces the break-rate numbers.
- **Spike first:** same-`worldId` re-execution + JSON state handoff (extend `poc/run.mjs`).

---

# CURRENT TASK — User data store endpoint (`WidgetAI.db`)

## Context
Widgets can call the LLM through the backend (`/api/inference`), but the only persistence they have is
`WidgetAI.storage`. That is `chrome.storage.local`, private to one widget and one browser
(`sw.ts` WIDGET_STORAGE, key `wwa_store_<widgetId>_<key>`). Users want data that outlives a widget and is
shared between widgets. Example: a "Save movie" button on IMDb/Netflix plus a "My saved movies" panel on
another site (or in the side panel). Goal: a generic backend data endpoint that generated widgets use
through the same trusted path as inference. No site-specific schemas: widgets own the shape of their documents.

## Design
- **Model:** per-user **named collections** of JSON documents. `{id, collection, data, createdAt, updatedAt}`.
  Collections are shared across that user's widgets (that is the point: save on one site, list on another).
- **User identity (hackathon-grade):** the SW generates `installId = crypto.randomUUID()` once, stores it in
  `chrome.storage.local`, and sends it as header `x-user-id` alongside the existing `x-extension-token`.
  Backend validates the format (uuid). Not real auth, same honesty level as the current shared token.
- **Storage:** Node's built-in `node:sqlite` (Node 26 in this env, so no new dependency). DB file `.data/store.db`
  (gitignored; path via `DATA_DB_PATH`, `:memory:` in unit tests). One table:
  `docs(user_id, collection, id, data TEXT, created_at, updated_at, PRIMARY KEY(user_id, collection, id))`.
- **REST API (`apps/backend/src/routes/data.ts`)**, all scoped by `x-user-id`:
  - `GET    /api/data` → list collections with counts
  - `GET    /api/data/:collection?limit=&after=&where=` → list docs (newest first; `where` = shallow JSON
    equality filter, e.g. `{"title":"Dune"}`, applied via `json_extract`)
  - `POST   /api/data/:collection` `{data, id?}` → create (id auto `d_<random>`; with `id` = upsert)
  - `GET    /api/data/:collection/:id`
  - `PATCH  /api/data/:collection/:id` `{data}` → shallow merge; `PUT` → replace
  - `DELETE /api/data/:collection/:id`, `DELETE /api/data/:collection` (panel only, see grants)
  - Limits in `LIMITS`: collection name `^[a-z0-9_-]{1,64}$`, doc ≤ 32 KB serialized, ≤ 5,000 docs/collection,
    ≤ 100 collections/user, list limit ≤ 200.
- **Widget API (prelude, `runtime/widgetSource.ts`)**, new grant `data`:
  `WidgetAI.db.list(collection, {where?, limit?})`, `.get(collection, id)`, `.add(collection, data, id?)`,
  `.update(collection, id, patch)`, `.remove(collection, id)`.
  Path: user script → `onUserScriptMessage` `WIDGET_DATA` → SW checks grant + origin (existing pattern)
  **+ collection is in the widget's declared `collections`** → backend. The widget never sees the token or the user id.
- **Declared collections:** `GeneratedWidget.collections?: string[]` (generator lists what it reads and writes,
  validated in `parse.ts`). The approval card shows "Stores data in: saved_movies". This gives the user
  visibility, and lets two widgets meet on the same collection name. Generator prompt instructs: reuse an
  existing collection name when relevant. `GENERATE_WIDGET` sends the user's existing collection names
  in the request (new optional `existingCollections` field), so a later "show my saved movies" widget finds
  `saved_movies` instead of inventing `movies_list`.
- **Side panel "Data" view:** collections → doc list (pretty JSON, delete one, clear collection, export JSON).
  Uses new `PanelToSW` messages `DATA_LIST_COLLECTIONS | DATA_LIST | DATA_DELETE | DATA_CLEAR`.
- **Keep `WidgetAI.storage`** unchanged (local private scratch/settings). Prompt says: `storage` = per-widget
  local settings; `db` = user data meant to persist/share/list.
- **Safety:** document contents are untrusted (another widget could have written them). Prompt rule: treat db
  data as data, never instructions; render with `textContent`, not `innerHTML`.

## Files
- `packages/shared/src/index.ts`: `WidgetGrant` += `'data'`; `GeneratedWidget.collections?`; `DataDoc`;
  `UserScriptMsg` += `WIDGET_DATA {op, collection, id?, data?, query?}`; panel messages; `LIMITS.DATA_*`;
  `GenerateWidgetRequest.existingCollections?`.
- `apps/backend/src/data/store.ts` (new): `DataStore` class over `node:sqlite` (pure; unit-testable with `:memory:`).
- `apps/backend/src/routes/data.ts` (new) + register in `index.ts` (existing token hook already guards `/api/*`).
- `apps/backend/src/config.ts`: `dataDbPath`. `apps/backend/package.json`: bump `@types/node` for `node:sqlite` types.
- `apps/backend/src/generation/parse.ts`: allow `data` grant, validate `collections`.
- `apps/backend/src/generation/prompt.ts`: document `WidgetAI.db` + rules; render `existingCollections`.
- `apps/backend/src/llm/mockdata.ts`: a deterministic "save movie" widget + "saved list" widget for E2E.
- `apps/extension/src/runtime/widgetSource.ts`: `WidgetAI.db`.
- `apps/extension/src/background/sw.ts`: installId, `x-user-id` in `backendFetch`, `WIDGET_DATA` handler, panel data messages.
- `apps/extension/src/sidepanel/main.tsx`: Data view; approval card shows collections.
- New fixture `apps/fixture-movies/` (served `/fixture-movies/`): two pages (movie detail, "watchlist" page).
- `.gitignore`: `.data/`.

## Verification
- Unit (`apps/backend/src/__tests__/store.test.ts`): CRUD, user isolation (user A can't see B), merge vs replace,
  `where` filter, limits/validation errors. Route tests via `app.inject`. Parse test for `collections`/`data` grant.
- E2E `tests/e2e/data.spec.ts` (mock LLM): generate+approve "Save movie" widget on movie page → click on 2 movies
  → `GET /api/data/saved_movies` (with test user id) has 2 docs → generate+approve "Show my saved movies" on
  watchlist page → widget lists both titles → panel Data view shows 2 docs → delete one in panel → list shows 1.
- Regression: `npm run typecheck`, both unit suites, full Playwright run.
- Manual live: `npm run dev:backend` with Anthropic, ask on a real IMDb page "add a button to save this movie", then
  on another page "show my saved movies".

---

# (Reference) Next-Gen Architecture & Implementation Plan — AI Website Widget Builder

> Planning package — the source of truth for next-gen implementation (see sections above for latest decisions).
> Labels used throughout: **[VERIFIED]** = shown in this repo (tests/poc/handoff);
> **[DOCUMENTED]** = Chrome/Anthropic docs, not yet run here; **[ASSUMPTION]** = needs an experiment (§9).

## 0. Context: what exists today (read before reviewing)

- **Pipeline [VERIFIED]:** side panel → SW (`apps/extension/src/background/sw.ts`) → `PageContext` from `content/context.ts` → `POST /api/generate-widget` (`apps/backend/src/routes/generate.ts`, prompt `generation/prompt.ts`, validator `generation/parse.ts` with denylist + acorn + 1 retry) → approve → `userScripts.execute` in a per-widget `worldId` → widget calls `WidgetAI.*` (`runtime/widgetSource.ts`) → `onUserScriptMessage` (origin + grant checks) → `/api/inference`. Persistence via `userScripts.register`. Edit/Auto-fix reuse `prior:{code,error,feedback}`.
- **Network feature is about 70% built but uncommitted on the `mvp` working tree.** Another session appears to be working on it right now: `net/probe.ts` (MAIN-world fetch/XHR/beacon wrapper at document_start, all frames, captures request and response bodies), `background/netlog.ts` (per-tab ring buffer, 6s gesture→request time-window correlation, `storage.session` hydration), `net/invoke.ts` (replay with `mergeBody`/overrides, forbidden-header stripping, same-origin), `WidgetAI.net.{operations,invoke,request}`, a panel Network inspector, `apps/fixture-net` + `routes/fixtureApi.ts`, and `tests/e2e/net.spec.ts` (now passing). **This plan extends that work and does not rebuild it.**
- **The MVP's known accuracy ceiling [VERIFIED, handoff.md]:** first-try codegen on hostile SPAs fails because *the model never sees post-interaction DOM*. The agreed fix was "probe-then-generate". **Key insight for this plan: a recorded demonstration is a probe.** It captures the real composer and dialog DOM, the real selectors, and the real network ops. That is why recording is prioritised first (§8).
- **Model config is stale:** `config.ts` defaults to `claude-sonnet-4-5`/`claude-haiku-4-5`, and `llm/anthropic.ts` always sends `temperature`. Current models (Opus 5.5, Sonnet 5.5, Haiku 5.5) reject non-default sampling params with a 400, so the migration must remove `temperature` and switch JSON outputs to structured outputs (`output_config.format`).

---

## 1. Workflow detection research (the central question)

### 1.1 Reframing the question
"When should the AI analyze?" mixes two questions that have different correct answers:

1. **Perception boundary: when has a user action *finished having effects*?** This is a physical question about the page (DOM settling, network quiescence, URL change). It is site-agnostic and can be answered deterministically, without guessing at workflow semantics.
2. **Semantic boundary: when does a *task* begin, end, repeat, or get abandoned?** This needs world knowledge ("Send means the reply is done"; "opening a different email starts a new instance"). An LLM should answer it, and it should never be hardcoded.

Most of the "arbitrary heuristics" in the brief (call the LLM after Submit, every 5 s, every 5 clicks) come from using a perception-style rule to answer a semantic question. **Recommendation: answer (1) locally and deterministically, then call the LLM on every perception boundary, and let the LLM own (2) through an explicit, persistent state.**

### 1.2 The unit of analysis: a *Step*, not an event
A Step is one user action plus its settled consequences:

```
Step {
  id, seq (global monotonic, assigned by SW), tabId, windowId, origin, url, routeTemplate,
  action: { kind: click|input-commit|submit|key-shortcut|copy|paste|select|drag-drop|navigate|tab-switch|download,
            target: LocatorBundle, accessibleName, role, landmarkPath, valuePreview? (redacted) },
  effects: { urlChange?, titleChange?, addedRegions: SkeletonFragment[], removedRegions: string[],
             liveRegionText: string[]  // role=status/alert/aria-live text added → "Draft saved", "Issue created"
             net: { opId, method, routeTemplate, status }[], mutatingOk: boolean },
  settled: boolean, tStart, tEnd
}
```
- **Settle algorithm (content script):** open on an action; track significant mutations (ignore `wwa-*` nodes, text-only timestamp ticks, and attribute churn on non-visible nodes), in-flight requests (the probe gains `start` events in addition to `end`), and URL changes. Close after **400 ms of quiet with no in-flight requests**, or at a **3 s cap** (`settled:false`). A new action closes the open Step immediately. Effects that arrive up to 6 s late are merged back into their Step as `lateEffects`. These numbers are perception parameters to tune by experiment (§9 E2), not workflow rules.
- **Why Steps first:** they solve async DOM/network correlation once, locally, for every downstream consumer: passive analysis, recording, and generation context. A Step also gives the generator what it currently lacks: `addedRegions` is the post-interaction DOM.
- **Meaningful-event filter (deterministic, no keystrokes/mouse moves):** clicks resolved to the nearest interactive ancestor; *committed* inputs (`change`, or blur after a value diff on contenteditable) rather than keystrokes; submit; single-key shortcuts only when focus is outside an editable (Gmail `r` = reply); copy/cut/paste; select; drag-drop (file names only); navigations (`webNavigation.onHistoryStateUpdated` [DOCUMENTED] plus `onCommitted`); tab activation and window focus; downloads (`chrome.downloads.onCreated`, optional).

### 1.3 Approaches evaluated
Criteria: A = accuracy, L = detection latency, I = recognises incomplete workflows, B = boundaries, R = repetition, N = robust to extra/missing actions, X = async DOM/net, O = overlapping tasks, T = cross-tab, C = context management, S = false/annoying suggestions, K = implementation complexity.

| # | Approach | Strengths | Fatal weakness | Verdict |
|---|---|---|---|---|
| 1 | **Stateless lightweight LLM after every event** | Low L; simple | No memory, so it cannot see repetition (R), boundaries (B), or overlap (O). Raw events with no settled effects fail X. Every call re-derives context or forgets it | ✗ as the core; ✓ as a per-Step *labeler* (Tier 1 below) |
| 2 | **Evolving AI understanding (persistent state)** | Strong on B, R, O, I. Explicit state is inspectable and testable | Drift and compounding errors unless state is structured and periodically reconsolidated | ✓ **core of the recommendation** |
| 3 | **Stream/batch recent events on a timer or count** | Simple | Window edges are arbitrary and split tasks. A timer triggers on idle (rejected) | ✗ |
| 4 | **Adaptive event triggers (Submit/Send/nav)** | Cheap; good when correct | Hardcodes workflow-end semantics (rejected in the brief). Misses read-only and copy-transfer workflows | ✗ as triggers; ✓ the *generic* signals (mutating 2xx, live-region text, route change) are passed to the LLM as **evidence features** |
| 5 | **Semantic change-point detection (embedding drift)** | Site-agnostic topic shifts | Cannot tell "same task, new page" (GitHub→Jira transfer) from "new task". Drift also happens *inside* a task | ✗ as boundary oracle; at most one feature |
| 6 | **Multiple competing hypotheses** | Handles ambiguity and interleaving (O) | Unbounded hypothesis sets explode | ✓ bounded inside approach 2 (≤3 active tasks, ≤2 goal readings each) |
| 7 | **Hybrid local detection + LLM reasoning** | Puts deterministic work where it is reliable | Depends on where the line is drawn | ✓ **the line is drawn at §1.1: local = perception and data lineage; LLM = semantics** |
| 8a | **Classical task mining / UI-log segmentation** (RPA literature) | Principled | Needs many exact repetitions and canonical action labels. Our users repeat 2–3 times on unfamiliar sites | ✗ |
| 8b | **Sequence alignment (Smith-Waterman over step signatures)** | Tolerates gaps and insertions | Signatures are brittle across sites and redesigns. Detects repetition only, not purpose | ◐ cheap local *repeat hint* to the LLM |
| 8c | **Embeddings for retrieval** | Scales past context | Once history exceeds a few hundred task instances, our pattern library still fits in context | ◐ deferred; add only if the library outgrows the prompt |

**On "LLM after every meaningful click":** yes, at every *settled Step*, with two caveats. (a) A stateless call on raw clicks is strictly worse than a stateful call on Steps. (b) Calls are **serialized per session with coalescing**: while an Activity-Model call is in flight, new Steps queue, and the next call takes all of them. Under fast clicking this degrades to micro-batches with no fixed window, and during normal use it is one call per Step. Token cost is accepted, as the brief requested.

### 1.4 Recommended architecture: event-sourced pipeline with an LLM state machine

```
Tier 0  content script + SW (deterministic)   events → Steps (settle) → redaction → signatures → data lineage
Tier 1  Step Interpreter (Haiku 5.5, per Step, parallel, stateless + 5-step window)
        → SemanticStep { verb, object, entities{...}, isNavigationOnly, readsData[], writesData[] }
Tier 2  Activity Model (Sonnet 5.5, serialized + coalesced, stateful)
        input: frozen system prompt (cached) + current WorkingMemory JSON + last ~12 SemanticSteps + NEW steps
        output: structured patch ops on WorkingMemory (strict JSON schema)
Tier 3  Opportunity Judge (Opus 5.5, event-triggered by Tier 2 flags, conservative rubric)
        → Suggestion | none, plus WidgetRequest + WorkflowSpec draft  → speculative generation job
```

**WorkingMemory (the "evolving understanding")**
```
{ activeTasks: TaskInstance[≤3],          // hypotheses; each may carry ≤2 alternative goal readings
  recentCompleted: TaskInstance[≤20],
  patterns: TaskPattern[],                // recurring task types across sessions (persisted)
  dismissed: {patternId, reason}[],       // negative feedback, fed to the Judge
  focus: taskId | null }
TaskInstance { id, goal, patternId?, status: active|completed|abandoned|uncertain, confidence,
  stepRefs: {seq, role: essential|enabling|optional|noise}[], slots: {name: {value, provenance}},
  completionEvidence?, sites[], expectedNext? }
TaskPattern { id, name, abstractSteps[], parameters: {name, io: input|output, source}[],
  instanceIds[], automationIdea?, lastSeen }
```
Patch ops: `open_task`, `attach_steps`, `fork_hypothesis`, `merge_hypotheses`, `set_slot`, `complete_task(evidence)`, `abandon_task`, `link_pattern`, `create_pattern`, `flag_opportunity(reason)`. The reducer is pure TypeScript, so it is unit-testable and every state change is replayable from the Step log. **Reconsolidation:** whenever a task completes, and every 25 Steps, a second call sees the last ~60 SemanticSteps in full and may rewrite activeTasks and recentCompleted. This corrects drift.

**Why stateless-with-state rather than one long chat transcript:** context stays bounded and predictable, there are no compaction or preserved-thinking edge cases, any model can be swapped in, and the frozen system prompt still caches. A chat transcript is the alternative if E3 shows the delta form loses accuracy.

### 1.5 How each hard question is answered

- **What is a workflow?** A goal-directed sequence that ends in a *durable effect* (server mutation, artifact downloaded, data transferred, or a decision reached). It is identified by its goal and parameter slots, never by its clicks.
- **Inferring the goal:** Tier 1 labels each Step semantically. Tier 2 explains the sequence as a goal and must cite Steps. The `expectedNext` field makes the hypothesis falsifiable: a mismatch lowers confidence or forks a hypothesis.
- **Beginnings and ends:** these are LLM decisions over evidence features. A start is the first Step whose data or object is used by the eventual effect. An end is a completion-evidence feature (mutating 2xx, live-region "saved/sent/created", route to the new resource, download done) or the user moving to a new object after reaching the goal state. Boundaries can be **revised** during reconsolidation; no decision is final at Step time.
- **Repetition without exact clicks:** an instance is matched to a pattern by goal plus slot structure, and the Step signature repeat-hint (8b) is a supporting feature. Workflow A and Workflow B from the brief both resolve to goal "reply to email", slots {thread, replyText}, completion "draft saved/sent". "Expand hidden content" is tagged `enabling`.
- **Essential vs optional, deterministically assisted:** a Step is *enabling* if the next Step's target lies inside its `addedRegions` (it revealed the next affordance). It *feeds data* if lineage shows a value it read is later written. Otherwise it is a candidate for `optional` or `noise`. Across instances, Steps present in every instance are essential. Steps that are enabling only sometimes become **conditional** ("expand if collapsed"), and the generator turns that into an `if`.
- **Variable inputs and outputs, via data lineage (local, high-value, cheap):** values read (copy, selection, extracted text in Step context) are hashed and normalised. When a later input or paste on any tab contains one, we emit a `flow` edge (source Step → sink Step, field). Values that differ across instances of a pattern are parameters. AI-authored values (reply text) have provenance `user-authored`, which marks them as candidates for `WidgetAI.inference`. **This is the strongest generic signal for cross-site workflows (GitHub→Jira) and needs no site knowledge.**
- **Did it actually complete?** It completes only on a completion-evidence feature. Otherwise the status is `uncertain`, and uncertain instances never count toward suggestion thresholds.
- **Interruptions and overlap:** up to 3 active tasks. A Step is attached to the best-fitting task by object, entities and site. Unattached Steps are `noise`. Tasks are abandoned only through the LLM's judgement during reconsolidation, never by a timer.
- **Cross-site:** one global timeline ordered by SW `seq`, using page `Date.now()` for intra-tab precision (same machine clock), with explicit `tab-switch` Steps and lineage edges. Most cross-site tasks show up as lineage edges.
- **Avoiding premature suggestions:** (1) suggest only at **task boundaries** (on `complete_task`), never mid-typing; (2) the Judge requires either ≥2 completed instances of a pattern, or 1 completed instance with high *mechanical-transfer* evidence (≥3 lineage edges, or the same operation over several items); (3) dismissals suppress the pattern and are shown to the Judge; (4) at most one visible suggestion, with a cooldown per pattern.
- **Opportunities without repetition:** a single completed instance qualifies when the work is obviously mechanical. Examples: lineage-heavy transfer between sites, the same micro-operation over N items (expanding 8 "read more" links, opening 5 products in turn), or reading-heavy work over large content (comment threads). The model's world knowledge supplies "this is tedious" and lineage supplies the proof.

### 1.6 Worked edge cases
- *Gmail A vs B:* Step 2 in B ("expand quoted text") added the region containing the Reply affordance, so it is `enabling`. The same pattern is matched. The generated code includes "expand if collapsed".
- *User opens an email, reads it, archives it (no reply):* the task completes with a different goal ("triage"). It is not counted toward the reply pattern.
- *User starts a reply, switches to Slack, returns 10 min later:* the task stays active. Slack Steps open a second task or are noise. Elapsed time is never used.
- *Async: draft autosave fires 2 s after typing stops:* settle merges it as a late effect of the input-commit Step. If it arrives later still, it is attributed through probe correlation to the open Step on that tab.
- *Two Jira tickets created from two GitHub issues, with the second done slightly differently (keyboard shortcut instead of button):* goal and slots match, and lineage edges (title→summary, body→description) match. Pattern instance count becomes 2 → Judge → suggestion.
- *Pure browsing noise (news reading):* Tier 1 marks `isNavigationOnly`. No durable effects means no completed tasks and no suggestions. Measured by eval (§9 E4).

### 1.7 Uncertainties I am not resolving by assertion
Settle thresholds on Gmail-class pages with constant background mutation (E2). Whether the delta-state form loses accuracy compared with a full transcript (E3). Judge precision on noise traces (E4). Whether Haiku-class Step labels are good enough or Tier 1 should merge into Tier 2 (E3 ablation). All of these are measured with the **trace-replay eval harness** (§8 Phase 1), which makes prompt iteration offline and fast.

---

## 2. System architecture

```
Chrome
 ├─ netprobe.js (MAIN, document_start, all frames)   fetch/XHR/beacon (+start events) → content
 ├─ content.js (ISOLATED, top frame)                  StepRecorder (settle, locators, snapshots, redaction,
 │                                                   clipboard lineage) · PageContext · in-page UI host
 │                                                   (REC pill, suggestion card: extension-owned Shadow DOM)
 ├─ sw.ts  (orchestrator, split into modules)
 │    observe/  StepIngest → seq → EventStore (IndexedDB) → ObserveClient (single in-flight POST, coalescing)
 │    record/   RecordingSession (commands, badge, storage.session state)
 │    net/      NetLog (+ webRequest cross-check, op verification tiers)  [extends existing]
 │    flow/     FlowCoordinator (cross-tab runs, durable in storage.session, alarms)
 │    jobs/     JobClient (background generation long-poll)
 │    widgets/  existing generate/run/repair/remove + register persistence
 ├─ sidepanel (React + Tailwind + shadcn/ui)          Create · Widgets · Activity · Record review
 └─ generated widgets (USER_SCRIPT world, worldId)    WidgetAI.{inference,log,status,storage,net,flow}

Backend (Fastify, single process, in-memory + JSON file snapshots in .data/)
 ├─ /api/observe/steps     Tier1 ‖ → Tier2 → (Tier3) → returns {state, suggestions[]}
 ├─ /api/recordings/interpret   recording → WorkflowSpec (Opus 5.5)
 ├─ /api/jobs  POST start {kind: generate|regenerate, request, spec?, pageContext}; GET /:id?wait=25 long-poll; DELETE cancel
 ├─ /api/generate-widget   (kept; becomes a thin sync wrapper over the job runner)
 ├─ /api/inference         (kept)
 └─ llm/ provider abstraction (kept; adds structured-output + effort options)
```

**Execution lifecycle (unchanged contract, new inputs):** evidence (PageContext, Steps, WorkflowSpec, net ops) → generate job → validate (existing denylist/acorn + new bundle checks) → user approval card (plain-language plan, sites, grants, consequential actions, optional code) → execute/register → widget reports status → edit/repair through conversation (prior code + spec + error evidence).

**Data flow decisions**
- The Step log is authoritative **in the extension** (IndexedDB, raw values kept locally for replay and lineage). The backend receives the **redacted** Step view only. WorkingMemory is authoritative **in the backend**, keyed by an install-id session and snapshotted to `.data/`. No DB.
- The SW sends one `POST /api/observe/steps` at a time. The response carries the updated state and suggestions. Steps arriving meanwhile queue in `storage.session` (survives SW suspension [DOCUMENTED]), which implements coalescing for free. The in-flight fetch keeps the SW alive.
- Background generation runs as a backend job so it survives SW death. The SW long-polls in 25 s slices. The panel and the in-page card get progress through SW broadcasts.

---

## 3. Recording architecture

**Shortcuts [DOCUMENTED]:** `manifest.commands`: `toggle-recording` (suggested `Alt+Shift+R`) and `toggle-observation` (`Alt+Shift+O`). Chrome allows at most 4 suggested keys, and users can rebind at `chrome://extensions/shortcuts`. Handled in `chrome.commands.onCommand(cmd, tab)`. The same actions are available as panel buttons and `PanelToSW` messages, which tests also use (E1: synthetic keys likely do not trigger browser-level commands).

**Session:** `RecordingSession {id, startedAt, startTab, tabs:Set, steps:seq[], snapshots, instructions?, status: recording|stopped|interpreting|ready}` is persisted in `storage.session`. Recording is **window-global** and follows tab switches (GitHub→Jira). Indicators: action badge "REC" red (`chrome.action.setBadgeText`) + a pulsing in-page pill on every participating tab (extension-owned Shadow DOM, click to stop) + panel state.

**Richer capture while recording** (on top of the Step pipeline):
- Full `PageContext` (existing `extractContext`) at start, stop, and each route change, deduped by hash.
- For each Step: a **LocatorBundle** with several candidate selectors, modelled on Chrome DevTools Recorder: id, `data-*`, `role+accessibleName`, `aria-label`, text match, and a short CSS path, each with a uniqueness count at capture time. Also the `addedRegions` skeletons, up to ~2 KB per Step, *of exactly the post-click DOM*.
- All net records in the window, attributed to Steps by step id (replacing the 6 s window as primary).
- Optional (stretch): `chrome.tabs.captureVisibleTab` thumbnails at Step boundaries for multimodal interpretation.

**On stop → Review sheet (panel):** a timeline of SemanticSteps (Tier 1 labels) → **Workflow Interpreter** (Opus 5.5, `/api/recordings/interpret`) produces:
```
WorkflowSpec { goal, trigger: {site, placement: "button in GitHub issue header"}, inputs[], outputs[],
  steps: { intent, site, essential|conditional|optional, evidence: {stepSeq, locators, regionSkeleton, netOpIds} }[],
  dataFlow: lineage edges, successCriteria[], consequentialActions[] (send/publish/delete → stop-before by default),
  strategyHints: { dom|network|hybrid per step, with reason }, openQuestions[] }
```
The user can strike Steps ("ignore step 3"), answer `openQuestions`, and add free-text instructions ("draft instead of publish", "do this for all matching issues", "run from a button in GitHub"). These go back through the interpreter once (cheap), then generation starts.

**Conversion to automation, and why not replay:** the generator receives the WorkflowSpec plus the evidence fragments, not a click list. It is told to achieve the goal and the success criteria, preferring stable locators from the bundles, generalising over items ("all matching issues"), and choosing DOM, network or hybrid per step from evidence (§4). **The generated script remains the executable artifact.** The spec is saved with the widget (`WidgetRecord.spec`) and reused for edits and repair. Decision: *script primary, structured spec as the persistent intermediate*. A replay DSL would duplicate the generator and lose generalisation (loops, inference, conditionals).

---

## 4. Network observation architecture (extend existing)

**Capability matrix**

| Mechanism | Req body | Resp body | Modify/replay | Coverage gaps | Notes |
|---|---|---|---|---|---|
| MAIN-world fetch/XHR/beacon patch (**built**) | ✓ [VERIFIED] | ✓ [VERIFIED] | replay via page's original fetch with ambient cookies ✓ [VERIFIED on fixture] | web/service workers, WebSocket, form-POST navigations, requests issued before document_start | Page can see/forge postMessage traffic (security fix below) |
| `chrome.webRequest` (observe-only in MV3) | raw/formData ✓ | ✗ | ✗ | none for HTTP (incl. workers) | Unforgeable by the page → **integrity cross-check + coverage** [DOCUMENTED] |
| `chrome.debugger` / CDP `Network.*`, `Fetch.*` | ✓ | ✓ (`getResponseBody`) | intercept/modify ✓ | — | Persistent "is debugging this browser" infobar; `debugger` permission. **Opt-in "deep capture" during recording only** (stretch) |
| WebSocket ctor patch (MAIN) | frames ✓ | frames ✓ | send ✓ | — | Stretch; real-time sites |

**Extensions to build**
1. **Security fixes to the existing probe (required).** (a) Records are posted with `'*'` to `window.top`, which leaks *iframe* request bodies to a possibly cross-origin top page, and page scripts can read them. Fix: post only when same-origin with top; otherwise route through that frame's own isolated content script (switch `content.js` to `all_frames` with a frame-aware relay). (b) The page can **forge** `source:'wwa-net'` records, which poisons LLM context and is a prompt-injection vector. Fix: mark every probe record `provenance:'page'`, cross-match it against webRequest `onCompleted` (url+method+±2 s), set `confirmed:true`, and let only confirmed ops be offered for replay. (c) **Redact** before anything leaves the extension: `Authorization`, `Cookie`, `X-*-Token`/`csrf`/`xsrf` headers, bearer-like high-entropy strings, and JSON fields matching `/pass|secret|token|otp|cvv|ssn/`. Raw values stay local for page-context replay.
2. **Step attribution:** `NetTrigger` becomes `stepId`, with the time window as fallback.
3. **Op analysis (deterministic, fed to the generator):**
   - **Route templates:** `/repos/:owner/:repo/issues/:n`.
   - **Dynamic-field detection:** fields that differ across two captures of the same template, or high-entropy values → `tokenFields`.
   - **Dependency inference:** a value in request B that appeared in an earlier response A gives `B.dependsOn A.path`, so the widget re-fetches A first instead of replaying a stale token.
   - **Duplicate/idempotency hints:** mutating op + client-generated id fields.
4. **Verification tiers per op template**, stored in NetLog and shown to the generator and panel: `observed` → `replayed` (platform saw a replay return 2xx with a response shape similar to the original) → `verified` (a widget run's success criterion passed through read-back, reported by `WidgetAI.net.reportVerified(opId, evidence)`). **Mutating ops are never auto-probed.** They are exercised only inside user-approved widget runs. GET ops may be auto-probed during generation.
5. **Generator strategy rule (prompt):** choose network when the op is `confirmed`, its template and parameters are understood (JSON/GraphQL/urlencoded, low token-field count, dependencies resolvable), and the success criterion can be read back. Choose DOM when payloads are opaque or positional (Gmail-class batched arrays: likely DOM [ASSUMPTION, E6]). Choose hybrid when DOM is used for reading or confirmation and network for the mutation. Network-first code must have a DOM fallback path when the network path fails `reportVerified`.

---

## 5. Cross-website execution architecture

**Widget bundle (extends `GeneratedWidget`, backward compatible):**
```
GeneratedWidget { ...existing, parts?: WidgetPart[] }
WidgetPart { role: string, matchPatterns: string[], code: string, entryUrl?: string,
             handlers?: string[] }   // e.g. role "jira-sink", handlers ["createTicket"]
```
The main `code` and `matchPatterns` stay the "home" part. Each part is validated with the same denylist and acorn checks. The approval card lists every origin the bundle touches. A new grant, `flow`, is required.

**Platform API (generic, no site knowledge):**
- Home part: `WidgetAI.flow.call(role, handler, input, {openUrl?, reuseTab=true, activate=true}) → Promise<result>`.
- Sink part: `WidgetAI.flow.handle(handler, async (input, ctx) => result)`, `ctx.checkpoint(state)` before navigating, `ctx.resumeState`, `ctx.cancelled()`.

**Coordinator (SW `flow/`):**
1. `call` creates `FlowRun {runId, widgetId, role, handler, input, status, checkpoint, homeTabId, targetTabId}` in `storage.session` (survives SW suspension) and arms a `chrome.alarms` timeout (`setTimeout` dies with the SW).
2. It finds a tab matching the part's patterns (`tabs.query`) or creates one at `entryUrl`, then waits for `tabs.onUpdated status:complete` plus a content-script ping.
3. **Simplest robust invocation:** `userScripts.execute` the part with `FLOW_INVOCATION = {runId, handler, input, resumeState}` baked into the prelude, so the sink needs no inbound channel. The result returns over the existing `sendMessage` → `FLOW_RESULT`. (A port via `onUserScriptConnect` is the alternative if E5 shows it is reliable.)
4. If the sink navigates mid-handler, `tabs.onUpdated complete` on `targetTabId` with run status `running` re-injects with `resumeState` from the last checkpoint.
5. Tab closed or timeout → run fails → the home part's promise rejects with a reason. Cancel from the home widget or panel sets `cancelled` and the next platform call in the sink rejects.
6. **Background-tab throttling [DOCUMENTED]:** timers in hidden tabs are throttled to 1/s and `requestAnimationFrame` stops. The default is `activate:true`: focus the target tab during the run with a progress pill, then return focus to the home tab. Measure the alternative in E7.
7. Auth comes from the user's existing browser session in each tab. The platform never handles credentials.
8. End-to-end success: the sink must return `{ok, evidence:{url|id|text}}` verified by DOM or net read-back (prompt rule). The home part shows a link. The run log and every run's input/output are stored for the panel trace.

---

## 6. AI agent architecture

**No LLM orchestrator.** It is a deterministic TypeScript pipeline with an in-process job queue. Every stage has a narrow contract and a schema, which keeps behaviour testable and debuggable. An agent framework would add nondeterminism where we need traces.

| Task | Model | Effort/thinking | Output | Why |
|---|---|---|---|---|
| Step Interpreter (Tier 1) | `claude-haiku-5-5` | low | structured JSON | Per Step, parallel, latency ~1 s; small context |
| Activity Model (Tier 2) + reconsolidation | `claude-sonnet-5-5` | medium (low if latency hurts) | strict patch-op JSON schema | Serialized hot path; needs judgement; frozen cached system prompt |
| Opportunity Judge (Tier 3) | `claude-opus-5-5` | high | Suggestion schema | Rare; precision matters most; sees dismissals |
| Workflow Interpreter (recording) | `claude-opus-5-5` | high | WorkflowSpec schema | One call per recording; quality-critical |
| Widget Generator / Repair / Edit | `claude-opus-5-5` | high (xhigh for bundles) | widget/bundle schema; **streamed** (long outputs) | Codegen quality is the product; adaptive thinking always on |
| Widget runtime inference | `claude-sonnet-5-5` (config) | low–medium | text | User-facing latency inside widgets |

Implementation notes: add `output_config.format` (JSON schema) and `effort` to `CompleteOptions`; delete `temperature` (400 on current models); stream generation and use `finalMessage()`; handle `stop_reason:"refusal"` with server-side `fallbacks:"default"` on Opus and Sonnet calls; put prompt caching on frozen system prompts with no timestamps. Every model ID stays env-configurable. The mock provider gains deterministic handlers for each new marker (`STEP-INTERP`, `ACTIVITY`, `JUDGE`, `WF-INTERP`) so E2E stays deterministic.

**Evidence the generator receives (new):** WorkflowSpec + Step evidence (locator bundles, `addedRegions`) + op analyses with verification tiers + the pattern instances' slot values (as test cases) + "why suggested". This turns the handoff's "probe-then-generate" into "observe-then-generate".

---

## 7. Frontend & interaction design

**Two UI layers, kept separate**
- **Extension UI (side panel):** React 18 + **Tailwind v4 + shadcn/ui** (copied Radix-based components; esbuild-compatible; CSS built by `@tailwindcss/cli` in `build.mjs`). Use Magic UI and 21st.dev patterns only for references or small accents: a shimmer for generating, an animated border for "suggested". Avoid heavy motion libraries. Font: Inter or Geist. Neutral palette with one accent. Dark mode.
- **In-page extension-owned UI** (REC pill, suggestion card, flow progress): vanilla TypeScript + Shadow DOM inside `content.js`, under 10 KB CSS, no React. This is packaged code, not generated.
- **Generated widgets:** unchanged rules: lightweight, Shadow DOM, native placement preferred, dock fallback.

**Panel structure (tabs):** **Create** (chat) · **Widgets** · **Activity** · plus a global header with health, an Observe toggle, and a Record button that shows the shortcut hint.
- **Create / Edit as one conversation per widget:** a thread of user turns and generator turns. Each generator turn shows a version chip (v1, v2…), a short "what changed" summary (new generator output field `changeSummary`), and a status (loading skeleton → success/error with Retry). Multiline auto-growing textarea, ⌘/Ctrl+Enter to send, quick-action chips ("Move into toolbar", "Make collapsible", "Add progress"). The server receives prior code + spec + conversation history (last N turns) + latest runtime error and logs.
- **Approval card:** name; **"What it will do"** (generator `plan: string[]`, plain language); sites touched; grants as human sentences; **consequential actions** flagged (anything that sends, publishes or deletes needs a second confirm at runtime). Buttons: **Approve & install** · **Modify** (focuses the thread) · **Reject**. "View code" is a collapsed, syntax-highlighted accordion. Generation never auto-runs consequential actions.
- **Widgets tab:** cards with status, last run, logs drawer, enable/disable per site, version history with revert, remove.
- **Activity tab:** a live "what I think you're doing" view (activeTasks with goal and confidence), a recent-completed list, a patterns list with instance counts, and suggestions history with dismissed items restorable. Pause/clear observation and a per-site denylist live here. This is also the explanation surface: every suggestion links to the task instances and Steps that justify it.
- **Record review sheet:** described in §3: timeline, interpretation, editable spec, instructions box, Generate.
- **In-page suggestion card (bottom-right, non-modal, appears only at task boundaries):** a title ("Draft replies to your remaining 6 unread emails?"), a one-line *why* ("You replied to 2 emails the same way in the last few minutes"), a "Details" expander (the observed steps), and **Accept · Not now · Never for this**. States: `generating` (progress ring; Accept is still allowed and becomes "Preparing…", and when ready it shows the approval card in the panel) → `ready` → `failed` (Retry or open in panel). Dismissing cancels the job (`DELETE /api/jobs/:id`) or discards the result. Suggestions persist in `storage.local` keyed by pattern and re-surface on matching origins when they are still relevant (judge TTL).

**Suggestion pipeline details:** dedupe by `patternId` (one live job per pattern; a job is reused if the spec hash is unchanged). Ranking is Judge `score = value × confidence × feasibility`, and only the top one is shown. On generation failure, retry once with the validator error; if it fails again, the card shows "couldn't build it — open in panel". The generation prompt includes the pattern's instances as concrete test cases.

---

## 8. Implementation plan

### Priority challenge
I recommend reordering the brief's priorities: **(1) shared Step pipeline → (2) recording → (3) passive activity model and suggestions → (4) cross-site → (5) network upgrades in parallel**, with the UI shell early rather than last.
- **Recording before passive observation:** it uses the same infrastructure, its boundaries are explicit (so it carries the least research risk), and it directly fixes the MVP's biggest weakness (codegen without post-interaction DOM).
- **UI shell early:** recording review, the Activity tab and suggestions add a lot of UI. Restyling last means building the panel twice.
- **Network upgrades:** mostly built already. The probe security fixes belong in Phase 0, and the analysis and verification work can run in parallel.

### Phases

**Phase 0: New skeleton + port (1–1.5 days).** *Superseded by the "NOTE TO IMPLEMENTERS" and "Codebase organization" sections at the top.* On branch `nextgen`, build the new layout (contracts, core, widget-runtime, bus, platform wrappers, module stubs with READMEs, `llm/callModel` + llm_calls log, traceId plumbing, panel tab shell with Tailwind + shadcn). Port the MVP's proven behaviour (table in the note), including the probe security fixes 4.1(a–c) and the model migration (no `temperature`; structured outputs, effort, streaming; new model IDs). Gitignore `.pw-profile`, `.demo-profile`, `test-results`, `.data/`. *Accept:* ported Gmail, YouTube and net E2E specs green on the new architecture; unit tests green; live generation run on fixture-gmail2 succeeds.

**Phase 1: Step pipeline + trace eval harness (1.5 days).** Depends on 0.
- `content/steps/`: `settle.ts` (pure state machine, fake-timer tests), `locators.ts`, `redact.ts`, `regions.ts` (mutation-root skeletons), `lineage.ts` (copy/paste/selection hashing).
- Probe `start` events.
- SW `observe/` (seq, IndexedDB EventStore, tab and webNavigation events).
- Shared types `Step`, `LocatorBundle`, `SemanticStep` in `packages/shared`.
- **`tests/traces/` + `tests/tools/trace-eval.mjs`**: export Step logs from fixtures, replay them offline into backend stages, score them against hand labels.
- *Accept:* on fixture-gmail2, "open row → click reply → type → save" yields 4 Steps with correct `addedRegions` (composer skeleton present) and a live-region "Draft saved" effect; no password or typed-secret value appears in exports.

**Phase 2: UI shell (1 day, parallel with 1).** Tailwind + shadcn in the build, panel tabs, approval card with a `plan` field (generator prompt/schema adds `plan`, `changeSummary`), conversational edit thread replacing the input. *Accept:* existing E2E selectors updated and green; manual visual pass.

**Phase 3: Recording → WorkflowSpec → widget (Demo 1) (2 days).** Depends on 1, 2.
- Commands and indicators.
- `RecordingSession`.
- `/api/recordings/interpret`.
- Review sheet.
- Generator accepts `spec`.
- `WidgetRecord.spec`.
- *Accept (mock-LLM E2E `record.spec.ts`):* start recording via message → user replies to 1 email on fixture-gmail2 → stop → spec shows goal and slots → generate → approve → widget drafts replies for the remaining unread emails; fixture asserts N drafts, 0 sent. *Live acceptance:* the same flow with Opus 5.5 on fixture-gmail2 passes first try in ≥3 of 5 runs (baseline today is about 1 in 3–4 iterations).

**Phase 4: Activity model + suggestions + background jobs (Demo 2) (2.5 days).** Depends on 1 (and 3 for the spec path).
- Backend `observe/`: Tier 1, Tier 2 with reducer, reconsolidation, Judge.
- `jobs/` runner with cancel and long-poll.
- SW ObserveClient with coalescing.
- In-page suggestion card.
- Activity tab.
- *Accept (mock E2E `suggest.spec.ts`):* reply manually to 2 emails → suggestion card appears after the 2nd completion (not before) → job runs → Accept → approval → install → drafts created. Dismiss → no re-suggestion for that pattern. *Eval acceptance (live):* ≥8 of 10 labeled repeat traces get the correct pattern; 0 suggestions on 5 noise traces; mean suggestion latency after task completion under 10 s.

**Phase 5: Cross-site flows (Demo 3) (2 days).** Depends on 3.
- `apps/fixture-issues` (GitHub-like) served on `127.0.0.1:8787` and `apps/fixture-tracker` (Jira-like with a real REST mock) on `localhost:8787`, which are different origins.
- Bundle parts.
- `WidgetAI.flow`.
- FlowCoordinator with checkpoints, alarms and cancellation.
- Recording across tabs with lineage edges.
- *Accept (`flow.spec.ts`):* record issue→ticket once → generated bundle → click "Create ticket" on another issue → tracker server has a ticket with the mapped title and body → home widget shows the link. Closing the target tab mid-run gives a clean failure.

**Phase 6: Network-aware generation (1.5 days, parallel with 4–5).** Depends on 0.
- Step attribution.
- webRequest cross-check.
- Route templates, token fields and dependency inference (`net/analyze.ts`, pure, unit-tested).
- Verification tiers and `reportVerified`.
- Generator strategy rule.
- *Accept:* `net.spec.ts` extended so the generated widget uses invoke with a re-fetched dependency token (fixture adds a rotating CSRF token) and reaches `verified`.

**Phase 7: Polish and the real-site demo (rest).** Real Gmail recording demo (manual checklist), real GitHub→Jira only if E8 is positive, `record-demo.mjs` updated, docs.

### Module and interface sketch (new shared contracts, `packages/shared/src/`)
`steps.ts` (Step, LocatorBundle, SemanticStep, LineageEdge) · `activity.ts` (WorkingMemory, TaskInstance, TaskPattern, PatchOp, Suggestion) · `workflow.ts` (WorkflowSpec) · `flow.ts` (WidgetPart, FlowRun, flow messages) · `jobs.ts` (Job, JobStatus). New messages extend the existing `PanelToSW`/`SWToPanel`/`UserScriptMsg` unions. Existing types are reused and widened, never renamed.

### Technical risks
| Risk | Mitigation |
|---|---|
| Settle never quiesces on Gmail (background polling) | Significance filter + 3 s cap + E2 measurement; ignore offscreen and attribute-only churn |
| Activity-model drift and false suggestions | Structured state, evidence citations, reconsolidation, boundary-only surfacing, Judge with dismissals, trace eval gate |
| Privacy (all browsing sent to LLM) | Observation **opt-in**, per-site denylist (banking, password managers, chrome://, incognito excluded), redaction, pause shortcut, visible indicator |
| Page-forged net records / prompt injection | webRequest confirmation, untrusted-data framing in every prompt |
| Generated cross-site bundles misbehave | Per-part validation, explicit origin approval, consequential-action stop, run traces |
| Concurrent uncommitted work in this checkout | Phase 0 coordination before any edits |
| Scope | Demos 1 and 2 are the must-ship; Phase 5 is the stretch headline |

### Test strategy
- **Unit (node:test):** settle machine (fake clock), redaction, locator ranking, lineage matching, activity reducer (patch ops → state), Judge gating and dedupe, job runner cancel, flow coordinator state machine, op analysis (templates, tokens, deps), bundle validator.
- **E2E (Playwright, mock LLM, deterministic):** `record.spec`, `suggest.spec`, `flow.spec`, extended `net.spec`, plus the existing 4 specs as regression.
- **Trace-replay eval (live LLM, offline):** labeled traces → boundary F1, pattern accuracy, suggestion precision, latency. This is the gate for prompt changes.
- **Manual:** real Gmail checklist (`docs/manual-test.md` extended).
- **Logging:** a trace for every LLM call (stage, model, latency, input hash, output) to `.data/traces/*.jsonl`, viewable in the Activity tab's debug drawer.

### End-to-end demonstration plan
1. **Demo 1 (Recording):** Gmail fixture, then real Gmail. Alt+Shift+R → reply to one email → Alt+Shift+R → review shows "Reply to unread emails · inputs: thread · AI-authored: reply" → add "draft only, do all unread" → approve plain-language plan → toolbar button appears → click → drafts created, 0 sent.
2. **Demo 2 (Proactive):** with observation on, the user manually replies to two emails. At the second completion a card appears ("You replied to 2 emails the same way…"), with generation already running. Accept → approve → done.
3. **Demo 3 (Cross-site, stretch):** issue tracker → ticket tracker fixtures. Record once, then a "Create ticket" button on every issue, with a result link back.

---

## 9. Open questions → smallest experiments

| # | Question | Smallest experiment |
|---|---|---|
| E1 | Do Playwright-synthesized keys trigger `chrome.commands`? | Add a command, `page.keyboard.press('Alt+Shift+R')` headed and headless, log `onCommand` in the SW. If it doesn't fire, tests use the message path (planned anyway) |
| E2 | Settle thresholds on real Gmail and YouTube | Instrument the content script to log mutation and in-flight timelines for 20 real clicks per site; plot time-to-quiet; pick quiet window and cap |
| E3 | Stateful delta vs full transcript vs per-step stateless; is Tier 1 needed? | Trace eval on 10 labeled fixture traces in 4 configurations; compare boundary F1 and pattern accuracy |
| E4 | False-suggestion rate on noise | 5 noise traces (news, docs reading, shopping browse) through Tier 2+3; target 0 suggestions |
| E5 | Is `onUserScriptConnect` port messaging bidirectional and stable in a `worldId` world? | Extend `poc/run.mjs` with a port round-trip from the SW to a user script |
| E6 | Is Gmail draft-save replayable via the network? | On a test account, capture draft save and replay with a changed body through `NET_REPLAY`; record status and whether the draft appears |
| E7 | Does a sink part complete in a background tab? | Run the fixture-tracker sink with `activate:false`; measure duration vs foreground |
| E8 | Jira Cloud REST from page context with cookie auth (XSRF header needs) | On a Jira Cloud free site, `WidgetAI.net.request` POST `/rest/api/3/issue` from the Jira tab; record outcome |
| E9 | Can `copy`/`paste` handlers read selection and clipboard text in the isolated world on contenteditable-heavy sites? | 10-line content-script test on GitHub and Jira fixtures and real pages |
| E10 | Activity-model latency under fast clicking | Replay a 30-Step burst trace at real timing; measure queue depth and suggestion latency with Sonnet 5.5 at low and medium effort |

## Verification (how this plan will be checked during implementation)
- Each phase ends with its acceptance criteria above. Required commands: `npm run typecheck`, `npm run test:unit -w apps/backend`, `npm run test:unit -w apps/extension`, `cd tests/e2e && npx playwright test` (mock LLM; needs :8787 free), and `node tests/tools/trace-eval.mjs` (live) for Phases 1, 4 and 6.
- Live checks: `TARGET_URL=<fixture> npx tsx tests/tools/live.mjs` for generation quality; `gmail-live.mjs` for real-Gmail demos.
