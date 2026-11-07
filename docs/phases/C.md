# Phase C — Self-healing branching runtime

## HANDOFF
- Status: **DONE** — decision B mechanics implemented end-to-end; mock E2E green; two 20-run live chaos sweeps recorded
  (numbers below, reported as measured — they are mediocre and the main failure modes are understood).
- What's done: `WidgetAI.run/step` with `expect` postconditions + pre-generated branches; `WidgetAI.assist` ladder
  (Haiku decide → Sonnet new branch executed in the same worldId with JSON state → one Opus escalation → stop) with caps;
  run timeline + final-failure narrative (widget, panel, bus); learned branches → new widget version; runtime danger
  guard (script click/submit/Enter + WidgetAI.net DELETE/send-like) with in-page Allow/Block; chaos mode in gmail2.
- Next (suggested): see "Known issues" — (1) generation `max_tokens` 32k is hit by Opus at effort high with the new
  steps section in ~50% of first attempts (retry succeeds); (2) weak generated postconditions cause false successes;
  (3) Inspector tab could render `RUN_UPDATED` runs (Phase B owns the tab).
- How to continue: mock: `cd tests/e2e && E2E_PORT=8801 npx playwright test runtime.spec.ts --reporter=line`.
  Live: backend `BACKEND_PORT=8801 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/nx-c.db npm run start -w apps/backend`,
  `BACKEND_URL=http://127.0.0.1:8801 npm run build`, `cd tests/tools && E2E_PORT=8801 RUNS=20 OUT=../../docs/evidence/C/sweepN npx tsx chaos-sweep.mjs`,
  then `node chaos-report.mjs ../../docs/evidence/C/sweepN`.

## Decisions
- 13:10 — Spike (`tests/e2e/spike-world.spec.ts`, kept as a regression spec): `chrome.userScripts.execute` awaits a
  returned promise and returns its JSON value; a second execute into the SAME `worldId` sees the first's globals,
  another worldId does not; a rejected promise yields `result: null` with no error. → Agent branches run as
  `(async (state, h) => {…})(<json>, helpers)` and always resolve to `{ok, state?, error?}` (`buildBranchSource`).
- 13:12 — Recovery ladder per step invocation: attempt 1 = decide (fast) → pre-generated branch | `new` (inference
  model writes a branch) | `stop`; attempt 2 = decide again if attempt 1 ran a pre-generated branch, or the ONE
  escalation (generation model) if attempt 1 was an agent-written branch; then stop. Caps are enforced in the SW
  (`@app/core/assist` `planAssist`), not trusted to the prelude: ≤2 attempts per step invocation, ≤5 interventions per
  run, 300 s per run. "Per step" = per invocation (a step like `open-reply` runs once per email) — the run-wide cap
  still bounds total agent use.
- 13:12 — "Quick safety review" of agent branches is deterministic + static (`reviewBranchCode`: `checkGeneratedCode`
  denylist + acorn, no form.submit/requestSubmit/WidgetAI/prelude internals/site storage/navigation, no string/regex
  literal naming a consequential control) on the backend AND again in the SW before execution — no extra LLM call
  (latency; deterministic; unit-tested). The runtime danger guard is the second line of defence.
- 13:14 — Danger-guard Allow/Block confirm is rendered by the prelude (user-script world, shadow DOM) instead of
  `content/overlay`: the guard must block synchronously inside the capture-phase listener in the widget's world; the
  confirm only accepts `isTrusted` clicks, so page scripts cannot press Allow. mouse/pointer down/up on a dangerous
  control are blocked silently; click/submit/Enter raise the confirm; Allow re-dispatches once.
- 13:15 — Learned branches are spliced into the widget as `WidgetAI.addBranch(step, {id, when, run})` prepended to the
  code (that snippet is the diff shown in the panel) → `widgets.newVersion` service → new unapproved version.
  Within a run, an agent branch that fixed a step is re-used (no LLM call) for the next invocation of the same step
  family (`open-reply-1` → `open-reply-2`, 14:10 after sweep 1 showed per-index step names defeated re-use).
- 13:16 — Run timeline owned by the SW assist module (`wwa_runs`, last 30 runs). Prelude events are fire-and-forget
  `WIDGET_RUN_EVENT`; agent events (decide/create/escalate/cap) are recorded by the SW. The Inspector sees them via the
  bus log (WIDGET_ASSIST / WIDGET_RUN_EVENT) + `RUN_UPDATED` broadcasts; the panel renders them per widget
  (`panel/components/RunTimeline.tsx`). Inspector tab not edited (Phase B owns it).
