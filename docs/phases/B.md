# Phase B — Steps + recording + Record/Inspector UI + trace harness

## HANDOFF
Status: **DONE** (13:40 PST). Branch `phase-b` (from `nextgen`). Gate green: typecheck 0 errors; unit 57/57; E2E 6/6
(widget, gmail2, youtube, net, record ×2); live Demo-1 **5/5** first try (Opus 5.5); E1/E2/E9 run (see report).
Nothing in progress. Follow-ups for the coordinator are under "Known issues".

## Decisions (made without the human)
- 13:10 — All Phase-B bus messages (Steps + recording) live in `packages/contracts/src/messages/record.ts`; `messages/observe.ts` is left untouched for Phase D — avoids a merge conflict on a file header-marked for D. Rejected: splitting Step messages into observe.ts.
- 13:10 — Extension `modules/observe` (ours per the orchestration doc) implements only Step ingest (`steps.ts`: seq, storage.session ring, late merge) and exposes services `steps.ingest` / `steps.subscribe` / `steps.recent` so Phase D can add its ObserveClient on top without touching our code.
- 13:12 — Settle machine is a pure class driven by explicit timestamps + `nextDeadline()` (no timers inside) → fake-clock tests need no timer mocking.
- 13:12 — Input Steps are "held": opened on the first `input` event (so effects while typing — e.g. Gmail-style autosave "Draft saved" — belong to the typing Step), committed on change / blur / **1.5 s typing idle** (Gmail's composer never blurs), then settle normally. Doc says commit = change or blur; the idle commit is an addition.
- 13:12 — Live-region text = `role=status|alert`, `aria-live`, `<output>` **plus a toast heuristic** (fixed/sticky element that becomes visible with ≤120 chars of text). The HardMail fixture's "Draft saved" toast has no aria-live and fixtures/gmail2 is read-only for us.
- 13:12 — Requests that started before a Step opened (polling) never block settle and are never attributed; requests in flight at close are tracked into the late window (≤6 s) and merged as `lateEffects`.
- 13:12 — A Step closed by a new action (`interrupted`) or stop (`flush`) counts as `settled:true` iff nothing is in flight; `settle: {reason, mutations, lastActivityMs}` is kept on every Step (E2 instrumentation, visible in Inspector).
- 13:13 — Locator `text` candidates are encoded `"<tag|[role]> >> text=\"…\""` (not CSS) and the generator prompt says so; every other candidate is standard CSS. Framework-looking ids are skipped.
- 13:14 — Typed values are redacted at capture (content) and again at SW ingest + every export (`redactStepForExport`): password/secret-named/OTP/card fields → `[REDACTED]`, token-like strings and card-like digit runs masked, previews clipped to 200 chars. Clipboard text never leaves the page except as a redacted 80-char preview + FNV-1a hash (lineage).
- 13:15 — The Workflow Interpreter's LLM schema omits locators/skeletons; the backend enriches each spec step from the cited Steps (top-4 locator candidates + first appeared-region skeleton). Cheaper, and the evidence is exact rather than LLM-copied. Struck Steps are never sent to the model.
- 13:15 — Stop auto-runs the interpreter (review sheet appears with a spec); answers/strikes/instructions re-run it once via "Re-interpret". Instructions typed at Generate time are also appended to the generator request.
- 13:16 — Generation from a recording goes through a new service `widgets.generate(request, traceId, {spec, evidence, tabId})` (WidgetService.generate gained an optional `opts`); `WidgetRecord.spec` is saved and passed again on repair/edit.
- 13:17 — `REC_DISCARD` stops without interpreting (used by tools that must not spend Opus calls).
- 13:20 — Live-run tool clicks "Generate" with the instruction "Draft only (never send). Do all unread emails. Run from a toolbar button." and does not answer open questions — the instruction is the human's normal review step; counted as first-try (one interpret + one generate, no retry, no repair).
- 13:25 — `tests/e2e/helpers.ts` gained `PW_PROFILE` (default unchanged) so tools can run beside another browser session.
- 13:27 — Trace labels were written before seeing model output and are NOT edited to match it (the noisy-trace "Back to Inbox is noise" label disagrees with Opus; reported as-is).

## Stuck log
(none)

## Phase report

### Phase B — Steps + recording + Record/Inspector UI + trace harness — DONE
**Implemented** (mapped to `docs/next-gen-architecture.md`):
- §1.2 Step + settle → `packages/core/src/settle.ts` (`SettleMachine`: open on action, 400 ms quiet w/o in-flight, 3 s cap → `settled:false`, new action closes, ≤6 s `lateEffects`; `isSignificantMutation` ignoring `wwa-*` UI / timestamp ticks / hidden attribute churn; region caps ≈2.4 KB/Step). Locator bundles → `core/locators.ts` (id, data-*, aria-label, role+name, short CSS path, text; match counts; ranking). Typed-value redaction → `core/step-redact.ts` (reuses `core/redact`). Lineage hashing → `core/lineage.ts`. Contracts: `steps.ts` (+`StepDraft`, `StepLateEffects`, `valueHash`, `settle`, `title`), `workflow.ts` (+session fields, `EvidenceStep`, interpret API schemas), `widget.ts` (`spec?`), `api.ts` (`spec?`, `evidence?`), `messages/record.ts`.
- §1.2 meaningful-event filter → `apps/extension/src/content/steps/recorder.ts` (trusted click → interactive ancestor, committed input, submit, single-key shortcuts outside editables, copy/cut/paste, select, drop, SPA URL changes; in-flight via `netbridge.netActivity`; Step → SW). SW `modules/observe` assigns global `seq` (serialised, persisted), stores, merges late effects.
- §3 recording → `modules/record` (window-global `RecordingSession` in `storage.session`, follows tab switches with `tab-switch` Steps, full-navigation `navigate` Steps via `webNavigation.onCommitted`, PageContext snapshots at start/stop/tab-switch/route change, flush-on-stop, `toggle-recording` command Alt+Shift+R, `REC_*` PanelToSW messages, settings flag `record`). Platform wrappers: `action` (badge), `commands`, `webNavigation`, `tabs.onActivated/onUpdatedComplete/query`. Manifest: `commands`, `webNavigation` permission.
- Decision A indicators → REC badge (red, `chrome.action`), pulsing in-page pill in a `wwa-rec-pill` Shadow DOM (`content/overlay/rec-pill.ts`, click = stop, shows step count), header Record button.
- Decision A Record tab → `panel/tabs/Record.tsx`: live Step timeline (raw row: kind, target, value preview, +regions with expandable DOM, net calls, live text; meaning row filled async by Tier 1) → Review sheet: WorkflowSpec (goal, trigger, slots, outputs, steps+roles+cited seqs, success criteria, stop-before consequential actions, open questions with answer boxes), strike steps, instructions, Re-interpret, Generate → approval card in place.
- §3 WorkflowSpec + §6 → backend `modules/recordings`: `POST /api/recordings/steps/interpret` (Tier-1, `steps.interpret`, Haiku 5.5, low, structured) and `POST /api/recordings/interpret` (`recordings.interpret`, Opus 5.5, high, streamed, structured), evidence enrichment, `traces` table rows. Prompts one file each + deterministic mocks (`prompts/step-interpret{,.mock}.ts`, `prompts/workflow-interpret{,.mock}.ts`).
- §3 conversion → generator conditioned on spec: `generate/prompts/sections/spec.ts` (system section + `renderSpecForPrompt` rendering spec + Step evidence into the user prompt), `widget.ts` one-line render hook, deterministic spec widget mock (`widget.spec.mockdata.ts` + branch in `widget.mock.ts`), `WidgetRecord.spec` saved and reused on repair/edit.
- Decision A Inspector → `tabs/Inspector.tsx`: Steps pane (raw capture JSON per Step), existing Network / Bus log / LLM calls, **Export debug bundle** (Steps, recording + semantic + spec, LLM calls, bus log, widgets code+version+spec, run timeline → one JSON) and **Export trace** (Step log for `tests/traces/`).
- §8 trace harness → `tests/traces/` (4 captured fixture traces + hand labels + README), `tests/tools/trace-capture.mjs`, `tests/tools/trace-eval.mjs` (replays Steps offline into `steps.interpret` + `recordings.interpret`, scores vs labels).
- Tools: `tests/tools/record-live.mjs` (live Demo 1), `e2-settle.mjs` (E2), `e9-clipboard.mjs` (E9).

**Not implemented / descoped:**
- §1.2 `download` Steps (optional per doc) and `chrome.tabs.captureVisibleTab` thumbnails (stretch) — not done.
- Toggling the `observe` settings flag does not push capture on/off to already-open tabs (they pick it up on next load / next REC_STATE); the system module owns SET_SETTINGS. Phase D should add a settings-change hook.
- §3 "all net records attributed to Steps by step id" — Steps carry the net ops observed during settle (`effects.net`, ids = probe record ids), but NetLog attribution by step id is Phase E's.
- IndexedDB EventStore (§8 Phase 1) — Steps kept in a 300-entry `storage.session` ring instead (enough for recording; Phase D may need IndexedDB).
- `tests/tools/replay-bundle.mjs` (debuggability section) — not written; the bundle format is documented by `collectDebugBundle` in `tabs/Inspector.tsx`.
- Phase 1 accept says "open row → click reply → type → save yields 4 Steps": the fixture autosaves (no Save click), so it is **3 Steps** (click row, click Reply, input-commit) with the composer skeleton on Step 2 and "Draft saved" on Step 3.

**Evidence the phase is correct:**
- `npm run typecheck` → exit 0, 0 errors (all packages).
- `npm run test:unit` → core 38/0 (14 new: settle ×9, significance filter, locators ×2, redaction, lineage), widget-runtime 2/0, backend 13/0 (4 new recordings tests), extension 4/0 → **57 passed, 0 failed**.
- `cd tests/e2e && E2E_PORT=8802 npx playwright test --reporter=line` → **6 passed (27.2 s)**: gmail2, net, record (Demo 1), record (pill/redaction/E1), widget, youtube.
- `record.spec.ts` key assertions: REC_START via message → badge "REC" + pill attached; Steps = `click, click, input-commit` with monotonic seq, row locator `tr[data-legacy-message-id="m1"]` (1 match), Reply step's appeared region contains "Message Body", typing Step has live text "Draft saved" and a value preview; Record tab shows 3 step rows with Tier-1 meanings; REC_STOP → badge "" + pill gone; review shows spec goal /unread/, ≥1 slot, stop-before "Send"; answering the open question + Re-interpret clears it; Generate → approval card in the Record tab → approve → `WidgetRecord.spec.goal` saved → widget click → `__drafts` = {m1, m2} (= N unread at start), `__sent` = 0, status completed, 0 unread rows left; Inspector shows Steps + `recordings.interpret` / `steps.interpret` / `generate.widget` calls + bus `REC_START`; Export debug bundle downloads and `JSON.parse`s with steps ≥3, spec, llmCalls ⊇ {steps.interpret, recordings.interpret, generate.widget, inference}, bus log, widget code v1, run-timeline logs. Second test: pill click stops; a typed password (`hunter2-SuperSecret!`) is `[REDACTED]` in the Step and absent from the exported bundle text.
- **Live Demo 1 (Opus 5.5, fixture-gmail2): 5/5 first try** (`tests/tools/record-live.mjs`, backend `LLM_PROVIDER=anthropic` on :8802). Every run: 3 Steps → spec → one generation (no validator retry, no repair) → drafts {m1, m2}, 0 sent, status completed.

  | run | interpret trace (s, out tok) | generate trace (s, out tok) | widget |
  |---|---|---|---|
  | 1 | `t_xasw5n6d74nr` (14.3, 1367) | `t_qm0zh6isrokt` (166.9, 20432) | Draft AI Replies to Unread |
  | 2 | `t_ot49c89rm1cl` (11.8, 1285) | `t_05d5ef9g24mz` (124.3, 15100) | Draft Unread Replies |
  | 3 | `t_b2sru6l83cct` (13.0, 1443) | `t_n6kpkrvw8121` (128.0, 15196) | AI Draft Replies for Unread |
  | 4 | `t_e8itid348mag` (12.5, 1263) | `t_tbsiduy0cfe7` (135.3, 16098) | Unread Reply Drafter |
  | 5 | `t_nj9bdf6eotvv` (12.4, 1259) | `t_1muq31gbkp3c` (135.5, 16198) | Unread Reply Drafter |

  All parseOk; Tier-1 (Haiku 5.5): 94 calls in the session, mean 1.3 s, max 3.1 s, 94/94 parseOk. (Phase 0 baseline for generation without a recording: ~1 in 3–4.)
- **Trace eval (live, `trace-eval.mjs`)**: 4 traces, **42/43 checks**, Tier-1 accuracy 1.0 (17/17 labelled Steps + navOnly), spec checks 22/23. The one miss: on `gmail2-reply-noisy` Opus cites the detour "Back to Inbox" (seq 2) in an essential "return to inbox" intent — label says noise. Spec latency 12–21 s per recording. Mock smoke run: 41/43 (the mock is intentionally naive) — harness discriminates.
- **E1** (synthetic keys → `chrome.commands`): `page.keyboard.press('Alt+Shift+R')` fired `onCommand` **0 times headless and 0 times headed** (Playwright chromium) → tests use `REC_START/REC_STOP` messages (planned path); the real shortcut is wired (`commandLog` in `globalThis.__wwaRecord`) but unverified by automation.
- **E2** (settle thresholds) — **fixtures only; real Gmail/YouTube are not available in this environment**: 20 clicks each with 1.5 s gaps. HardMail: 20/20 closed by quiet, time-to-last-significant-activity p50 0 ms / p90 1 ms, Step duration 400 ms. NetMail (real fetches): 20/20 quiet, p50 16 ms / p90 17 ms / max 19 ms, 17/20 Steps with attributed net calls, 0 unsettled, 0 late. YouTube fixture is static (no interactive effects). Conclusion: 400 ms / 3 s are not binding on fixtures; real-site measurement still owed (use `tests/tools/e2-settle.mjs` with a real URL list).
- **E9** (copy/paste in the isolated world on a contenteditable page): **positive** on HardMail headless — `copy` Step read the selection (redacted preview + hash `89a33473`), `paste` into the contenteditable composer read `clipboardData` (same hash), `lineageEdges` → copy#2 → paste#4 (and → input#5). Real GitHub/Jira not tested.
- Artifacts (`docs/evidence/B/`, 360 KB): `live-run-{1..5}.json` (steps, Tier-1 labels, spec, timings, generated code), `live-llm-calls.txt` (all live calls: stage, trace, model, effort, latency, tokens, parseOk), `trace-eval-live.json`, `trace-eval-mock.json`, `e2-settle.json`, `e9-clipboard.log`, `record-review.png`, `inspector.png`.

**How to verify it yourself (≤5 min):**
`npm run typecheck && npm run test:unit` → 0 errors, 57 passes. `cd tests/e2e && E2E_PORT=8802 npx playwright test record.spec.ts --reporter=line` → 2 passed (~15 s). Live (~2.5 min): `BACKEND_PORT=8802 LLM_PROVIDER=anthropic DATA_DB_PATH=/tmp/x.db npm run start -w apps/backend` + `BACKEND_URL=http://127.0.0.1:8802 npm run build`, then `cd tests/tools && E2E_PORT=8802 RUN=x npx tsx record-live.mjs` → `PASS drafts=["m1","m2"] sent=0`. Offline eval: `E2E_PORT=8802 node tests/tools/trace-eval.mjs`.

**Known issues:**
- Shared files edited (expect small merge conflicts): `packages/contracts/src/{steps,workflow,widget,api}.ts`, `messages/record.ts`; `packages/core/src/index.ts` (+4 exports); `apps/extension/manifest.json` (`webNavigation`, `commands`); `background/bus.ts` (`Services`: `steps.*`, `widgets.generate`); `background/platform/index.ts` (action/commands/webNavigation/tabs wrappers); `modules/widgets/{service,index}.ts` (generate `opts`, spec on repair, provide `widgets.generate`); `content/main.ts` (+`startSteps()`); `panel/app/App.tsx` (header `RecordButton`); `panel/README.md` (test hooks); backend `generate/prompts/widget.ts` (1-line spec render), `widget.mock.ts` (spec branch first), new `widget.spec.mockdata.ts`; `tests/e2e/helpers.ts` (`PW_PROFILE`).
- Phase D: extension `modules/observe/index.ts` now has Phase-B content (Step ingest) — add the ObserveClient next to it, consume `bus.use('steps.subscribe')`.
- Phase C (chaos mode in fixtures/gmail2): the toast heuristic + `tr[data-legacy-message-id]` locators were tuned on the current fixture.
- The content script observes `attributes` on the whole document while capturing; heavy pages (real Gmail) may need an attribute filter — unmeasured (E2 real-site).
- `live-run-*.json` `llmCalls` lists the last 30 calls of the shared backend (includes other runs/eval calls); the per-run trace ids are the table above / `live-llm-calls.txt`.
