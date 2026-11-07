# panel/

Side panel (also opened as a tab at `chrome-extension://<id>/sidepanel.html` by tests). React 18 + **Tailwind v4**
(built by `@tailwindcss/cli` in `build.mjs` → `dist/panel.css`) + shadcn/ui-style components (`components/ui`, copied
pattern; Radix only for Tabs). Neutral palette + indigo accent, dark mode via `prefers-color-scheme`.

- `app/App.tsx` — header (health, Observe toggle, Record button) + tab shell (`TABS`).
- `app/state.tsx` — panel state (widgets, logs, progress, health, settings) fed by SW broadcasts.
- `hooks/useBus.ts` — `send(msg)` (adds a fresh traceId), `useBroadcast`.
- `tabs/` — Create (generate + approval cards), Widgets (installed: run/edit/auto-fix/logs/thread), Inspector
  (Network, Bus log, LLM calls), `Placeholders.tsx` (Record → B, Activity → D, Data → A: replace with your own file).

Stable test hooks: `#req`, `#gen-btn`, `[data-testid=tab-<id>]`, `approval-card`, `approve`, `widget-card`,
`widget-status`, `run`, `edit-input`, `net-ops`, `net-refresh`, `bus-log`, `llm-calls`, `llm-call`.
Phase B: `rec-toggle`, `rec-start`, `rec-stop`, `rec-status`, `record-tab`, `step-row`, `step-meaning`, `step-strike`, `step-live`,
`review`, `spec`, `spec-goal`, `spec-slot`, `spec-consequential`, `spec-answer`, `#rec-instructions`, `rec-interpret`, `rec-generate`,
`steps-log`, `step-log-row`, `export-bundle`, `export-trace`.