- 13:20 — Chaos `popup` = interstitial that swallows the first email open (a load-time modal also covered the widget's
  own toolbar button). Any `?chaos=` value adds a "Delete" button to the message view (danger-guard target); plain
  `/fixture-g2/` is unchanged (gmail2.spec passes). Numeric seeds pick faults with a seeded PRNG (10 % empty inbox,
  otherwise each of collapsed/popup/renamed/slow with p=0.4, at least one); `window.__chaos` = ground truth.
- 13:40 — Live sweep uses ONE live-generated widget (Opus, generated on `?chaos=none`) run against 20 seeds, rather
  than 20 generations (each takes 4–8 min). `LLM_MOCK_STAGES` (backend env, comma list of stages forced onto their
  mock) added for single-stage live evals; not used in the reported sweeps.
- 13:48 — Run state keeps identity: `WidgetAI.run` hands the live state object to the callback and steps update its
  contents in place (`__adopt`), so `state.x = …` between steps survives (sweep-1 pilot: Opus-written widget mutated
  state between steps and lost it). Agent branches still get/return explicit JSON.
- 13:48 — DOM evidence always appends visible overlays outside the step's `region` (dialogs / aria-modal / fixed
  high-z layers): pilot showed the decider never saw the popup because the step region was `[role=main]`.
- 14:10 — Generator steps section now requires postconditions that POSITIVELY confirm success (sweep 1: 8/20 runs
  "completed" with 0 drafts because `expect` accepted "no unread rows" while the inbox was still loading).

## Stuck log
(none — no problem exceeded 3 approaches / 90 min)

## Phase report

**Implemented** (mapped to `docs/next-gen-architecture.md` → DECISIONS ADDED → B):
- "Script-first, agent-on-failure" + "Platform API (prelude)" → `packages/widget-runtime/src/sections/step.ts`
  (`WidgetAI.run`, `WidgetAI.step(name, {goal, run, expect, branches, multiOutcome, region, timeoutMs, state})`,
  `WidgetAI.addBranch`, `WidgetAI.helpers`), `sections/helpers.ts` (`h` library shared by prelude and agent branches,
  `buildBranchSource`). Postcondition kinds: exists, gone, count, text match, textChanged, net op 2xx (via
  `WIDGET_NET_OPS`), custom check. Re-check before re-acting. multiOutcome steps ask the decider first.
- "WidgetAI.assist 1–3" → SW `apps/extension/src/background/modules/assist/` (ladder, caps, execution in the widget
  worldId with JSON state, learned-branch re-use) + backend `apps/backend/src/modules/assist/` (`/api/assist/decide`
  stage `assist.decide` = `cfg.models.fast`; `/api/assist/create` stage `assist.create` = `cfg.models.inference`,
  `assist.escalate` = `cfg.models.generation`; prompts one file each + deterministic mocks; page text framed as
  `<untrusted_dom>`). Pure logic in `packages/core/src/assist.ts` (planAssist, resolveDecision, reviewBranchCode,
  buildRunNarrative, learnedBranchSnippet, stepFamily).
- "Caps" → ≤2 attempts per step invocation, ≤5 interventions per run, 300 s run timeout (`ASSIST_LIMITS` in contracts),
  enforced in the SW; `assist` settings flag off → `stop` (source `disabled`).
- "Final failure report" → `buildRunNarrative` (every step, postcondition expected/observed, branch tried, agent
  decision + reason + model tier, DOM evidence, why) shown in-page (`#wwa-run-report`), in the panel
  (`RunTimeline` → `run-narrative`), and on the bus (`WIDGET_RUN_EVENT`/`RUN_UPDATED`, Inspector bus log).
- "Learned branches" → "The agent fixed step X: add this branch to the widget?" card with the `+` diff →
  `LEARNED_BRANCH_DECISION` → `widgets.newVersion` (new unapproved version; approval card shows the change summary).
- "Generator prompt" → `apps/backend/src/modules/generate/prompts/sections/steps.ts` (run/step contract, expect kinds,
  2–3 branches per fragile step, idempotence, positive postconditions, per-item step names, no consequential steps).
- "Danger guard" → capture-phase window listener in the prelude for script-originated (`!isTrusted`)
  click/submit/Enter (+ silent mouse/pointer down/up) on controls whose label matches `@app/core/danger`
  (`classifyDangerText`), and `WidgetAI.net.invoke/request` DELETE or send-like routes (`classifyNetRequest`) → in-page
  Allow/Block (trusted clicks only), `danger-blocked` / `danger-allowed` timeline events.
