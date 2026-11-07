# modules/observe (Phase D)

Passive activity model (doc §1.4–1.6): Tier 1 → Tier 2 (+ reconsolidation) → deterministic gate → Tier 3 Judge.
Owns the `activity_snapshots` table (per-user WorkingMemory + recent Steps/labels + op log + suggested patterns).

Routes
- `POST /api/observe/steps` `{steps: Step[]}` (redacted Steps; the SW sends one request at a time, queued Steps coalesced)
  → `{ok, state: WorkingMemory, semantic, ops, suggestions: SuggestionCandidate[], diag}`.
- `GET /api/observe/state` · `POST /api/observe/dismiss {patternId, reason?}` · `POST /api/observe/restore {patternId}` ·
  `DELETE /api/observe/state` (clear; dismissals kept).

Pipeline (`service.ts`, serialized per user)
1. Tier 1 = recordings' `steps.interpret` (Haiku, per Step, parallel, 5-label window) via the backend service registry.
2. Tier 2 `observe.activity` (Sonnet = `cfg.models.inference`, effort low, structured output `prompts/ops-schema.ts`):
   frozen system prompt + WorkingMemory JSON + last 12 Steps + NEW Steps → patch ops → `packages/core` `reduceActivity`.
3. Reconsolidation `observe.reconsolidate` (same model) when a task completed in this batch or every 25 Steps: last 60
   Steps → corrective ops (flags stripped).
4. Gate (`core/suggest.gateJudge`): task boundary + Tier-2 flag + ≥2 completed instances (or ≥3 lineage edges) +
   not dismissed + per-pattern cooldown. Only then Tier 3 `observe.judge` (Opus = `cfg.models.generation`, effort medium,
   conservative rubric, sees dismissals) → score = value×confidence×feasibility ≥ 0.3 → SuggestionCandidate with request +
   WorkflowSpec draft. The SW turns it into a speculative generation job (modules/jobs).

Prompts: `prompts/{activity,reconsolidate,judge}.ts`, each with a deterministic `*.mock.ts` (the mocks make
`tests/e2e/suggest.spec.ts` deterministic: no flag after the 1st completed reply, a flag after the 2nd).

Test: `npm run test:unit -w apps/backend` (`observe.test.ts`), `tests/e2e/suggest.spec.ts`, live eval `tests/tools/trace-eval.mjs STAGES=activity`.
