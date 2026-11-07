# Widget AI — natural-language website widgets

Describe a feature for the site you're on; an LLM writes a real JavaScript userscript that modifies the page — new
buttons, panels, workflows — and calls back through a grant-gated platform API (`WidgetAI.*`): AI inference,
storage, network replay of the site's own requests, and more.

> "Add a button that reads my two most recent unread emails and writes a friendly AI-generated reply draft for
> each." → a real toolbar button that does exactly that (drafts only, never sends).

This is the **next-gen architecture** (branch `nextgen`): a modular rebuild of the hackathon MVP (tag `mvp-final`).
Design: `docs/next-gen-architecture.md`. Build progress and evidence: `docs/PROGRESS.md`.

## Layout

```
packages/contracts       zod schemas + types for every boundary message and LLM output (no logic)
packages/core            pure logic (match patterns, replay builder, NetLog, redaction, code validator, …)
packages/widget-runtime  the WidgetAI prelude injected around generated code
apps/extension           MV3: background (main + typed bus + platform wrappers + modules), content, page probe, panel
apps/backend             Fastify: plugins (auth, tracing, errors), llm/callModel (+ llm_calls log), store (sqlite), modules
fixtures/                gmail, gmail2, youtube, net — fixture sites served by the backend
tests/                   e2e (Playwright, real Chromium + extension), tools (live-LLM drivers)
```

Every module has a README. Every LLM call goes through `callModel` with a named stage and is logged to sqlite
`llm_calls`; every extension message is validated and logged by the bus. Both are visible in the panel's Inspector.

## Quick start

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run build                 # extension → apps/extension/dist
npm run dev:backend           # http://127.0.0.1:8787 (serves fixtures too)
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist` → on its details page
enable **Allow User Scripts**. Click the toolbar icon to open the panel. Try `http://127.0.0.1:8787/fixture-g2/index.html`.

## Tests

```bash
npm run typecheck
npm run test:unit
cd tests/e2e && npx playwright test     # mock LLM; builds the extension for E2E_PORT (default 8787)
```

## Environment variables

See `.env.example`: `LLM_PROVIDER` (`anthropic` | `mock`), `ANTHROPIC_API_KEY`, `LLM_MODEL_GENERATION`
(default `claude-opus-5-5`), `LLM_MODEL_INFERENCE` (`claude-sonnet-5-5`), `LLM_MODEL_FAST` (`claude-haiku-5-5`),
`BACKEND_PORT`, `EXTENSION_AUTH_TOKEN`, `DATA_DB_PATH`.

## Known limitations

- Chrome ≥138 requires the per-extension "Allow User Scripts" toggle.
- Widgets can't read page JS globals (isolated USER_SCRIPT world) — DOM-only verification.
- Dev token auth + install-id user identity — hackathon grade.
- Generated code is powerful by design: every version must be approved; review it before running.

## Docs

- `docs/next-gen-architecture.md` — the design; `docs/devin-orchestration.md` — build plan; `docs/PROGRESS.md` — status + evidence
- MVP-era docs: `docs/architecture.md`, `docs/feasibility.md`, `docs/handoff.md`, `docs/network-observation.md`,
  `docs/manual-test.md`, `docs/gmail-selectors.md`
