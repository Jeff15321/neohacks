# Next-gen build progress
_Last updated: 2026-11-07 13:55 PST by coordinator (local Devin CLI session)_

## Status board
| Phase | Status (not started / in progress / gate running / DONE / DONE-DEGRADED / blocked) | Branch/PR | Gate result | Updated |
|---|---|---|---|---|
| 0 Foundation | DONE | `nextgen` (coordinator, direct) | PASS — typecheck 0 errors; unit 39/39; E2E 4/4; live gmail2 1/1 | 13:10 |
| C Self-healing runtime | in progress | `phase-c` (subagent) | — | 13:10 |
| B Steps + recording + Inspector | DONE | `phase-b` / PR #5 (merged) | PASS on `nextgen` after merge — record.spec ×2 green; unit 93/93; E2E 7/7; live Demo-1 5/5 (+2/2 post-merge) | 13:50 |
| A User data store | DONE | `phase-a` / PR #4 (merged) | PASS on `nextgen` after merge — data.spec green; unit 75/75; E2E 5/5 | 13:30 |
| E Network upgrades | DONE | `phase-e` / PR #3 (merged) | PASS on `nextgen` after merge — extended net.spec (rotating CSRF → verified) green; op-analysis unit tests; E2E 5/5 | 13:30 |
| D Activity + suggestions + jobs | in progress | `phase-d` (subagent, port 8805) | — | 13:55 |
| F Cross-site flows | not started (needs B, C) | — | — | — |

## Now working on
- coordinator: A, E, B merged and gated; D started 13:55 (needs B ✓); waiting on C (8801); F starts when C passes.

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

### Phase A — User data store — DONE
Full report (implemented / evidence / how to verify / known issues): `docs/phases/A.md`. Summary:
- **Implemented:** backend `modules/data` (DataStore over `node:sqlite` `docs` table, REST `/api/data…` scoped by `x-user-id`, DATA_LIMITS), `WidgetAI.db.list/get/add/update/remove` prelude section (grant `data`), extension `modules/data` (WIDGET_DATA with grant + declared-collection + origin checks, panel DATA_* messages), `existingCollections` sent on generate/repair, generator prompt section + `collections` in the schema/validator, approval card "Stores data in: …", Data tab (list, delete, clear, export JSON), `fixtures/movies` (detail + watchlist), mock save/list widgets.
- **Evidence (on `nextgen` after merge, 13:26):** typecheck 0 errors; unit 75 passed / 0 failed (core 36, widget-runtime 5, backend 27, extension 7); E2E 5 passed (19.0 s): data, widget, gmail2, youtube, net. data.spec: 2 movies saved → `GET /api/data/saved_movies` = 2 docs for the install id, 0 for another uuid, 400 without `x-user-id`; second generation's LLM input contains `saved_movies`; watchlist widget lists both titles; undeclared collection / wrong origin refused; Data tab delete → 1 doc everywhere. Live (extra): `tests/tools/data-live.mjs` — both Opus widgets declared `data` + `saved_movies` first try; 7/7 data calls ok (after one prompt-rule fix, recorded in A.md). Artifacts `docs/evidence/A/`.
- **Known issues:** install-id identity only (as designed); no settings flag for data (inert unless a widget declares `data`).

### Phase E — Network upgrades — DONE
Full report: `docs/phases/E.md`. Summary:
- **Implemented:** §4.2 step attribution plumbing (`netAttribution.setStepProvider` in content/netbridge; time window fallback — Phase B must hook its recorder in), §4.3 op analysis in `packages/core/src/op-analysis.ts` (route templates, token/param fields, dependency inference, idempotency hints; no raw values), §4.4 tiers observed → replayed → verified + `WidgetAI.net.reportVerified` (returns `{verified, tier, error?}`), browser-only (webRequest-only) ops listed, §4.5 strategy rule prompt section; rotating single-use CSRF in `fixtures/net`; Inspector tier badges + dependency lines.
- **Evidence (after merge):** same suite as above (net.spec green on `nextgen`). In-branch: net.spec `--repeat-each=3` 3/3; stale-token replay → 403 `ok:false`, tier stays `observed`; mock widget re-fetches the token, replays (201), reads back, reaches `verified`. Live: 1/1 first try, Opus 90.8 s (trace `t_cyzx6hdmp2wg`), `verified`, 0 token rejections, 0 sent. Artifacts `docs/evidence/E/`.
- **Not implemented:** auto-probing GET ops (deliberately off: the CSRF fixture shows GETs can have side effects); CDP / WebSocket capture (stretch). Page-supplied triggers are now ignored (SW computes attribution).

### Phase B — Steps + recording + Record/Inspector UI + trace harness — DONE
Full report: `docs/phases/B.md`. Summary:
- **Implemented:** §1.2 settle machine (`core/settle.ts`, fake-clock tests), locator bundles, redaction at capture + ingest + export, meaningful-event recorder (`content/steps`), SW Step ingest with global `seq` (`modules/observe`), §3 window-global RecordingSession following tab switches, REC badge + in-page pill (click = stop), `toggle-recording` command, Record tab (live timeline + Review sheet: strike steps, open questions, instructions → re-interpret → Generate), Tier-1 Step Interpreter (`steps.interpret`, Haiku 5.5) + Workflow Interpreter (`recordings.interpret`, Opus 5.5, structured) → WorkflowSpec enriched with locator/skeleton evidence → spec-conditioned generation (`WidgetRecord.spec`), Inspector Steps + LLM calls + bus log + Export debug bundle, trace harness (`tests/traces/`, `tests/tools/trace-eval.mjs`).
- **Evidence (on `nextgen` after merge, 13:45):** typecheck 0 errors; unit 93 passed / 0 failed (core 50, widget-runtime 5, backend 31, extension 7); E2E 7 passed (30.9 s): data, gmail2, net, record ×2, widget, youtube. record.spec: record → reply to 1 email → 3 Steps → spec with goal/slots and "Send" as stop-before → generate → approve → drafts {m1, m2}, 0 sent; REC pill stops; typed password `[REDACTED]` in the Step and absent from the exported bundle (valid JSON). Live Demo-1 (Opus 5.5): **5/5 first try** pre-merge + 2/2 post-merge (interpret 12–14 s, generate 124–167 s; trace ids in B.md). Trace eval: 42/43 checks on 4 labelled traces, Tier-1 label accuracy 1.0 (miss = label disagreement, not edited). E1: synthetic Alt+Shift+R fired `chrome.commands` 0× (headless + headed) → tests use messages. E2 (fixtures only): 20/20 Steps closed on the 400 ms quiet window on HardMail and NetMail; real-site measurement still owed. E9: copy/paste readable in the isolated world on HardMail; lineage hash matched. Artifacts `docs/evidence/B/`.
- **Not implemented:** IndexedDB event store (300-entry session ring instead), `replay-bundle.mjs`, download Steps, screenshot thumbnails. Reply flow yields 3 Steps on the fixture (doc expected 4: autosave, no Save click).
- **Known issues:** observe flag reaches already-open tabs only after reload.

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

- 13:55 — Phase D started as soon as B passed its gate (table: depends on B, +C only for codegen; D's suggestion jobs reuse the existing generator, C's runtime can be layered on later) — maximises parallel time — rejected: waiting for C.

## Stuck log
(none yet)

## Final summary
(Written at the end.)
