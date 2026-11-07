# Devin orchestration — next-gen build (autonomous, no human stops)

Spec (WHAT to build): `docs/next-gen-architecture.md`.
This file: WHO builds it, in WHAT ORDER, how each phase is **proven correct before the next starts**, how progress is
reported in `docs/PROGRESS.md`, and how to avoid getting stuck.

---

## Coordinator prompt (paste THIS into one Devin session)

> You are the autonomous coordinator for building the next-gen version of github.com/Jeff15321/neohacks.
> Read `AGENTS.md`, `docs/next-gen-architecture.md` and `docs/devin-orchestration.md` completely; follow
> `docs/devin-orchestration.md` exactly. The human will NOT be available: do not stop to ask questions. Make the
> reasonable call, record it under "Decisions" in `docs/PROGRESS.md`, and keep going.
>
> 1. Create branch `nextgen` from `mvp`, tag `mvp` as `mvp-final`, create `docs/PROGRESS.md` from the template in
>    this file, commit and push it immediately.
> 2. Execute the phases in "Phase order & gates". If you can start child Devin sessions, give each one its task prompt
>    verbatim plus "Rules for every session" (max 4 in parallel; parallelism only where the table allows it). Otherwise,
>    do the tasks yourself, in order.
> 3. You are the integrator. A phase is DONE only when its **gate** passes on `nextgen` after merge, with evidence written
>    into `docs/PROGRESS.md`. Never start a phase whose dependencies' gates have not passed.
> 4. Update and push `docs/PROGRESS.md` at least every hour and at every phase start, merge, gate result, or stuck event.
> 5. Follow "Stuck protocol" and "Context hygiene". Never loop on one problem; descope, document, and move on.
> 6. Never weaken safety rules (draft-only, danger guard, no consequential actions) or delete/skip tests to pass a gate.
> 7. When all phases are done or time runs out, write the "Final summary" section of `docs/PROGRESS.md`.

---

