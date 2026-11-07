# Phase F — Cross-site flows (Demo 3)

## HANDOFF
- Status: **DONE** — doc §5 implemented end-to-end (bundle parts + validation, `WidgetAI.flow` call/handle, durable
  FlowCoordinator with storage.session runs, chrome.alarms timeouts, checkpoints + re-injection on navigation,
  cancellation from home/panel, focus/return + progress pill), cross-tab recording → lineage → bundle, issues/tracker
  fixtures on different origins. Mock gate green; E5 + E7 recorded. Live: see "Live run" below.
- Shared files edited (minimal, called out): `contracts/src/widget.ts` (+grant `flow`, +`parts?`), `contracts/src/flow.ts`
  + `messages/flow.ts` (ours), `background/platform/index.ts` (+`tabs.create/activate`, +`alarms`), `manifest.json`
  (+`alarms`), `modules/widgets/service.ts` (`authorize` accepts part ids `<id>#<role>` confined to the PART's patterns;
  `mustGet` strips `#role`), `modules/widgets/index.ts` (sink parts never set the widget status — 1 line),
  `modules/record/service.ts` (cross-tab recording generates on the START tab — 2 lines), `widget-runtime/src/index.ts`
  (`flowInvocation` input + `buildPartSource`), `generate/validate.ts` (+`checkBundle`), `prompts/widget.ts` (`parts` in
  the JSON schema), `prompts/widget.mock.ts` (1 branch), `fixtures/index.ts` (STATIC + tracker API), `panel/components/WidgetCards.tsx`
  (bundle sites on the approval card, `flow` grant text, part code, `<FlowRuns>` on the widget card).
- Next for the coordinator: merge; nothing in progress.

## Decisions
- 14:50 — Home promise = `FLOW_CALL` (returns `runId` at once) + `FLOW_WAIT` long-poll (20 s slices, re-asked on transport
  errors) instead of keeping one sendMessage open for the whole run — the run is durable in storage.session, so the
  home survives SW suspension. Rejected: a single pending sendMessage (dies with the SW).
- 14:50 — Sink parts run as widget id `<widgetId>#<role>` in world `<widgetId>#<role>`; `widgets.authorize` checks the
  PART's match patterns for such ids (the home id stays confined to the home patterns). Parts share the widget's grants.
  Parts are NOT registered as userScripts on their origin — they only run when the coordinator injects them with a
  baked-in `FLOW_INVOCATION` (doc §5.3), so an approved bundle never acts on the tracker unless the home started a run.
- 14:50 — Re-injection guard: a `tabs.onUpdated complete` on the target is treated as a navigation only if the part's
  world no longer holds `globalThis.__wwaFlowHandled === runId:n` (same worldId shares globals per document). Prevents a
  late "complete" of the first load from running the handler twice (= duplicate ticket).
- 14:50 — Sink success = handler returned `{ok:true}`; anything else (incl. `{ok:false}` after read-back mismatch) fails
  the run, keeping the result in the run for the trace. Prompt rule: return ok only after reading the item back.
- 14:55 — Danger guard and "Create": the Phase C guard is unchanged and is part of every part's prelude (unit-tested).
  "Create" is NOT in `DANGER_WORDS` and I did not add it: creating a ticket in the user's own tracker is a reversible,
  draft-like create, not send/publish/delete. Instead the cross-site create must be listed in `consequentialActions`
  (approval card) and every origin is approved explicitly. A sink clicking Send/Submit/Delete/Publish is still blocked.
- 14:55 — No settings flag for flow (like Phase A's data): inert unless an approved widget declares `parts` + grant `flow`.
  Adding a Settings key would touch system.ts/DEFAULT_SETTINGS owned by Phase 0.
- 14:55 — Bundle validation lives in `packages/core/src/bundle.ts` (pure, unit-tested) and is called from the backend
  validator: parts need grant `flow`; concrete hosts only (no `*://*/*`); roles slug + unique; declared handlers must be
  registered with `WidgetAI.flow.handle`; home `flow.call(role, handler)` literals must exist; parts cannot call flows;
  home cannot register handlers; entryUrl http(s) and inside the part's patterns; ≤4 parts; each part through
  `checkGeneratedCode`.
- 15:00 — Mock gate uses the RECORDING path (not a request): record copy title/body on the issue tab → paste into the
  tracker tab → Create, stop → spec with cross-tab lineage → generate from the Record tab → approve → run on issue #102.
  The failure test generates the same bundle from a request (faster). Both paths hit the same mock branch.
- 15:00 — Record module generated on the LAST participating tab; for a multi-tab recording the home must be where the
  user started, so `REC_GENERATE` now uses `session.startTab` when >1 tab participated (single-tab unchanged).
- 15:00 — Tracker fixture navigates (full page load) from the Create form to `ticket.html?key=…` so every run exercises
  checkpoint → re-inject with `resumeState`. A reused tab sitting on a ticket page triggers a second navigation
  (checkpoint → go to the form → resume) — the main test asserts 3 injections, 2 navigations.
- 15:05 — Panel: widget cards of bundles show their cross-site runs (status, event timeline, evidence link, error, Cancel)
  via `GET_FLOW_RUNS` + `FLOW_RUN_UPDATE` broadcasts (new `panel/components/FlowRuns.tsx`).

## Stuck log
- E7 (background throttling) could not be observed under Playwright: background tabs report `visibilityState:'visible'`
  even headed and even with Playwright's `--disable-background-timer-throttling`/`--disable-renderer-backgrounding`/
  `--disable-backgrounding-occluded-windows` defaults removed (focus emulation). Recorded as inconclusive, not retried
  further (3 approaches: flow run headless+headed, userScripts timer loop headless+headed, plain Chromium without the flags).

## Phase report
(see below — filled at the end)
