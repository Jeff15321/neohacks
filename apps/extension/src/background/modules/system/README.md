# modules/system

**Purpose:** health, page context, module settings flags, and the debug views (bus log, LLM-call log).

**Messages:** panel `PANEL_READY`, `GET_HEALTH`, `GET_PAGE_CONTEXT`, `GET_SETTINGS`, `SET_SETTINGS`, `GET_BUS_LOG`,
`GET_LLM_CALLS` (proxies `GET /api/debug/llm-calls`) · emits `SETTINGS_CHANGED` · sends `WWA_GET_CONTEXT` (top frame).

**Services provided:** `settings.get`, `page.context`. **Uses:** `widgets.list`.

**Data owned:** `wwa_settings` (`{net, observe, record, assist, suggestions}` — each module can be switched off).
