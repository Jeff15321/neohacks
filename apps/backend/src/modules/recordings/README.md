# modules/recordings

**Owner: Phase B (implemented).**

- `POST /api/recordings/steps/interpret` — Tier-1 Step Interpreter, stage `steps.interpret`, `LLM_MODEL_FAST`
  (claude-haiku-5-5), effort low, structured output → `SemanticStep[]`.
- `POST /api/recordings/interpret` — Workflow Interpreter, stage `recordings.interpret`, `LLM_MODEL_GENERATION`
  (claude-opus-5-5), effort high, streamed, structured output → `WorkflowSpec`. Struck Steps are never sent to the model;
  the service enriches each spec step's evidence with the cited Steps' locator bundles + first appeared-region skeleton.
  Saves `{request, spec, traceId}` to the `traces` table (owned here, kind `recording`).
- `prompts/` — `step-interpret.ts` (+ `.mock.ts`), `workflow-interpret.ts` (+ `.mock.ts`), `compact.ts` (Step → prompt view).
- Generation conditioned on a spec lives in `modules/generate` (`prompts/sections/spec.ts`: system section + `renderSpecForPrompt`).
- Tests: `recordings.test.ts` (mock), `tests/e2e/record.spec.ts`, offline eval `tests/tools/trace-eval.mjs` over `tests/traces/`.
