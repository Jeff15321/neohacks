# Next-gen build progress
_Last updated: 2026-11-07 13:10 PST by coordinator (local Devin CLI session)_

## Status board
| Phase | Status (not started / in progress / gate running / DONE / DONE-DEGRADED / blocked) | Branch/PR | Gate result | Updated |
|---|---|---|---|---|
| 0 Foundation | DONE | `nextgen` (coordinator, direct) | PASS — typecheck 0 errors; unit 39/39; E2E 4/4; live gmail2 1/1 | 13:10 |
| C Self-healing runtime | in progress | `phase-c` (subagent) | — | 13:10 |
| B Steps + recording + Inspector | in progress | `phase-b` (subagent) | — | 13:10 |
| A User data store | in progress | `phase-a` (subagent) | — | 13:10 |
| E Network upgrades | in progress | `phase-e` (subagent) | — | 13:10 |
| D Activity + suggestions + jobs | not started (needs B) | — | — | — |
| F Cross-site flows | not started (needs B, C) | — | — | — |

## Now working on
- coordinator: integrating C ∥ B ∥ A ∥ E (4 subagents, one git worktree + E2E_PORT each: C 8801, B 8802, A 8803, E 8804)

## Up next
- C: WidgetAI.step/expect/branches, assist (Haiku→Sonnet→Opus), caps, danger guard, failure narrative, learned branches, gmail2 chaos mode, runtime.spec, 20-run live chaos sweep.
- B: Steps (settle/locators/redaction), recording session + REC indicators, WorkflowSpec interpreter, spec-conditioned generation, Record + Inspector tabs, debug bundle export, trace harness, record.spec, E1/E2/E9.
- A: /api/data store (node:sqlite), WidgetAI.db, Data tab, movies fixture, data.spec.
- E: Step attribution, webRequest cross-check upgrades, op analysis (templates/tokens/deps), verification tiers + reportVerified, strategy rule, rotating-CSRF net.spec.
- Then D ∥ F once B (and C for F) gates pass.

