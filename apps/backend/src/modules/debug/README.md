# modules/debug

`GET /api/debug/llm-calls?traceId=&limit=` → `{ok, calls: LlmCallLog[]}` (newest first) from the `llm_calls` table.
Used by the extension Inspector (via the SW `GET_LLM_CALLS` message) and by tests.
