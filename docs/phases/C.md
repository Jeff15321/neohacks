# Phase C — Self-healing branching runtime

## HANDOFF
- Status: IN PROGRESS — mechanics done + E2E green (mock); live 20-run chaos sweep running (13:31).
- How to continue: `tests/tools/chaos-sweep.mjs` (live; needs backend on 8801 with LLM_PROVIDER=anthropic) writes
  `docs/evidence/C/sweep-results.json`; `node tests/tools/chaos-report.mjs` turns it into `docs/evidence/C/chaos-sweep.md`.
- Spike done (13:10): `tests/e2e/spike-world.spec.ts` — `chrome.userScripts.execute` awaits a returned promise and
  returns its JSON value; a second execute into the SAME `worldId` sees the first's globals; another worldId does not;
  a rejected promise yields `result: null` with no error → branch wrappers must catch and return `{ok:false,error}`.

## Decisions
- 13:10 — Branch code executed by the SW is wrapped as `(async (state, h) => {…})(<json>, helpers)` and always
  resolves to `{ok, state?, error?}` (spike: rejections are swallowed by userScripts.execute).
- 13:12 — Recovery ladder per step invocation: attempt 1 = decide (fast) → pre-generated branch | `new` (inference model
  writes a branch) | `stop`; attempt 2 = decide again if attempt 1 ran a pre-generated branch, or the ONE escalation
  (generation model) if attempt 1 was an agent-written branch; then stop. Caps enforced in the SW (`@app/core/assist`
  `planAssist`), not trusted to the prelude: ≤2 attempts per step invocation, ≤5 interventions per run, 300 s per run.
  "Per step" = per invocation (a step name like `open-reply` runs once per email) — otherwise email 2 would inherit
  email 1's attempts; the run-wide cap still bounds total agent use.
- 13:12 — "Quick safety review" of agent branches is deterministic + static (`reviewBranchCode` in core: denylist +
  acorn via `checkGeneratedCode`, no form.submit/requestSubmit/WidgetAI/prelude internals/storage/navigation, and no
  string/regex literal naming a consequential control) on the backend AND again in the SW before execution — no extra
  LLM call (latency; deterministic + unit-tested). The runtime danger guard is the second line of defence.
- 13:14 — Danger-guard Allow/Block confirm is rendered by the prelude (user-script world, shadow DOM) instead of
  `content/overlay`: the guard must block synchronously inside the capture-phase listener and lives in the same world
  as the widget; the confirm only accepts `isTrusted` clicks, so page scripts can't press Allow. Pointer/mouse down/up
  on a dangerous control are blocked silently, click/submit/Enter raise the confirm; Allow re-dispatches once.
- 13:15 — Learned branches are spliced into the widget code as `WidgetAI.addBranch(step, {id, when, run})` prepended
  to the code (the exact diff shown in the panel) → `widgets.newVersion` service → new unapproved version (approval
  required like every version). Within a run, an agent-written branch that fixed a step is re-used for the next
  invocation of that step before asking the LLM again.
- 13:16 — Run timeline is owned by the SW assist module (`wwa_runs`, last 30 runs); prelude events are fire-and-forget
  `WIDGET_RUN_EVENT`, the agent events (decide/create/escalate/cap) are recorded by the SW itself. Inspector sees it via
  the bus log (WIDGET_ASSIST / WIDGET_RUN_EVENT entries) + `RUN_UPDATED` broadcasts; the panel shows it per widget
  (`panel/components/RunTimeline.tsx`). I did not edit the Inspector tab (Phase B owns it).
- 13:20 — Chaos `popup` = interstitial that swallows the first email open (not on page load): a load-time modal also
  covered the widget's own toolbar button, so neither a user nor the test could start the widget.
- 13:20 — Chaos mode turns on a "Delete" button in the message view (any `?chaos=` value) so the danger guard can be
  tested on the fixture; plain `/fixture-g2/` is unchanged (gmail2.spec passes).

## Stuck log
(none)

## Phase report
(written at the end)
