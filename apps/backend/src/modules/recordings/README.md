# modules/recordings

**STUB — owner: Phase B.**

POST /api/recordings/interpret (recording → WorkflowSpec, Opus 5.5) + step-interpret stage; owns the traces table.

Layout when implemented: `routes.ts` (HTTP only) · `service.ts` (logic) · `prompts/` (one file per prompt + `*.mock.ts`) · tests.
Register by adding `registerRecordings` to `MODULES` in `src/server.ts`.
