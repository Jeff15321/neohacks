# modules/observe

**Phase B part (implemented): Step ingest.** Phase D adds the ObserveClient (activity model) on top.

- `steps.ts` — `StepStore`: assigns the global monotonic `seq` (serialised, persisted in `storage.session`
  `wwa_step_seq`), keeps the last 300 Steps in `storage.session` `wwa_steps`, re-redacts typed values
  (`redactStepForExport`), merges `lateEffects`, notifies subscribers.
- Messages handled: `WWA_STEP`, `WWA_STEP_LATE` (content → SW), `GET_STEPS` (panel). Emits `STEP_UPDATED`.
- Services provided: `steps.ingest`, `steps.subscribe`, `steps.recent`.
- Capture is enabled by modules/record (`WWA_REC_STATE.capture` = recording || settings.observe).
- Test: `tests/e2e/record.spec.ts` (Steps for open row → reply → type), `packages/core/src/__tests__/steps.test.ts`.
