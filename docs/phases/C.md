# Phase C — Self-healing branching runtime

## HANDOFF
- Status: **DONE** — decision B mechanics implemented end-to-end; mock E2E green (12/12 after merging nextgen); two
  20-run live chaos sweeps recorded (numbers below, as measured: task success 25% / 35%, final-failure 35% / 65%,
  0 emails sent or deleted — mediocre, main failure modes identified).
- Shared files edited (minimal): `background/bus.ts` (+`widgets.newVersion` service type), `modules/widgets/index.ts` +
  `service.ts` (`newVersion`), `panel/components/WidgetCards.tsx` (+1 import, +1 `<RunTimeline>` line),
  `generate/prompts/widget.mock.ts` (2 Phase C branches + import; data in new `widget.mockdata.steps.ts`),
  `widget-runtime/src/index.ts` (+1 export), `widget-runtime/package.json` (+`@app/core` dep), backend `config.ts` /
  `server.ts` / `llm/callModel.ts` (`LLM_MOCK_STAGES`, 5 lines), `AGENTS.md` (+3 lines), `fixtures/gmail2/app.js` (chaos).
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
- `npm run typecheck` → 0 errors. `npm run test:unit` (after merging nextgen) → core 56/0, widget-runtime 10/0, backend 33/0, extension 7/0 (106 passed, 0 failed). New: `packages/core/src/__tests__/assist.test.ts` (6: danger text + net classifier, ladder/caps, resolveDecision, reviewBranchCode, narrative), `packages/widget-runtime/src/__tests__/step.test.ts` (5: parse, local pass w/o agent, state identity, branch pick, new-branch state + stop→narrative), `apps/backend/src/modules/assist/assist.test.ts` (2: stages/models/mock decide+create+escalate, untrusted framing).
- `cd tests/e2e && E2E_PORT=8801 npx playwright test --reporter=line` → **12 passed** (1.1 min) after merging origin/nextgen (A, B, E): data 1, gmail2 1, net 1, record 2, runtime 4, spike-world 1, widget 1, youtube 1.
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

| metric | sweep 1 (13:57, widget `t_uw6ga7y7tqcy`) | sweep 2 (14:24, widget `t_pqbx5qhr6bmq`, after fixes) |
|---|---|---|
| intervention rate (runs with ≥1 agent intervention) | 60% (12/20) | 95% (19/20) |
| interventions per run (mean) | 1.55 | 1.90 |
| branch-choice accuracy (label heuristic: choice fits an active fault) | 55% (16/29) | 70% (21/30) |
| branch-choice effectiveness (chosen path fixed the step / correct stop) | 41% (12/29) | 40% (12/30) |
| new-branch success (agent-written branch fixed the step) | 83% (10/12) | 19% (4/21) |
| final-failure rate | 35% (7/20) | 65% (13/20) |
| false success ("completed" with the wrong number of drafts) | 40% (8/20) | 0% (0/20) |
| task success (expected drafts, 0 sent, 0 deleted) | 25% (5/20) | 35% (7/20) |
| emails sent / deleted | 0 / 0 | 0 / 0 |
| learned-branch offers | 10 | 4 |
| assist LLM calls (decide / create / escalate) | 48 (34 / 11 / 3) | 51 (30 / 13 / 8) |

  Reading the numbers (honest): each sweep is ONE live-generated widget (different Opus generations), so the two are
  not a controlled A/B. Sweep 1's widget accepted "no unread rows" as success → 8 slow-load runs "completed" with 0
  drafts and 0 interventions (false successes, which also flattered the intervention/failure rates); the 14:10
  positive-postcondition rule removed those (0/20) but sweep 2's widget encoded the fragile label in its postcondition
  (`open-message` expects "a Reply control is visible"), so under `renamed` the agent's branches clicked "Respond"
  correctly yet could never satisfy the postcondition → 10 of 13 sweep-2 failures are `renamed` seeds and new-branch
  success fell to 19%. popup: 4/5 healed by a Sonnet-written "dismiss dialog then open row" branch (after Haiku first
  picked a useless pre-generated branch); collapsed: healed by the pre-generated branch in sweep 2 (2/2 runs), by a
  new branch in sweep 1; empty inbox: Haiku correctly chose `stop` (4/4), still counted as failure; Haiku wrongly chose
  `stop` with a popup visible in 2 runs. Label "branch-choice accuracy" = choice is a branch whose `when`/id matches an
  active fault's keywords, `new` when no listed branch handles it, `stop` only for empty (heuristic, see
  `tests/tools/chaos-report.mjs`).
  Sample failure narratives (full text in `docs/evidence/C/sweep{1,2}/chaos-sweep.md`): sweep 1 seed 3 (collapsed+renamed,
  trace `t_uw6ga7y7tqcy`, calls `llm_j17cv3zbllkz…`): Haiku `new` → Sonnet "click-respond-link-open-composer" (did not
  fix: composer collapsed) → Opus "expand-collapsed-composer-after-respond" fixed email 1; email 2 (pre-family-reuse)
  burned attempts on `click-reply-again`/`keyboard-r` → "Why it broke: step "open-reply-2" never reached its
  postcondition (reply composer is editable); last observed: no editable reply composer… Stopped because: cap: 2
  recovery attempts". Sweep 2 seed 3 (trace `t_pqbx5qhr6bmq`, calls `llm_ai83o1gki438 llm_vnl6kvce83a9 llm_9t4a3sbp6ff9`):
  "step "open-message-1" never reached its postcondition (a Reply control is visible…); Agent's last diagnosis: the
  previous branch only checked that some message was open with a Respond link…". Sweep 2 seed 10 (popup): "Agent's last
  diagnosis: … a "Try the new HardMail" dialog covers the page … so a new path would ne[ed]… Stopped because: agent
  stopped" (decider stopped instead of `new`).

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

