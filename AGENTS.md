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
- Network capture lives in `src/net/probe.ts` — a manifest content script with
  `world:"MAIN"` + `run_at:document_start` (MUST inject before page JS). Built
  to `dist/netprobe.js` by build.mjs. Invoke replay relays SW → content.js →
  postMessage → probe → original fetch (page context, real cookies).
- netprobe hello (document_start) predates content.js (document_idle) — the
  content script pings the probe on load; don't rely on hello ordering.
- Gesture dedupe must not throttle different targets — fast UIs/tests fire
  back-to-back actions within ms.
- `chrome.userScripts` needs per-extension "Allow User Scripts" toggle (Chrome ≥138). Tests automate it via chrome://extensions UI (tests/e2e/helpers.ts).
- USER_SCRIPT world shares DOM but NOT page JS globals — widget code must verify via DOM, never `window.__x` page state.
- Playwright `page.evaluate` callbacks must be strings in helpers (esbuild `__name` wrapper breaks function literals).
- Only standard CSS selectors in generated code (`:has-text` etc. are rejected server-side).
- Branded Chrome won't `--load-extension`; tests use Playwright bundled `chromium` channel.

## Testing tools (tests/tools/)
- `live.mjs` — live-LLM run against a fixture: `TARGET_URL=<fixture> npx tsx live.mjs`
- `net-live.mjs` — live-LLM run of the network pipeline on the NetMail fixture
- `site-netprobe.mjs` — capture/replay probe on ANY site: `TARGET=<url> [CLICK=<sel>] [REPLAY=1] npx tsx site-netprobe.mjs`
- `gmail-live.mjs` — real-Gmail driver, persistent profile in .gmail-profile
- `gmail-netprobe.mjs` — capture-only probe on real Gmail (needs signed-in profile; Google may block automated sign-in)
- `record-demo.mjs` — headed recording of the g2 workflow (needs mock backend)
