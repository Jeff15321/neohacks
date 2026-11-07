# modules/observe

**Phase B part (implemented): Step ingest.** Phase D adds the ObserveClient (activity model) on top.

- `steps.ts` — `StepStore`: assigns the global monotonic `seq` (serialised, persisted in `storage.session`
  `wwa_step_seq`), keeps the last 300 Steps in `storage.session` `wwa_steps`, re-redacts typed values
  (`redactStepForExport`), merges `lateEffects`, notifies subscribers.
- Messages handled: `WWA_STEP`, `WWA_STEP_LATE` (content → SW), `GET_STEPS` (panel). Emits `STEP_UPDATED`.
- Services provided: `steps.ingest`, `steps.subscribe`, `steps.recent`.
- Capture is enabled by modules/record (`WWA_REC_STATE.capture` = recording || settings.observe).
- Test: `tests/e2e/record.spec.ts` (Steps for open row → reply → type), `packages/core/src/__tests__/steps.test.ts`.

**Phase D part: activity model client + suggestions** (`activity.ts` registers; `activity-client.ts`, `suggestions.ts`).

- `ObserveClient` subscribes to `steps.subscribe`; only while `Settings.observe` is on; sensitive origins denylisted.
  ONE `POST /api/observe/steps` in flight; Steps arriving meanwhile queue in `storage.session` `wwa_observe_queue`
  and the next request takes all of them (≤40). Per-call stats kept for E10 (`ACTIVITY_GET.history`).
- `SuggestionManager`: Judge candidates → `core/suggest.admitSuggestion` (dismissed / one live per pattern / ≤1 visible)
  → `jobs.start` (speculative generation) → card states generating → ready → failed. Accept → `widgets.adopt`
  (UNAPPROVED record → approval card; never runs). Not now / Never for this (cancel job + `POST /api/observe/dismiss`) /
  Retry / Restore. Gated by `Settings.suggestions`. Storage: `storage.local` `wwa_suggestions` (≤50).
- Messages: `ACTIVITY_GET`, `ACTIVITY_CLEAR`, `SUGGESTION_ACTION` (panel); `WWA_SUGGESTION_ACTION`, `WWA_SUGGESTION_QUERY`
  (content); `WWA_SUGGESTION` (→ content); broadcasts `ACTIVITY_STATE`, `SUGGESTION_UPDATED`, `SUGGESTION_ACCEPTED`.
- Debug handle: `globalThis.__wwaObserve` (client + suggestions) in the SW.
- Test: `tests/e2e/suggest.spec.ts`; live `tests/tools/suggest-live.mjs`.
