# modules/flow — FlowCoordinator (Phase F, doc §5)

Cross-site flows: a widget **bundle** = home part (`code`/`matchPatterns`) + `parts[]` on other sites. The home calls
`WidgetAI.flow.call(role, handler, input, {openUrl?, reuseTab=true, activate=true, timeoutMs?})`; a part registers
`WidgetAI.flow.handle(handler, async (input, ctx) => ({ok, evidence}))` (`ctx.checkpoint`, `ctx.resumeState`, `ctx.cancelled`).

## Flow of a run
1. `FLOW_CALL` (home, grant `flow`) → `createFlowRun` (core) → `FlowRun` persisted in `storage.session` → `chrome.alarms`
   timeout `wwa-flow:<runId>` (default 120 s) → returns `{runId}` immediately.
2. `open`: reuse a tab matching the part's patterns (≠ home tab; prefer `openUrl` prefix) or `tabs.create(openUrl ?? entryUrl)`;
   focus it when `activate`. `openUrl` must match the part's approved patterns.
3. `injectWhenReady`: poll `tabs.get` until `status:complete` on an allowed URL + content `WWA_PING` → `userScripts.execute`
   of `buildPartSource(...)` in world `<widgetId>#<role>` with `FLOW_INVOCATION {runId, handler, input, resumeState, n}` baked in.
4. `tabs.onUpdated complete` on the target while `stage:injected` → if the part world no longer holds this run
   (`globalThis.__wwaFlowHandled`; guards a late "complete" of the first load) → `navigated` → re-inject with `resumeState = checkpoint`.
5. `FLOW_RESULT` (sink, only from the target tab) → `succeeded` iff the handler returned `{ok:true}`; else `failed`.
   `tabs.onRemoved` (target) → failed "target tab was closed…"; (home) → cancelled. Alarm → failed "timed out".
   `FLOW_CANCEL` (home) / `CANCEL_FLOW_RUN` (panel) → cancelled; the sink's next `ctx.checkpoint` rejects.
6. Terminal → clear alarm, wake `FLOW_WAIT` long-polls, remove the progress pill, return focus to the home tab (if `activate`).

The home promise is a `FLOW_WAIT` long-poll loop (20 s slices) on the durable run, so it survives SW suspension.

## Messages
- user script → SW: `FLOW_CALL`, `FLOW_WAIT`, `FLOW_CANCEL` (home id), `FLOW_RESULT`, `FLOW_CHECKPOINT`, `FLOW_STATUS`
  (part id `<widgetId>#<role>`; `widgets.authorize` confines part ids to the PART's match patterns). All need grant `flow`.
- panel → SW: `GET_FLOW_RUNS`, `CANCEL_FLOW_RUN`. Broadcast: `FLOW_RUN_UPDATE`.

## Data owned
`storage.session` key `wwa_flow_runs` (active runs + last 30 finished, with event timeline). Alarms `wwa-flow:*`.

## Debug / test
`globalThis.__wwaFlow` in the SW (`store.list()`, `timings`). E2E: `tests/e2e/flow.spec.ts`. Unit: `packages/core/src/__tests__/flow.test.ts`.
No settings flag: inert unless an approved widget declares `parts` + grant `flow`.
