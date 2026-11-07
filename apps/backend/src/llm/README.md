# llm/

**One entry point:** `callModel({stage, model, effort, system, messages, jsonSchema?, stream?, traceId, mock})`.
Never call the SDK directly (Rules §6).

- `callModel.ts` — logs every call to the sqlite `llm_calls` table (stage, model, effort, latency, tokens, input,
  output, parse result via `result.report(ok, err)`); `listLlmCalls` backs `GET /api/debug/llm-calls`.
- `providers/anthropic.ts` — current-model rules: no `temperature`; `output_config.format` (structured outputs) +
  `output_config.effort`; `cache_control` on the frozen system prompt; streaming + `finalMessage()`; refusal → error.
- Mock: when `LLM_PROVIDER=mock`, callModel runs the `mock` function supplied by the caller's prompt file
  (`modules/<name>/prompts/*.mock.ts`). Every prompt ships its own deterministic mock.

Models (env): `LLM_MODEL_GENERATION` (default `claude-opus-5-5`), `LLM_MODEL_INFERENCE` (`claude-sonnet-5-5`),
`LLM_MODEL_FAST` (`claude-haiku-5-5`).

Test: `src/llm/callModel.test.ts` (mock provider, `:memory:` db).
