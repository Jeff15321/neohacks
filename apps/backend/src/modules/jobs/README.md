# modules/jobs

**STUB — owner: Phase D.**

Background generation jobs: POST /api/jobs, GET /api/jobs/:id?wait=25 long-poll, DELETE cancel; owns the jobs table.

Layout when implemented: `routes.ts` (HTTP only) · `service.ts` (logic) · `prompts/` (one file per prompt + `*.mock.ts`) · tests.
Register by adding `registerJobs` to `MODULES` in `src/server.ts`.
