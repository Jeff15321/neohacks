# Agent notes

## Layout (next-gen, branch `nextgen`; MVP reference = tag `mvp-final`, read with `git show mvp-final:<path>`)
- `packages/contracts` (zod schemas + types for every boundary; messages split per domain in `src/messages/<domain>.ts`),
  `packages/core` (pure logic), `packages/widget-runtime` (WidgetAI prelude, one file per section).
- `apps/extension/src/{background/{main,bus}.ts, background/platform, background/modules/<m>, content, page, panel}`.
- `apps/backend/src/{server.ts, plugins, llm/callModel.ts, store/db.ts, modules/<m>, fixtures}`.
- `fixtures/` (gmail, gmail2, youtube, net), served by the backend at `/fixture/`, `/fixture-g2/`, `/fixture-yt/`, `/fixture-net/`.
- Packages are consumed as TS source (`exports: ./src/index.ts`, subpaths `./*` → `./src/*.ts`) — no package build step.

## Commands
- `npm install` — install all workspaces (run once; each git worktree needs its own `npm install`)
- `npm run build` — build the extension → `apps/extension/dist` (env `BACKEND_URL`, `EXTENSION_AUTH_TOKEN`)
- `npm run dev:backend` — backend on :8787 (tsx watch). `npm run start -w apps/backend` — no watch.
- `npm run typecheck` — tsc --noEmit across all packages
- `npm run test:unit` — node:test (core, widget-runtime, backend, extension)
- `cd tests/e2e && npx playwright test` — E2E; globalSetup rebuilds the extension for `E2E_PORT` (default 8787) and
  spawns a mock backend on it. Use a distinct `E2E_PORT` per worktree to run suites in parallel.

## Env
- Copy `.env.example` → `.env`. `LLM_PROVIDER=mock` for deterministic tests, `anthropic` for live.
- Models: `LLM_MODEL_GENERATION` (claude-opus-5-5), `LLM_MODEL_INFERENCE` (claude-sonnet-5-5), `LLM_MODEL_FAST`
  (claude-haiku-5-5). The MVP vars `LLM_GENERATION_MODEL`/`LLM_INFERENCE_MODEL` are ignored on purpose.
- `DATA_DB_PATH` sqlite path (default `.data/store.db`; `:memory:` in tests).

## Key constraints learned
- Network capture lives in `src/page/netprobe.ts` — manifest content script with `world:"MAIN"` +
  `run_at:document_start` (MUST inject before page JS). Keep its imports tiny (`@app/contracts/limits`,
  `@app/core/net/invoke` — never the package roots, which pull zod/acorn into every page).
- Probe posts records to its OWN frame window; `content.js` runs in all frames and relays. Replays go to frameId 0.
  Only `confirmed` (webRequest-matched) records are replayable. Summaries leaving the SW are redacted.
- netprobe hello (document_start) predates content.js (document_idle) — the content script pings the probe on load.
- Gesture dedupe must not throttle different targets — fast UIs/tests fire back-to-back actions within ms.
- `chrome.userScripts` needs per-extension "Allow User Scripts" toggle (Chrome ≥138). Tests automate it via chrome://extensions UI (tests/e2e/helpers.ts).
- USER_SCRIPT world shares DOM but NOT page JS globals — widget code must verify via DOM, never `window.__x` page state.
- Playwright `evaluate` callbacks must be strings in helpers (esbuild `__name` wrapper breaks function literals).
- Only standard CSS selectors in generated code (`:has-text` etc. are rejected server-side).
- Branded Chrome won't `--load-extension`; tests use Playwright bundled `chromium` channel.
- Current Claude models reject `temperature`; use `output_config.effort` / `output_config.format` (SDK ≥1.3).
  Opus 5.5 widget generation at effort `high` takes ~2–3 min live (≈18k output tokens) — live tools wait 300 s.
- Panel messages always carry an envelope `traceId`; never name a payload field `traceId` (use e.g. `filterTraceId`).
- Every installed widget must be `approved`; repair/edit creates a new version that needs approval again.
- Bus debugging: `globalThis.__wwaBus.log.list()` in the SW (tests use `busLog(sw)`).

## Testing tools (tests/tools/)
- `live.mjs` — live-LLM run against a fixture: `TARGET_URL=<fixture> npx tsx live.mjs` (backend with LLM_PROVIDER=anthropic on :8787)
- `net-live.mjs` — live-LLM run of the network pipeline on the NetMail fixture
- `site-netprobe.mjs` — capture/replay probe on ANY site: `TARGET=<url> [CLICK=<sel>] [REPLAY=1] npx tsx site-netprobe.mjs`
- `gmail-live.mjs` — real-Gmail driver, persistent profile in .gmail-profile
- `gmail-netprobe.mjs` — capture-only probe on real Gmail (needs signed-in profile; Google may block automated sign-in)
- `record-demo.mjs` — headed recording of the g2 workflow (needs mock backend)
- `data-live.mjs` — live-LLM run of the WidgetAI.db save/list flow on the movies fixture
