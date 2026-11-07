# Agent notes

## Commands
- `npm install` — install all workspaces (run once)
- `npm run build` — build shared + extension + backend
- `npm run build:extension` — shared + extension only → `apps/extension/dist`
- `npm run dev:backend` — start backend on :8787 (tsx watch, auto-reload)
- `npm test` / `cd tests/e2e && npx playwright test` — E2E (spawns mock backend itself; requires :8787 free)
- `npm run test:unit -w apps/backend` / `-w apps/extension` — node:test unit tests
- `npm run typecheck` — tsc --noEmit across packages

## Env
- Copy `.env.example` → `.env`. `LLM_PROVIDER=mock` for deterministic tests, `anthropic` for live.
- Extension compile-time config: `BACKEND_URL`, `EXTENSION_AUTH_TOKEN` env at `npm run build:extension` time.

## Key constraints learned
- `chrome.userScripts` needs per-extension "Allow User Scripts" toggle (Chrome ≥138). Tests automate it via chrome://extensions UI (tests/e2e/helpers.ts).
- USER_SCRIPT world shares DOM but NOT page JS globals — widget code must verify via DOM, never `window.__x` page state.
- Playwright `page.evaluate` callbacks must be strings in helpers (esbuild `__name` wrapper breaks function literals).
- Only standard CSS selectors in generated code (`:has-text` etc. are rejected server-side).
- Branded Chrome won't `--load-extension`; tests use Playwright bundled `chromium` channel.

## Testing tools (tests/tools/)
- `live.mjs` — live-LLM run against a fixture: `TARGET_URL=<fixture> npx tsx live.mjs`
- `gmail-live.mjs` — real-Gmail driver, persistent profile in .gmail-profile
- `record-demo.mjs` — headed recording of the g2 workflow (needs mock backend)
