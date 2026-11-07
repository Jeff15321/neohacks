# Task for Devin Cloud — AI Website Widget Builder

## Context

This repo implements an AI-powered Chrome extension that generates custom
website widgets from natural language: the user describes a feature on any
site, the backend LLM generates a real JavaScript userscript, and the
extension executes it in the page via `chrome.userScripts` (USER_SCRIPT
world). Widgets call a shared `WidgetAI.inference()` API routed through the
extension to the backend — no per-widget backend, no hardcoded site
automations.

The MVP is **already implemented and tested** (see docs/architecture.md,
docs/feasibility.md). Your job is to pick up from here: verify the build,
finish the remaining polish tasks, and extend toward real-Gmail support —
without breaking the core principle that widget behavior is *generated*, not
registered.

## Non-negotiable constraints

- DO NOT replace generated-code execution with predefined per-site tools
  (no `gmail.draftReplies()` registry). The platform provides only generic
  infrastructure (inference, storage, logging, execution).
- DO NOT commit `.env` or any API keys. The repo is public.
- DO NOT add heavy infra (DB, queues, Docker) without a concrete need.
- Keep `chrome.userScripts` as the execution mechanism; alternatives were
  evaluated and rejected (docs/feasibility.md §1).
- Every P0 E2E test must keep passing: `cd tests/e2e && npx playwright test`.

## Environment

- Node ≥20, npm workspaces. `npm install`, then `npm run build`.
- Backend: `.env` from `.env.example`; `LLM_PROVIDER=mock` for deterministic
  work, `anthropic` + key for live runs.
- Extension tests use Playwright `chromium` channel (headless OK). The
  "Allow User Scripts" toggle is auto-enabled by `tests/e2e/helpers.ts`.
- If your env cannot run headed/headless Chromium, run unit tests + backend
  integration tests and clearly report which verification you could not run.

## Work queue (in priority order)

1. **Verify the baseline.** `npm install && npm run build && npm run typecheck
   && npm run test:unit -w apps/backend && npm run test:unit -w apps/extension
   && cd tests/e2e && npx playwright test`. Report actual results.
2. **Repair loop (P2→P1).** On widget `failed` status, offer "Auto-fix": POST
   the code + error + fresh PageContext to `/api/generate-widget` using the
   existing `prior` field, present the new version for approval.
3. **Real-Gmail hardening.** Improve context extraction and generation prompt
   for Gmail-class pages (obfuscated classes → prefer aria-label/role/text
   selectors). Add a `docs/gmail-selectors.md` field guide from real DOM dumps
   if a session is available.
4. **Widget persistence option.** Re-run approved widgets across reloads via
   `chrome.userScripts.register()` (mechanism already proven in poc/).
5. **Status accuracy.** Widgets sometimes report 'completed' optimistically —
   strengthen the prompt + add an optional `verify` hint in the widget
   contract.
6. Docs: keep README/docs accurate to what you actually verified.

## Definition of done

- All existing tests pass; new features have tests where practical.
- `npm run typecheck` clean.
- Honest report of what was verified vs assumed in the PR description.
- Commit with clear messages; open a PR if GitHub is configured.