- "Testing" → chaos mode `fixtures/gmail2/?chaos=<seed|names>` (collapsed composer, interstitial popup, renamed
  Reply→Respond, slow load, empty inbox); `tests/e2e/runtime.spec.ts`; live `tests/tools/chaos-sweep.mjs` +
  `chaos-report.mjs`. "Spike first" → `tests/e2e/spike-world.spec.ts`.
- Contracts: `packages/contracts/src/runtime.ts` (ASSIST_LIMITS, StepFailureReport, Assist* requests/responses,
  AssistAction, RunTimelineEvent kinds, LearnedBranch, WidgetRun), `messages/assist.ts` (WIDGET_ASSIST,
  WIDGET_RUN_EVENT, GET_RUNS, LEARNED_BRANCH_DECISION, RUN_UPDATED) — validated by the bus.

**Not implemented / descoped:** LLM-based safety review of agent branches (static review instead, see Decisions).
Danger confirm lives in the prelude, not `content/overlay`. `form.submit()` (no event) cannot be intercepted at runtime —
it is rejected statically for agent branches only. No Inspector-tab view of runs (bus log only). The net-guard path
(`WidgetAI.net` DELETE / send-like) is unit-tested via the classifier but has no E2E.

**Evidence:**
- `npm run typecheck` → 0 errors. `npm run test:unit` → core 30/0, widget-runtime 7/0, backend 11/0, extension 4/0.
- `cd tests/e2e && E2E_PORT=8801 npx playwright test --reporter=line` → FULL_E2E_RESULT.
- runtime.spec key assertions (mock LLM): **branch pick** — popup: exactly 1 `assist-decide` choosing `dismiss-popup`,
  branch-result ok, no `assist-create`, 1 intervention, 2 drafts / 0 sent, bus log has ok `WIDGET_ASSIST`.
  **new branch** — renamed: 1 `assist-create` (`click-respond`, executed via SW in the widget worldId), email 2 re-used it
  (`source: learned`), learned offer with `+ WidgetAI.addBranch("open-reply"` diff → accept → v2 approval card "Added
  agent-learned branch"; v2 run on the renamed page: decide picks `click-respond`, no create. **cap → failure** — empty
  inbox: expect-fail → decide `new` → create → escalate → `cap` "2 recovery attempts for step find-unread" →
  narrative (steps, decisions, "Why it broke…", DOM evidence "Your inbox is empty") in page + panel; 2 interventions,
  0 drafts. **danger guard** — script click on "Delete": confirm shown, `__deleted` stays 0 before and after Block, still
  on the message, `danger-blocked` event (label Delete, what click), no `danger-allowed`.
- Live chaos sweeps (Anthropic; 20 seeds each; danger confirms always answered Block) — `docs/evidence/C/sweep{1,2}/`
  (`chaos-sweep.md` table + narratives + per-run llm call ids, `sweep-results.json` full timelines, `sweep-llm-calls.json`,
  `sweep-widget.js` the live-generated widget):

SWEEP_TABLE

- Live generation with the steps section (4 Opus generations today): first attempt hit `max_tokens` 32 000 in 2/4
  (265–268 s, truncated JSON) and parsed after the built-in retry (158–187 s); 2/4 parsed first try (232 s, 6–7 min
  worst case end-to-end). The generated widgets used `WidgetAI.run` + 6 steps, ~15 branches, `expect` on every step.

**How to verify (≤5 min):** `npm run typecheck && npm run test:unit`, then
`cd tests/e2e && E2E_PORT=8801 npx playwright test runtime.spec.ts --reporter=line` (4 passed, ~40 s) and open
`docs/evidence/C/sweep2/chaos-sweep.md`.

**Known issues:**
- Live generation: Opus at effort `high` + the steps section exceeds the 32k `max_tokens` in ~half of first attempts
  (`modules/generate/service.ts`, not mine) → retry → 6–8 min. Suggest `maxTokens` 48–64k with a longer timeout, or
  effort `medium`, or trimming branch bloat.
- Generated postconditions can be too weak (false "completed"), and pre-generated branches are often right in intent
  but wrong in code (decider picks `expand-collapsed-stub`, the branch's selector misses the fixture's stub) — the
  runtime can only heal what `expect` catches.
- Decider sometimes picks a plausible-but-useless pre-generated branch (`click-reply-again`, `keyboard-r`) for a renamed
  control instead of `new`, burning the attempt; escalation then fixes it ~sometimes.
- `WIDGET_ASSIST` / run events carry the widget's injection traceId (generation trace for registered scripts), so live
  runs share one traceId; the sweep attributes llm calls to runs by time window.
- Chromium `userScripts.execute` swallows rejections (spike) — handled by the wrapper, but a branch that never settles
  is only bounded by the run timeout.
