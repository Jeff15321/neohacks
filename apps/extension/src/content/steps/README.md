# content/steps

**Owner: Phase B (implemented).** Step recorder (doc §1.2), top frame only, inactive until the SW sends
`WWA_REC_STATE {capture:true}` (recording, or the `observe` settings flag).

- `recorder.ts` — meaningful-event filter (trusted events only: click → nearest interactive ancestor, committed input
  (change / blur / 1.5 s typing idle for never-blurring composers), submit, single-key shortcuts outside editables,
  copy/cut/paste (E9: readable in the isolated world), select, drop, SPA URL changes), MutationObserver significance
  filter (`isSignificantMutation`: ignores `wwa-*` UI, timestamp ticks, hidden attribute churn), in-flight requests via
  `netbridge.netActivity`, live-region text (role=status/alert/aria-live + fixed-position toast heuristic),
  LocatorBundles (`@app/core/locators`, match counts from `querySelectorAll`), region skeletons (`skeletonOf`),
  redacted value previews + lineage hashes. Settle state machine: `@app/core/settle` (pure, fake-clock tested).
- `index.ts` — wiring: `WWA_REC_QUERY` on load, `WWA_REC_STATE` (capture + REC pill), `WWA_STEPS_FLUSH` (stop).
- Emits `WWA_STEP` (draft; SW assigns `seq`) and `WWA_STEP_LATE` (late effects ≤ 6 s).
- Imports `@app/core/<subpath>` only (keeps content.js ~40 KB).
