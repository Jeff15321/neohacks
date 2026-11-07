# modules/record

**Owner: Phase B.** Settings flag: `record` (REC_START refuses when off).

Window-global `RecordingSession` (doc §3, decision A): follows tab switches within its window, REC badge
(`platform.action`), in-page pill (content `overlay/rec-pill.ts`, click = stop), `toggle-recording` command
(Alt+Shift+R, `platform.commands`), live Tier-1 meanings, stop → Workflow Interpreter → WorkflowSpec → generate.

- `service.ts` — `RecordService` (start/stop/toggle, onStep, tab-switch + navigation Steps, interpret, evidence, generate).
- `store.ts` — owns `storage.session` key `wwa_rec` (session, Steps, semantic map, spec, page snapshots).
- Messages handled: panel `REC_START`, `REC_STOP`, `REC_GET`, `REC_INTERPRET`, `REC_GENERATE`, `REC_DISCARD`;
  content `WWA_REC_QUERY`, `WWA_REC_STOP`. Sends `WWA_REC_STATE`, `WWA_STEPS_FLUSH` to tabs.
  Broadcasts `REC_STATE`, `STEP_ADDED`, `STEP_MEANING`, `REC_SPEC`, `REC_WIDGET`.
- Uses services: `steps.subscribe`, `steps.ingest` (observe), `page.context`, `widgets.generate`, `settings.get`.
- Backend: `POST /api/recordings/steps/interpret` (Tier 1, Haiku), `POST /api/recordings/interpret` (Opus).
- Debug: `globalThis.__wwaRecord` in the SW (`.state`, `.commandLog` for E1).
- Test: `tests/e2e/record.spec.ts`.
