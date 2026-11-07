# modules/assist (Phase C — self-healing runtime, decision B)

Settings flag: `assist` (off → every WIDGET_ASSIST answers `stop` with source `disabled`; steps still check postconditions
and pre-generated code still runs, but the agent is never called).

**Purpose.** SW side of `WidgetAI.step` / `WidgetAI.run`: owns run timelines, enforces caps (`@app/core/assist`
`planAssist`: ≤2 recovery attempts per step invocation, ≤5 interventions per run, 300 s per run), asks the backend agent
(decide → create → one escalation), executes agent-written branches in the widget's `worldId` via
`userScripts.execute` with explicit JSON state in/out (`buildBranchSource` from `@app/widget-runtime`), builds the
final-failure narrative (`buildRunNarrative`) and turns successful agent branches into "add this branch?" offers.

**Messages handled**
- user script → SW: `WIDGET_ASSIST {report: StepFailureReport}` → `AssistAction {action: branch|new|stop, source, reason, branchId?, result?}`;
  `WIDGET_RUN_EVENT {runId, event}` → `{}` or `{narrative}` for `final-failure`.
- panel → SW: `GET_RUNS {widgetId?, limit?}` → `{runs}`; `LEARNED_BRANCH_DECISION {runId, step, accept}` → `{run, widget?}`.

**Emitted:** broadcast `RUN_UPDATED {run}`. Uses services `widgets.list`, `widgets.newVersion`, `settings.get`.
Backend: `POST /api/assist/decide`, `POST /api/assist/create` (`tier: create|escalate`).

**Data owned:** `chrome.storage.local['wwa_runs']` (last 30 `WidgetRun`s). In-memory caps per run.

**Safety:** agent code is re-validated (`checkGeneratedCode`) and statically reviewed (`reviewBranchCode`) in the SW
before it ever runs, even though the backend already did; the prelude's danger guard still blocks script clicks on
send/delete/… controls and asks the user (Allow/Block).

**Test:** `tests/e2e/runtime.spec.ts` (mock LLM: branch pick, new branch + learned version, cap → narrative, danger
guard), unit: `packages/core/src/__tests__/assist.test.ts`, `packages/widget-runtime/src/__tests__/step.test.ts`.
Live: `tests/tools/chaos-sweep.mjs` + `chaos-report.mjs`.