## Revisit (sweep 3)

Branch `phase-c2` (from `nextgen`), one bounded pass on live recovery quality, re-measured with ONE 20-run live sweep
(15:29–15:42 PST, widget `t_yvov9irx7olb`, evidence `docs/evidence/C/sweep3/`).

**What changed and why** (safety unchanged: danger guard, ≤2 attempts per step invocation, ≤5 interventions per run,
static branch review, draft-only all as before):
- Generator steps section (`apps/backend/src/modules/generate/prompts/sections/steps.ts`): postconditions must check the
  EFFECT of a step (message view open, editable composer visible, drafts counter/toast, row state, dialog gone), never
  the wording of the control that was clicked (sweep 2: 10/13 failures were `renamed` seeds whose `expect` demanded a
  visible "Reply" control, unsatisfiable after a correct "Respond" click); prefer role/structure/attributes over text,
  synonym regexes when text is needed; one "popup/dialog covers the page → dismiss with Not now/Close, redo" branch per
  fragile click step; how to accept an explicit empty state (`s.emptyState` set from an empty-state element).
- Decide prompt (`apps/backend/src/modules/assist/prompts/decide.ts`): priority rules — overlays first (pick the
  popup branch or `new`, NEVER `stop` because of an overlay; dismissing via Not now/Close is reversible, not a
  consequential action — sweep 2 seeds 4 and 10 stopped for exactly that reason); only pick a branch whose `when` is
  visibly true (no plausible-but-unrelated "click another cell"); renamed control → `new`; `stop` only for explicit
  empty / login wall / consequential / hostile.
- Create/escalate prompt (`prompts/create.ts`): "how to write a branch that works" — target the postcondition, clear
  overlays/expand collapsed sections first, locate controls by role + synonym, use real state values, waitFor the
  effect. Plus a new optional `stateShape` (contracts `AssistCreateRequest`, ≤1400 chars) built in the SW by
  `stateShapePreview` (`packages/core/src/assist.ts`: strings ≤60 chars, arrays ≤5, depth 4, ≤1200 chars) and framed
  as untrusted in the prompt — sweep 2 seed 6's Opus branch used the index `state.cur` as a message id
  ("No visible inbox row with data-legacy-message-id=0") because it only saw key names.
- Tests: core `stateShapePreview` (1), backend prompt contract (overlay rule, synonym guidance, state-shape framing) (1).
  Mocks unchanged (the mock decide/create contracts did not change; `stateShape` is optional).

| metric | sweep 1 | sweep 2 | sweep 3 (this revisit) |
|---|---|---|---|
| intervention rate (runs with ≥1 agent intervention) | 60% (12/20) | 95% (19/20) | 80% (16/20) |
| interventions per run (mean) | 1.55 | 1.90 | 1.45 |
| branch-choice accuracy (label heuristic) | 55% (16/29) | 70% (21/30) | 100% (29/29) |
| branch-choice effectiveness (fixed the step / correct stop) | 41% (12/29) | 40% (12/30) | 100% (29/29) |
| new-branch success (agent-written branch fixed the step) | 83% (10/12) | 19% (4/21) | n/a (0 create/escalate calls) |
| final-failure rate | 35% (7/20) | 65% (13/20) | 10% (2/20) |
| false success ("completed" with the wrong number of drafts) | 40% (8/20) | 0% (0/20) | 0% (0/20) |
| task success (expected drafts, 0 sent, 0 deleted) | 25% (5/20) | 35% (7/20) | **90% (18/20)** |
| emails sent / deleted | 0 / 0 | 0 / 0 | 0 / 0 |
| learned-branch offers | 10 | 4 | 0 |
| assist LLM calls (decide / create / escalate) | 48 (34 / 11 / 3) | 51 (30 / 13 / 8) | 29 (29 / 0 / 0) |

Reading the numbers (honest):
- Again ONE live-generated widget per sweep, so this is not a controlled A/B. Almost all of the gain comes from the
  generator change: the sweep-3 widget matches the reply control with `/\b(reply|respond|answer)\b/i` and checks
  `open-message` by "subject heading visible / list row gone", so none of the 10 `renamed` seeds needed the agent for the rename
  (seeds 11/14/18: 0 interventions), and it shipped a `dismiss-overlay` branch on every click step and an
  `expand-collapsed-stub` branch, which Haiku picked correctly every time (popup 7/7, collapsed 20/20 step-level picks).
- The create/escalate path was never exercised (0 calls), so the create-prompt rewrite and `stateShape` are NOT
  measured live by this sweep (unit-tested only); "new-branch success" is n/a, not an improvement.
- Both failures are `empty` seeds (7, 19): the widget's `collect-unread` expect only accepts `noUnread` when rows exist,
  so the explicit "Your inbox is empty" state never satisfies it; Haiku correctly chose `stop` (citing the role=status
  empty state) and the run is reported failed with a correct narrative. The prompt now shows the empty-state pattern but
  this generation did not follow it. Follow-up idea (not done, would change the ladder contract): a decide outcome
  "nothing-to-do" that ends the run as completed-with-0 when the DOM shows an explicit empty state.
- `collapsed` still costs one intervention per email (the scripted path never expands the stub itself), so runs with
  collapsed+popup use 3 of the 5 run interventions.
