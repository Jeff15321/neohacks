# store/

`node:sqlite` (`DatabaseSync`, Node ≥22.13, no extra dependency). File: `DATA_DB_PATH` (default `<repo>/.data/store.db`,
gitignored; `:memory:` in tests/E2E). `openDb()` creates every table idempotently.

| Table | Owner (only writer) |
|---|---|
| `llm_calls` | `llm/callModel.ts` |
| `docs` | `modules/data` (Phase A) |
| `traces` | `modules/recordings` / `modules/observe` (Phase B) |
| `activity_snapshots` | `modules/observe` (Phase D) |
| `jobs` | `modules/jobs` (Phase D) |
