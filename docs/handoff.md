# Handoff — AI Website Widget Builder (state as of 2026-11-07)

Repo: https://github.com/Jeff15321/neohacks · PR #1 (branch `mvp`, ~7 commits).
Everything below is empirically verified unless marked "unverified".

## Product intent (the north star)

An AI-powered extension that lets ANY user extend ANY website with real,
functional, AI-generated UI — "add a button to Gmail that drafts replies to
my 2 recent unread emails", "group this YouTube video's comments into
topics", "extract this Amazon product's specs into a compare panel".

- The platform is an EXECUTION ENVIRONMENT for generated website logic —
  never a registry of per-site hardcoded tools (that would defeat the core
  hypothesis: arbitrary capability from natural language).
- Widgets are genuine generated JS: their own UI, own DOM traversal, own
  workflow logic — calling only GENERIC platform APIs (inference, storage,
  log, future: network).
- Preferred UX: modify the site's native layout (toolbar button, panel beside
  content), not a floating dock; dock is fallback.
- Safety contract: user reviews code before run; draft-only, never
  send/delete/purchase; origin-scoped; keys server-side.
- Demo target: compelling end-to-end Gmail draft workflow + proof the same
  machinery generalizes (YouTube/Amazon), not production polish.

## What it is

Chrome MV3 extension + Fastify backend. User types a natural-language request
on any website → backend LLM returns a structured `GeneratedWidget` (name,
matchPatterns, grants, **raw generated JS**) → extension executes it in the
page via `chrome.userScripts.execute()` (USER_SCRIPT world, per-widget
`worldId`). The widget builds its own Shadow-DOM UI and drives the page by
DOM events. `WidgetAI.inference()` routes LLM calls through the service
worker → `/api/inference` → Anthropic — API keys never touch generated code.
NO per-site hardcoded automations; all site logic is generated.

## Verified capabilities (with evidence)

- `chrome.userScripts.execute/register/configureWorld/onUserScriptMessage` all
  work on Chromium 156–158, headless (`poc/run.mjs` — re-runnable).
- USER_SCRIPT world: DOM shared, page JS globals NOT visible, page-CSP exempt.
- E2E: 3 Playwright specs green — real extension + real userScripts path.
  Mock-LLM Gmail fixture (2 drafts / 0 sent), Gmail-realistic obfuscated
  fixture, YouTube comment analyzer. `cd tests/e2e && npx playwright test`.
- Unit: 10 tests (JSON/denylist/acorn validator, matchPattern incl. ports).
- **Live Anthropic generation: ~6/7 successful runs** against the
  Gmail-realistic fixture; produced personalized drafts end-to-end.
- **Real Gmail: full workflow completed** — injected button, found `tr.zA.zE`
  unread rows, opened threads, extracted body, called inference, clicked
  Gmail's actual Reply affordance, filled the contenteditable composer,
  drafts autosaved. Nothing sent. Took ~4 code iterations (see below).
- Iterative editing works: per-widget Edit input feeds
  code+error+feedback+fresh context back through generation (`prior` field).

## Critical browser facts (cost us real time)

- Chrome ≥138: `chrome.userScripts` is `undefined` until per-extension
  "Allow User Scripts" toggle (`chrome://extensions/?id=`) — NOT just dev mode.
  API binds at context creation → restart SW/browser after toggling.
  Pref-seeding Secure Preferences fails; automating the toggle by clicking
  shadow-DOM `cr-toggle`s on chrome://extensions works (helpers.ts).
- Branded Chrome removed `--load-extension`; Playwright must use bundled
  `channel: 'chromium'`. Match patterns ignore ports (we allow `(:port)?`).
- `chrome.scripting.executeScript` CANNOT run generated strings (func must be
  packaged, eval/new Function CSP-blocked). userScripts is the only MV3 path.
- Chrome 135+ for `execute()`; 133+ for `worldId`.

## What generated widgets got wrong on real Gmail (and fixes applied)

1. Waited on invented selectors for post-click views (`.message-view` —
   actual: `.adn.ads`). → prompt: never invent classes; use discovery pattern.
2. jQuery-style `:has-text()` — invalid. → validator rejects non-standard
   pseudos + retry loop feeds error back.
3. `waitForViewChange` resolved instantly: `[aria-label*="Compose"]` exists
   on every Gmail view → pre-existing affordances aren't change evidence.
4. Reply finder matched `/reply/` in container subtree text → clicked wrong
   element. Gmail's Reply = `span.ams.bkH[role=link]`, NOT a `<button>`.
   → prompt: broad affordance set, trim/exact match, scope to thread.
5. Reply opens composer **inside the same view, sometimes collapsed** — no
   navigation, no detach. → waits must target the element needed, not an
   abstract "view changed".
6. Reading page globals (`window.__drafts`) for verification — invisible in
   isolated world. → DOM-only verification (toast, counts, `.draft-saved`).
7. unread→read list shrink: positional index skips items → snapshot stable
   keys (`data-legacy-message-id`) and re-find per iteration.
8. Honest-status discipline: earlier widgets claimed success on partial work.

**Systemic fix now in the prompt**: transition waits log-and-continue (never
throw); only target-element waits may fail; on failure dump a ~500-char view
skeleton into the log as repair evidence. See `generation/prompt.ts`.

## Current loop + known accuracy ceiling

context → generate → validate (denylist/acorn) → retry×1 → approve → execute
→ widget reports → optional Auto-fix/Edit (code+error+feedback re-generated).

First-try accuracy on a hostile SPA is weak (~1 in 3-4 iterations); it
converges because failures are post-interaction DOM the model never sees.
**Highest-leverage improvement (agreed direction): probe-then-generate** —
stage A generates a cheap probe (click row → dump skeleton → click reply →
dump skeleton), run it, stage B writes final code with REAL post-interaction
DOM. Turns guesses into informed code. Secondary: auto-repair on runtime
fail with evidence; optional screenshot context; network grant +
`WidgetAI.fetch` proxy (remote fetch currently denylisted).

## Security posture (MVP, honest)

Grant-gated WidgetAI surface; origin check per message vs matchPatterns;
approve-and-review gate; banned constructs (`eval`, `new Function`, cookie,
XHR, remote fetch); prompt hard-ban on send/delete/purchase (fixture asserts
`__sent` empty); backend shared token + caps (10k/50k) + token-bucket;
page text treated as untrusted data in inference prompts. Arbitrary code on
private pages is inherently risky — documented in feasibility.md §8. Chrome
Web Store RHC policy would scrutinize this; it's a dev-mode build.

## Repo map

`apps/extension` (SW orchestrator, content context extractor, React panel,
esbuild) · `apps/backend` (generate+inference routes, provider abstraction
anthropic/openai/mock, prompt+validator) · `packages/shared` (contracts) ·
`apps/fixture-*` (3 SPAs) · `tests/e2e` (Playwright) · `tests/tools`
(`live.mjs` live-run, `gmail-live.mjs` real-Gmail driver) · `poc/` (spike) ·
`docs/` (architecture, feasibility, implementation-plan, devin-task,
manual-test, gmail-selectors, demo.webm).

## Open issues for the final implementation

1. Probe-then-generate pipeline (above).
2. Real Gmail: native toolbar mount works but Gmail re-renders can drop it;
   retry/regenerate acceptable. Draft-verification via "Draft saved" toast or
   Drafts count — model sometimes reports optimistically.
3. Widgets re-inject on page load via `register()` — needs idempotent roots.
4. No auth/multi-user; single dev token; local-only widget persistence.
5. Edit/Auto-fix quality depends on feedback specificity — a "probe on
   failure" step would feed better evidence automatically.
EOF
