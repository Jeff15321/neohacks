# Phase F — Cross-site flows (Demo 3)

## HANDOFF
- Status: **DONE** — doc §5 implemented end-to-end (bundle parts + validation, `WidgetAI.flow` call/handle, durable
  FlowCoordinator with storage.session runs, chrome.alarms timeouts, checkpoints + re-injection on navigation,
  cancellation from home/panel, focus/return + progress pill), cross-tab recording → lineage → bundle, issues/tracker
  fixtures on different origins. Mock gate green (typecheck 0, unit 138/138, E2E 17/17 after merging nextgen); E5 + E7 recorded (E7 inconclusive under Playwright); live Opus run: valid bundle, flow succeeded.
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
### Phase F — Cross-site flows (Demo 3) — DONE
**Implemented** (mapped to `docs/next-gen-architecture.md`):
- §5 bundle: `GeneratedWidget.parts?: WidgetPart[]` (role, matchPatterns, code, entryUrl?, handlers?), new grant `flow`;
  `packages/core/src/bundle.ts` `checkBundle` (every part through `checkGeneratedCode` + bundle rules, see Decisions) wired into
  `generate/validate.ts`; `parts` in `WIDGET_JSON_SCHEMA`; approval card lists every origin (`Sites:` + "Also acts on other
  sites: localhost/… — tracker-sink (createTicket)"), the `flow` grant sentence, consequential actions and each part's code.
- §5 platform API (`packages/widget-runtime/src/sections/flow.ts`): home `WidgetAI.flow.call(role, handler, input,
  {openUrl?, reuseTab=true, activate=true, timeoutMs?})` → result / rejects with the run's reason (`err.status`, `err.runId`);
  `WidgetAI.flow.cancel(runId)`; sink `WidgetAI.flow.handle(handler, fn)` with `ctx.checkpoint`, `ctx.resumeState`,
  `ctx.cancelled()`, `ctx.runId`; progress pill on the target tab; `buildPartSource` keeps the full prelude (danger guard).
- §5 coordinator 1–8 (`apps/extension/src/background/modules/flow/`, README): FlowRun in `storage.session` + `chrome.alarms`
  timeout (+`alarms` permission, platform wrapper); pure state machine `packages/core/src/flow-machine.ts`; find/create the
  target tab (openUrl restricted to the part's patterns), wait for `status:complete` + content `WWA_PING`, `userScripts.execute`
  with `FLOW_INVOCATION` baked in, result via `FLOW_RESULT`; re-inject with `resumeState` on navigation mid-handler (guarded
  against duplicate runs); tab closed / timeout / cancel (home or panel) → terminal with a reason, alarm cleared, waiters woken,
  pill removed, focus returned home (`activate`); recovery of overdue runs on SW start; evidence = sink `{ok, evidence}`.
  Panel: widget cards list cross-site runs (status, timeline, evidence link, error, Cancel).
- §3 cross-tab recording with lineage: B's recorder already followed tab switches and `lineageEdges` works on the global
  seq; verified end-to-end (copy on 127.0.0.1 → paste on localhost = 4 edges, ≥2 asserted cross-tab) + unit test; generation
  from a multi-tab recording now uses the start tab as home.
- §8 Phase 5 fixtures: `fixtures/issues` (GitHub-like issue pages, `?n=101|102|103`) on `127.0.0.1:<port>`,
  `fixtures/tracker` (Jira-like board + Create form → full navigation to `ticket.html?key=`) on `localhost:<port>`, with a real
  REST mock `apps/backend/src/fixtures/trackerApi.ts` (`/fixture-tracker-api/rest/api/2/issue`, search, `__reset`, `__slow`, `__state`).
- Mock bundle (`prompts/widget.mockdata.flow.ts`, branch keyed on `fixture-issues`), prompt rules `prompts/sections/flow.ts`.
- Tools: `tests/tools/flow-live.mjs` (live Opus run of Demo 3), `tests/tools/e7-background.mjs` (E7 attempt, inconclusive).

**Not implemented / descoped:**
- Port-based invocation (E5 says it would work; the doc's "simplest robust" execute + sendMessage path is used).
- No settings flag for the flow module (inert without an approved bundle). No dedicated Inspector "Flows" tab (runs show on
  the widget card and in the bus log). Repair/edit of a bundle regenerates parts through the same generator path but there is
  no part-specific repair narrative.
- E7 real background-throttling numbers (Playwright keeps every tab visible — see Stuck log).

**Evidence the phase is correct:**
- `npm run typecheck` → 0 errors. `npm run test:unit` → core 75/0, widget-runtime 14/0, backend 42/0, extension 7/0
  (**138 passed, 0 failed**; Phase F adds core `flow.test.ts` 7, widget-runtime `flow.test.ts` 4, backend `validate.flow.test.ts` 4).
- `cd tests/e2e && E2E_PORT=8806 npx playwright test` → **17 passed** (1.9 min; 14 pre-existing: data, gmail2, net, record×2, runtime×4, spike-world, suggest×2, widget, youtube + 3 flow.spec), after merging origin/nextgen at 15:18.
- flow.spec test 1 (record → bundle → run): recorded Steps `copy@issues tab-switch@tracker click paste … input-commit click navigate`;
  spec.dataFlow 4 lineage edges, ≥2 copy(issues tab) → paste/input(tracker tab); approval card shows 127.0.0.1 + localhost part +
  flow grant + "Creates a new ticket in the tracker"; nothing injected before approval; widget origin = issues origin; on issue
  #102 "Create ticket" → tracker server tickets `[TRK-1 (recorded by hand), TRK-2]`, TRK-2 summary = issue title, description has
  the body + source link, labels `[bug, reports]`, request Origin = `http://localhost:<port>`; home link `TRK-2` →
  `http://localhost:<port>/fixture-tracker/ticket.html?key=TRK-2`; run succeeded, 3 injections / 2 navigations (checkpoint → form →
  resume → create → resume → read-back), checkpoint `{submitted:true}`; focus back on the issues tab; 0 `wwa-flow:` alarms; pill gone.
- flow.spec test 2 (failure): tracker slowed (8 s create), target tab opened from `entryUrl`, closed after the `submitted`
  checkpoint → home shows `data-error` "target tab was closed before the flow finished", run `failed` with that reason, 0 non-terminal
  runs, 0 flow alarms, focus home, no link. Then panel Cancel on a new run → home rejects "cancelled: cancelled from the panel",
  run `cancelled`, 0 alarms; the widget card lists both runs.
- **E5** (flow.spec test 3, `docs/evidence/F/e5.json`): `chrome.runtime.onUserScriptConnect` is available; a port from a
  `worldId` USER_SCRIPT world is **bidirectional and stable**: 50/50 SW→US ping / US→SW pong round trips (avg 0.1 ms, max 1 ms),
  `port.sender.url` = the page; a second `execute` in the same world opened a second port (20/20) while the first stayed open and
  shared globals (`exec2 = 2`); both ports fired `onDisconnect` on navigation (`disconnectOnNavigation: true`) → a port is a viable
  live channel per document, but must be re-established after every navigation (as the execute path already does).
- **E7** (`docs/evidence/F/e7-*.json`): sink completes in a background tab with `activate:false`: yes. Timing under Playwright:
  foreground 316 ms vs background 306 ms (headless), 322 vs 309 ms (headed), each a reused tab with 3 injections. A 40×50 ms timer
  loop: 1989–1991 ms in both. **Caveat: not representative of real Chrome** — Playwright reports every tab `visible` (focus emulation,
  even with its anti-throttling flags removed), so the documented 1/s hidden-tab throttling never kicks in. `activate:true` stays the
  default; a manual measurement in a normal profile is still owed.
- **Live (Opus 5.5, effort high, `tests/tools/flow-live.mjs`, request-based on the issues fixture):** 2 generations, both
  `parseOk` with a valid 1-part bundle (home `*://127.0.0.1/fixture-issues/*`, part `tracker-sink` `*://localhost/fixture-tracker/*`,
  entryUrl, handler `createTicket`, consequential action listed): 340 s / 40.6k out tokens (`t_mjby8my9p02w`; the tool's 300 s wait
  expired first → raised to 600 s) and 267 s / 33.4k (`t_eurviz42r164`). Run 2: click on issue #102 → run **succeeded** in 484 ms
  (created → tab → injected → checkpoint → navigated → reinjected → succeeded), tracker TRK-1 with the exact title, body and labels
  `[bug, reports]`, evidence url `…/ticket.html?key=TRK-1`. The tool printed `PASS false` only because its link check did not
  pierce the widget's shadow root (fixed afterwards, not re-run); the generated home code calls `showLink(ev.url, ev.id)` on success.
  Artifacts `docs/evidence/F/live-run.{log,json}` (incl. generated code), `live-llm-calls.jsonl`.
- Artifacts (`docs/evidence/F/`, <300 KB): `bundle-approval.png`, `home-link.png`, `panel-flow-runs.png`, `failure-runs.json`,
  `e5.json`, `e7-flow-{headless,headed}.json`, `e7-timers-headed.json`, `e7-background-{headed,headless}.json`, live files.

**How to verify it yourself (≤5 min):** `npm run typecheck && npm run test:unit` → 0 errors, 138 passes;
`cd tests/e2e && E2E_PORT=8806 npx playwright test flow.spec.ts --reporter=line` → 3 passed (~20 s; logs the recorded Steps,
lineage edges, E5 and E7 numbers). Manual: start the backend, open `http://127.0.0.1:8787/fixture-issues/index.html?n=102`,
Create tab → "Add a Create ticket button that files this issue in our tracker" (mock) → approve → click "Create ticket" → a
localhost tracker tab opens, fills, creates, focus returns, link `TRK-n` appears.

**Known issues:**
- Live generation of a 2-part bundle takes 4.5–5.7 min at effort high (33–41k output tokens) — over the 300 s used by other live
  tools; flow-live waits 600 s.
- Cancel is cooperative: a cancel that arrives after the sink clicked Create cannot undo the create (the next platform call rejects).
- If a sink navigates without calling `ctx.checkpoint` first, the re-injected handler starts from scratch (prompt rule tells the
  generator to checkpoint before any navigating action).
- Part ids `<widgetId>#<role>` are not understood by other modules' `widgets.get` lookups (e.g. `WidgetAI.db` from a part is refused) —
  conservative; widen if a part needs data/net grants.
