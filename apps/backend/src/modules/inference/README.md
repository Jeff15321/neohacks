# modules/inference

`POST /api/inference` — `WidgetAI.inference({prompt, context, instruction})` from generated widgets (relayed by the SW).
Stage `inference`, model `LLM_MODEL_INFERENCE` (Sonnet 5.5), effort `low`, plain text. Limits: prompt 10k chars,
context 50k chars, 20 rpm per widget. Context is framed as untrusted data.

Prompt: `prompts/inference.ts`; mock: `prompts/inference.mock.ts` (MOCK_REPLY / MOCK_TOPICS, ported).
