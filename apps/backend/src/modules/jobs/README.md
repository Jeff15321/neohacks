# modules/jobs (Phase D)

Background generation jobs (doc §2, §7 suggestion pipeline). Owns the `jobs` table.

- `POST /api/jobs` `{kind: generate|regenerate, request, spec?, evidence?, pageContext, existingCollections?, dedupeKey?}` → `{ok, job}` (queued; runs in-process).
- `GET /api/jobs/:id?wait=25[&since=<updatedAt>]` → long-poll: returns at once if terminal or changed since `since`, else on the next change or after `wait` s (max 25).
- `DELETE /api/jobs/:id` → cancel (state machine: late results of a cancelled job are discarded).

Logic: `service.ts` drives `packages/core/job-machine.ts` (`transitionJob`) and calls the generate pipeline through the
backend service registry (`deps.services.use('generate.widget')`), never generate's internals. A job with the same
`dedupeKey` (= pattern + spec hash) for the same user is reused unless it failed/was cancelled. Jobs left running at
startup are marked failed. No prompts of its own (generation prompts are the generate module's).

Test: `npm run test:unit -w apps/backend` (`jobs.test.ts`: start → long-poll → succeeded; cancel → late result discarded; dedupe).