## Phase reports
### Phase 0 — Foundation — DONE
**Implemented** (mapped to `docs/next-gen-architecture.md`):
- "Codebase organization / Layout" → `packages/contracts` (zod schemas for every boundary + LLM output; messages split per domain `src/messages/<domain>.ts`; forward shapes for steps/activity/workflow/runtime/data/flow/jobs), `packages/core` (match patterns, replay builder, NetLog with webRequest confirmation, redaction, generated-code validator, ids/Ring; stubs for B/C/D/E/F logic), `packages/widget-runtime` (prelude ported from MVP `widgetSource.ts`, one file per section).
- Extension: `background/main.ts` (wiring only), `bus.ts` (zod-validate per boundary → owning module → ring-buffer log; in-SW service registry so modules never import each other), `platform/` (only chrome.* caller + backend client with `x-extension-token`/`x-user-id`/`x-trace-id`), modules `widgets` · `net` · `system` built; `observe` · `record` · `flow` · `jobs` · `data` · `assist` stubs with README; `content/` (netbridge in all frames, context, steps/, overlay/), `page/netprobe.ts`; panel tab shell Create · Widgets · Record · Inspector · Activity · Data with Tailwind v4 (`@tailwindcss/cli` in build.mjs) + shadcn-style components (Radix Tabs).
- Backend: `server.ts` (`buildApp` for `app.inject` tests), plugins (auth token + uuid `x-user-id`, traceId + JSON request log, uniform errors naming boundary + type), `llm/callModel` (stage-named; every call logged to sqlite `llm_calls` via `node:sqlite`; providers anthropic + per-prompt mock), `store/db.ts` (all tables, one owner each), modules `generate` · `inference` · `debug` (`GET /api/debug/llm-calls`) built; `assist` · `observe` · `recordings` · `jobs` · `data` stubs; every module has a README.
- §0 / §6 model migration → no `temperature`; `output_config.format` (structured outputs, `WIDGET_JSON_SCHEMA`) + `output_config.effort`; streamed generation with `finalMessage()`; refusal → error; `cache_control` on frozen system prompts; defaults `claude-opus-5-5` (generation), `claude-sonnet-5-5` (inference), `claude-haiku-5-5` (fast), env-configurable. SDK 0.65 → 1.3.0.
- NOTE port table → widget generate/validate/approve/run/register/edit/repair, inference, network capture + replay, PageContext; every MVP DOM/waiting/safety prompt rule kept verbatim; mock widgets/replies ported; fixtures moved to `fixtures/`; E2E specs widget, gmail2, youtube, net ported to the new panel.
- §4 item 1 security fixes → (a) probe posts to its own frame window only, `content.js` now `all_frames` relays per frame, replays top-frame only; (b) records `provenance:'page'`, `chrome.webRequest.onCompleted` cross-match (url+method, ±2 s) sets `confirmed`, only confirmed ops replayable (panel + widgets); (c) redaction of auth/cookie/x-*-token/csrf/xsrf headers, secret-named JSON/urlencoded fields and high-entropy tokens in every summary that leaves the SW.
- §7 approval card → plan ("What it will do"), sites, grants as sentences, consequential actions, collapsed code; Approve & install / Modify / Reject. Widgets tab: run, conversational edit (history sent to the generator, `changeSummary`), auto-fix, logs, version thread.
- Debuggability → traceId panel → SW → user script (`__TRACE`) → backend `x-trace-id` → `llm_calls.trace_id`; bus log + LLM-call log in the Inspector.
- Gitignore `.pw-profile`, `.demo-profile`, `test-results`, `.data/`, `.worktrees/` (none were tracked on `mvp-final`).
- Extra (for parallel phases): `E2E_PORT` (globalSetup rebuilds the extension for the port); probe `start` events + `netActivity` in-flight tracker in `content/netbridge` (for B's settle); one owned file per phase at every shared extension point (prompt sections, prelude sections, backend module routes, panel tabs, messages).

**Not implemented / descoped:** OpenAI provider dropped (doc: providers anthropic + mock). `fallbacks:"default"` refusal fallback not used (not in SDK 1.3 types) — refusal surfaces as an error. Widget cleanup still removes every `wwa-` root on the page (MVP behaviour).

**Evidence the phase is correct:**
- `npm run typecheck` → 0 errors (contracts, core, widget-runtime, extension, backend, e2e).
- `npm run test:unit` → core 24/0, widget-runtime 2/0, backend 9/0, extension 4/0 (39 passed, 0 failed).
- `cd tests/e2e && npx playwright test` → 4 passed (15.0s): widget, gmail2, youtube, net. `E2E_PORT=8811 … gmail2.spec.ts` → 1 passed.
- Key assertions: widget.spec — nothing injected before approval; 2 drafts, 0 sent; bus log has GENERATE_WIDGET/APPROVE_WIDGET/2× WIDGET_INFERENCE (userScript) with the approve traceId; `llm_calls` by traceId = `[generate.widget]` (parseOk, claude-opus-5-5) and `[inference, inference]`; Inspector shows both logs. net.spec — real POST confirmed + correlated to "Save draft"; a page-forged record shows `unconfirmed` and `NET_REPLAY` refuses it; replayed draft verified server-side, 0 sent.
- Live (Anthropic): `TARGET_URL=…/fixture-g2/index.html npx tsx tests/tools/live.mjs` → 1/1 first try: Opus 5.5 widget "AI Reply Drafts for Unread", 2 drafts (m1, m2), 0 sent, status completed. Generation trace `t_c5uq4ywgr6d2`: 152.8 s, 1325 in / 17 918 out tokens, parseOk. Inference calls (Sonnet 5.5, low) 1.5–2.1 s. Smoke: haiku/sonnet/opus 5.5 all accept `output_config` (format + effort).
- Artifacts: `docs/evidence/0/live-gmail2.log` (full run incl. generated code), `docs/evidence/0/live-llm-calls.json`, `docs/evidence/0/inspector.png`.

**How to verify it yourself (≤5 min):** `npm install && npm run typecheck && npm run test:unit && (cd tests/e2e && npx playwright test)` → 0 errors, 39 unit passes, 4 E2E passes. Live: `LLM_PROVIDER=anthropic npm run start -w apps/backend` then `cd tests/tools && TARGET_URL=http://127.0.0.1:8787/fixture-g2/index.html npx tsx live.mjs` (≈3 min) → `drafts:` with 2 entries, `sent: []`.

**Known issues:** live generation at effort `high` is slow (~2.5 min; mostly thinking tokens). Fastify prints a `disableRequestLogging` deprecation warning. SW bundle is ~1 MB unminified (zod + contracts).

## Decisions (made without the human)
- 11:35 — `nextgen` branched from `feat/network-observation` (89963a5), not `mvp`; `mvp-final` tag placed on 89963a5 — `mvp` lacks the netprobe window.fetch fallback commit; human approved this before leaving — rejected: branching from `mvp` exactly as the doc says.
- 11:35 — Child "Devin sessions" are local Devin CLI subagents (max 4 parallel), each in its own `git worktree` under `.worktrees/`; PRs via `gh` into `nextgen`, merged by the coordinator — the human runs Devin CLI locally.
- 11:35 — Phase 0 done by the coordinator directly (touches every path; splitting it would only create merge conflicts).
- 11:40 — Workspace packages are consumed as TypeScript source (`exports` → `src/*.ts`), no build step — removes stale-dist bugs across parallel worktrees — rejected: tsc-emitted `dist/` like the MVP's `packages/shared`.
- 11:50 — MVP env vars `LLM_GENERATION_MODEL`/`LLM_INFERENCE_MODEL` ignored; new `LLM_MODEL_GENERATION/INFERENCE/FAST` — the human's `.env` pins 4.5-era models, which would silently downgrade generation — rejected: honouring the old names.
- 12:05 — In-SW service registry (`bus.provide/use`) for module-to-module calls (page context, net ops, widget authorization, settings), logged as `internal` bus entries — Rules §2 forbids importing another module's internals — rejected: internal pseudo-messages through zod.
- 12:10 — Widgets need explicit approval before registration/execution, and every repaired/edited version needs approval again (MVP registered unapproved widgets) — safety.
- 12:15 — Approval card's "Modify" switches to the Widgets tab edit box rather than a separate thread view; Phase 2 "conversation per widget" is the Widgets-card thread + edit input — keeps one place to edit.
- 12:20 — `GET_LLM_CALLS` filter field named `filterTraceId` (every panel message carries an envelope `traceId`).
- 13:00 — Probe `start` events + `netActivity` tracker added in Phase 0 so Phase B never edits `page/netprobe.ts` (Phase E owns it).

## Stuck log
(none yet)

## Final summary
(Written at the end.)
