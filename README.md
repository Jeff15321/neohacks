# Widget AI — natural-language website widgets

Describe a feature for the site you're on; an LLM writes a real JavaScript
userscript that modifies the page — new buttons, panels, workflows — and calls
back through a shared, key-protected AI inference API.

> "Add a button that reads my two most recent unread emails and writes a
> friendly AI-generated reply draft for each." → a real toolbar button that
> does exactly that.

Also watches the page's own API calls: a MAIN-world probe captures
fetch/XHR traffic (with bodies), correlates it to your clicks, feeds it into
generation, and lets widgets replay captured operations via a grant-gated
`WidgetAI.net` API — draft/save actions without clicking through the UI.
Details: `docs/network-observation.md`.

Built for a hackathon. Architecture and browser-feasibility evidence:
`docs/`. Inspired by Tweeks (tweeks.io), adapted to `chrome.userScripts`.

## Tech stack

- **Extension**: MV3, TypeScript, React side panel, esbuild → `apps/extension`
- **Backend**: Fastify + Anthropic/OpenAI/mock providers → `apps/backend`
- **Execution**: `chrome.userScripts.execute()` (Chrome ≥135), isolated
  USER_SCRIPT world per widget (`worldId`), messaging via
  `runtime.onUserScriptMessage`
- **Tests**: Playwright (real Chromium + real extension) + `node:test` units

## Quick start

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY
npm run build                 # shared + extension + backend
npm run dev:backend           # http://127.0.0.1:8787 (serves fixtures too)
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/dist` → on its details page enable **Allow User Scripts**.
Click the toolbar icon to open the panel.

Try it on the fixture first: `http://127.0.0.1:8787/fixture/index.html`.

## Tests

```bash
npm run test:unit -w apps/backend     # generation validator
npm run test:unit -w apps/extension   # match patterns
cd tests/e2e && npx playwright test   # full E2E (auto-mock LLM, ~6s)
```

E2E exercises the REAL pipeline: extension loads in Chromium, userScripts
toggle is enabled via the chrome://extensions UI, a widget is generated,
reviewed, executed — two drafts are created on a Gmail-shaped fixture and
nothing is sent. A second spec runs a different widget on a YouTube-shaped
fixture to prove nothing is Gmail-specific.

## Environment variables

See `.env.example`: `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`LLM_GENERATION_MODEL`, `LLM_INFERENCE_MODEL`, `BACKEND_PORT`,
`EXTENSION_AUTH_TOKEN`.

## Known limitations

- Chrome ≥138 requires the per-extension "Allow User Scripts" toggle.
- Generated selectors can be brittle on heavily obfuscated SPAs; the retry
  loop and prompt mitigate, a repair loop is deferred (P2).
- Widgets can't read page JS globals (isolated world) — DOM-only verification.
- Dev token auth, in-memory rate limits, local-only persistence — MVP scale.
- Generated code is powerful by design: review it before running. See
  `docs/feasibility.md` §8 for the honest security posture.

## Docs

- `docs/architecture.md` — system design + tradeoffs
- `docs/feasibility.md` — verified claims, browser constraints, Tweeks findings
- `docs/implementation-plan.md` — milestones, contracts, debugging guide
- `docs/devin-task.md` — autonomous-agent task definition
- `docs/manual-test.md` — real Gmail walkthrough
- `docs/gmail-selectors.md` — Gmail DOM field guide
- `docs/demo.webm` — recorded run: request → generated widget → 2 drafts
- `tests/tools/gmail-live.mjs` — near-push-button real-Gmail driver (persistent profile)
- `poc/` — the standalone feasibility spike that de-risked the architecture
