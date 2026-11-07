# modules/jobs (Phase D)

JobClient: background widget generation as a backend job (doc §2) — survives SW suspension.

- Services provided: `jobs.start(req, traceId, onUpdate?)` (POST /api/jobs, then long-polls `GET /api/jobs/:id?wait=25&since=`),
  `jobs.cancel(id)` (DELETE), `jobs.get(id)`.
- Messages: `JOBS_LIST`, `JOB_CANCEL` (panel); broadcasts `JOB_UPDATED`.
- Storage: `storage.session` `wwa_jobs` (last 30 jobs; polling resumes for non-terminal jobs after an SW restart).
- Consumers: modules/observe suggestions (speculative generation for a suggestion). Results are adopted as UNAPPROVED
  widgets through `widgets.adopt` — the approval card is always required.
- Test: `apps/backend/src/modules/jobs/jobs.test.ts`, `tests/e2e/suggest.spec.ts`.