## Rules for every session
- Read `AGENTS.md` + `docs/next-gen-architecture.md` (esp. "NOTE TO IMPLEMENTERS": NEW codebase, MVP on `mvp-final` is
  reference only, port behaviour, don't grow its structure; and "Codebase organization").
- Own branch from `nextgen` → PR into `nextgen`. Never merge your own PR; the coordinator merges.
- Edit only the paths your task owns. Minimal, called-out changes to shared files (`packages/contracts`, `bus.ts`, panel shell).
- Before opening the PR, run the phase gate yourself and paste the evidence (see "Evidence format") in the PR.
- Tests use `LLM_PROVIDER=mock`. Live checks use `ANTHROPIC_API_KEY` through `tests/tools/*`.
- Honest reporting only. A failing number is reported as failing.

## Phase order & gates
Priority order (if time runs out, earlier rows matter more): **0 → C → B → A → D → E → F**.

| Phase | Task | Depends on | Can run in parallel with | Gate (all must pass on `nextgen` after merge) |
|---|---|---|---|---|
| 0 | Foundation: new skeleton + port MVP | — | — | typecheck; all unit tests; **ported E2E specs green** (widget, gmail2, youtube, net); 1 live generation on fixtures/gmail2 succeeds; every module has a README; bus log + `llm_calls` log visibly populated in a test |
| C | Self-healing branching runtime | 0 | B, A, E | `runtime.spec.ts` green (branch pick, new branch, cap → failure narrative, danger guard blocks a "Delete" click); **20-run live chaos sweep** recorded; no regression in Phase 0 specs |
| B | Steps + recording + Record/Inspector UI + trace harness | 0 | C, A, E | `record.spec.ts` green (Demo 1 with mock); Step unit tests (settle, redaction, locators); ≥3/5 live first-try Demo-1 runs; Inspector shows Steps + LLM calls + bus log; Export debug bundle produces a valid JSON; E1/E2/E9 results recorded |
| A | User data store | 0 | C, B, E | `data.spec.ts` green; store unit tests (CRUD, user isolation, limits) |
| E | Network upgrades | 0 | C, B, A | extended `net.spec.ts` green (rotating CSRF → `verified`); core op-analysis unit tests |
| D | Activity model + suggestions + jobs | B (+C for codegen) | F | `suggest.spec.ts` green (suggest after 2nd completion, not 1st; dismiss suppresses); trace-eval: ≥8/10 pattern accuracy, 0 suggestions on noise traces; E3/E4/E10 recorded |
| F | Cross-site flows | B, C | D | `flow.spec.ts` green (issue → ticket, closing target tab → clean failure); E5/E7 recorded |

**Regression rule:** every gate also re-runs ALL previously-passing E2E specs. A phase that breaks an earlier phase is not done.
**Merge rule:** merge → run full suite on `nextgen` → if red, fix within the stuck-protocol budget or revert the merge.

## `docs/PROGRESS.md` template (create at start, keep updated)
```markdown
# Next-gen build progress
_Last updated: <ISO time> by <session>_

## Status board
| Phase | Status (not started / in progress / gate running / DONE / DONE-DEGRADED / blocked) | Branch/PR | Gate result | Updated |
|---|---|---|---|---|

## Now working on
- <session>: <phase> — <current sub-task>, next: <next sub-task>

## Up next
- <phases in order, with what each will implement>

## Phase reports
### Phase <X> — <name> — <DONE | DONE-DEGRADED>
**Implemented:** bullet list mapped to architecture-doc sections (e.g. "§1.2 settle machine → packages/core/src/settle.ts").
**Not implemented / descoped:** what and why (link stuck note).
**Evidence the phase is correct:**
- Commands run + exact pass/fail counts (typecheck, unit, each E2E spec).
- Key assertions proven (e.g. "record.spec: 3 drafts created, 0 sent").
- Live-run results (n/N, with LLM-call trace ids).
- Metrics (chaos sweep table, trace-eval scores, experiment results).
- Artifacts: paths to screenshots / Playwright traces / exported debug bundles committed under `docs/evidence/<phase>/`.
**How to verify it yourself (≤5 min):** exact commands + what you should see.
**Known issues:** …

## Decisions (made without the human)
- <time> <decision> — <reason> — <alternative rejected>

## Stuck log
- <time> <phase> <problem> — attempts — outcome (fixed / descoped / deferred)

## Final summary
(Written at the end: what's done, what's degraded, what's missing, top 3 risks, manual-test checklist for the human:
real Gmail demo, physical keyboard shortcut, real-site runs.)
```

## Evidence format (required in PRs and phase reports)
Paste real command output summaries, not claims: `npm run typecheck → 0 errors`, `unit: 42 passed / 0 failed`,
`record.spec.ts: 1 passed (23.4s)`. Commit Playwright traces/screenshots for each new E2E spec and at least one exported
debug bundle per feature under `docs/evidence/<phase>/`. Keep files small (<5 MB total per phase).

## Stuck protocol (prevents infinite loops)
- **Budget:** at most **3 distinct approaches** or **90 minutes** on one problem, whichever comes first.
- When the budget runs out:
  1. Write a stuck note in `docs/PROGRESS.md` → "Stuck log": symptom, what was tried, evidence, best hypothesis.
  2. **Descope, don't stall:** put the failing capability behind a settings flag (off), mark it in the phase report as
     DONE-DEGRADED with the reason, keep the gate's remaining checks green, and move on.
  3. If the failure blocks the gate itself (core of the phase), simplify the approach to the smallest version that meets
     the gate (e.g. fewer branch types, foreground-only flows), record it under "Decisions", and continue.
- A problem may be revisited once at the end if time remains.
- Self-healing runtime (C) is the highest-risk phase: report its chaos numbers as they are, even if poor.

## Context hygiene (keep each session effective)
- **One session = one phase.** The coordinator should start a fresh child session per phase (and per big sub-task if a
  phase drags) rather than doing everything in one long session.
- **State lives in files, not memory:** `docs/PROGRESS.md` (status), the PR description (what this branch did),
  and a `HANDOFF.md` section at the top of the phase's PR, updated before any long operation. A fresh session must be able
  to continue from these alone.
- **Small outputs:** run single specs (`npx playwright test record.spec.ts`), use `--reporter=line`, grep for failures,
  `tail -50` logs. Never dump full DOM, full traces, or full LLM transcripts into the conversation; write them to files and
  read only the relevant lines.
- **Read narrowly:** open only the files the task owns plus the contracts it uses; use `git show mvp-final:<path>` for
  specific MVP references instead of reading the whole MVP.
- **Restart rule:** if a session has been working on one phase for 3+ hours, or keeps re-reading the same files, it updates
  `HANDOFF.md` + `PROGRESS.md` and the coordinator starts a fresh session from them.

---

## Task prompts (one per session)

### Phase 0 — Foundation
> Build the new codebase skeleton on a branch from `nextgen`, per "NOTE TO IMPLEMENTERS" and "Codebase organization"
> in `docs/next-gen-architecture.md`. No new product features.
> - `packages/contracts` (zod schemas + types for all boundaries and LLM outputs: steps, activity, workflow,
>   runtime/assist, data, flow, jobs, plus the MVP's existing messages); `packages/core` (module stubs + test setup);
>   `packages/widget-runtime` (port the MVP prelude from `git show mvp-final:apps/extension/src/runtime/widgetSource.ts`).
> - Extension: `background/main.ts`, typed `bus.ts` (validate → route → log ring buffer), `platform/` wrappers over
>   chrome.*, module stubs with README (widgets, observe, record, net, flow, jobs, data, assist), `content/`, `page/`,
>   panel tab shell (Create, Widgets, Record, Inspector, Activity, Data) with Tailwind v4 + shadcn/ui built by esbuild.
> - Backend: `server.ts`, plugins (auth token + `x-user-id`, traceId, errors), `llm/callModel` (stage-named; logs every call
>   to sqlite `llm_calls` via `node:sqlite`; providers anthropic + mock), module stubs with README.
> - Model migration: no `temperature`; structured outputs (`output_config.format`), `effort`, streaming for generation;
>   defaults `claude-opus-5-5` (generation), `claude-sonnet-5-5` (inference), `claude-haiku-5-5` (fast stages); env-configurable.
> - Port the MVP's working features (table in the NOTE): widget generate/validate/approve/run/register/edit/repair,
>   inference, network capture + replay (with the probe security fixes in doc §4 item 1), PageContext. Move fixtures
>   under `fixtures/`; port E2E specs widget, gmail2, youtube, net.
> - Gitignore `.pw-profile`, `.demo-profile`, `test-results`, `.data/` and untrack them.
> - Gate: see table.

### Phase C — Self-healing branching runtime (HIGH RISK, never built before)
> Implement decision B: `WidgetAI.step` with `expect` postconditions (script-first; agent only on failure or `multiOutcome`),
> 2–3 generated branches per fragile step, `WidgetAI.assist` (Haiku 5.5 picks a branch → Sonnet 5.5 writes a new JS branch →
> one Opus 5.5 attempt), caps, runtime danger guard with in-page Allow/Block, final-failure narrative, "add this
> branch?" → new widget version. Spike first: re-execution in the same `worldId` with JSON state handoff. Add chaos mode to
> `fixtures/gmail2`. Owned: runtime parts of `packages/widget-runtime`, danger classifier in `packages/core`, extension
> `modules/assist`, backend `modules/assist`, generator prompt sections for steps/branches, `content/overlay` danger
> confirm, `tests/e2e/runtime.spec.ts`. Record a 20-run live chaos sweep: intervention rate, branch-choice accuracy,
> new-branch success, final-failure rate, sample failure narratives.

### Phase B — Steps + recording + Record/Inspector UI + trace harness
> Implement doc §1.2 (Steps, settle — logic in `packages/core`), §3 (recording, WorkflowSpec, generation conditioned on
> spec), decision A (REC badge + in-page pill, live Step timeline in `tabs/Record`, `tabs/Inspector` with LLM-call log,
> bus log, Export debug bundle), Tier-1 Step Interpreter, trace-replay eval harness (`tests/traces/`,
> `tests/tools/trace-eval.mjs`). Owned: `content/steps`, `content/overlay` (REC pill), extension `modules/observe` +
> `modules/record`, backend `modules/recordings` + step-interpret stage, `tabs/Record`, `tabs/Inspector`,
> `tests/e2e/record.spec.ts`. Run E1, E2, E9.

### Phase A — User data store
> Implement "User data store endpoint (`WidgetAI.db`)" from the architecture doc on the new layout (backend `modules/data`
> + `store/` table, extension `modules/data`, `WidgetAI.db` in `widget-runtime`, `tabs/Data`, prompt file in
> `modules/generate/prompts/`). Owned: those paths + `fixtures/movies/` + `tests/e2e/data.spec.ts`.

### Phase E — Network upgrades
> Implement doc §4 items 2–5 (Step attribution, webRequest cross-check, route templates/token fields/dependency inference in
> `packages/core`, verification tiers + `reportVerified`, generator strategy rule). Owned: `page/netprobe`, extension
> `modules/net`, net prompt section, `tests/e2e/net.spec.ts`.

### Phase D — Activity model + proactive suggestions + background jobs
> Implement doc §1.4–1.6 (Tier-2 activity model with patch-op reducer in `packages/core`, reconsolidation, Tier-3 Judge),
> backend `modules/jobs` (start/long-poll/cancel), in-page suggestion card, `tabs/Activity`, hypothesis/pattern views in the
> Inspector. Owned: backend `modules/observe` (activity parts) + `modules/jobs`, extension `modules/jobs`, `tabs/Activity`,
> `tests/e2e/suggest.spec.ts`. Run E3, E4, E10.

### Phase F — Cross-site flows
> Implement doc §5 (bundle parts, `WidgetAI.flow`, coordinator with durable runs, checkpoints, alarms, cancellation),
> cross-tab recording with lineage, fixtures `fixtures/issues` (127.0.0.1) + `fixtures/tracker` (localhost). Owned:
> extension `modules/flow`, flow parts of `widget-runtime`, bundle validation, `tests/e2e/flow.spec.ts`. Run E5, E7.

## Before handing off (human)
1. Commit and push `docs/next-gen-architecture.md`, this file, and the in-progress network work to GitHub. Devin only sees the repo.
2. Add `ANTHROPIC_API_KEY` as a Devin secret.
3. Paste the **Coordinator prompt** into one Devin session. Check `docs/PROGRESS.md` on the `nextgen` branch any time.
