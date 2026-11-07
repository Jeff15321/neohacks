# modules/generate

Widget generation / repair / conversational edit.

- **Route:** `POST /api/generate-widget` (`GenerateWidgetRequest` → `GenerateWidgetResponse`), body validated with the
  contracts schema. 422 when both attempts fail validation.
- **service.ts:** stage `generate.widget` (+ `generate.widget.retry`) via `callModel` — model `LLM_MODEL_GENERATION`
  (Opus 5.5), effort `high`, structured output `WIDGET_JSON_SCHEMA`, streamed. One retry with the validator error.
- **validate.ts:** JSON extraction + `checkGeneratedCode` (denylist, non-standard selectors, acorn) + grant/match-pattern
  filtering. Ported from MVP `generation/parse.ts`.
- **prompts/widget.ts:** system prompt (every MVP DOM/waiting/safety rule), user prompt, JSON schema.
  Later phases add prompt sections through `WIDGET_PROMPT_SECTIONS` / their own prompt files.
- **prompts/widget.mock.ts (+ mockdata):** deterministic widgets per fixture for E2E.

Test: `npm run test:unit -w apps/backend` (`generate.test.ts`).
