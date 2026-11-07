# Implementation plan — what was built, in what order, and how to verify

This repo is the result of executing this plan. The plan is written so a
second agent (Devin Cloud or human) can reproduce/extend it.

## Milestone status

| # | Milestone | Status | Evidence |
|---|-----------|--------|----------|
| 1 | userScripts feasibility spike | ✅ done | `poc/run.mjs` — execute/register/messaging/CSP/isolation all pass |
| 2 | Backend: generate + inference | ✅ done | `apps/backend`, unit tests 6/6, live Anthropic run verified |
| 3 | Extension chat → generate → validate → run | ✅ done | side panel → SW → userScripts.execute, E2E green |
| 4 | Gmail-like fixture automation | ✅ done | `tests/e2e/widget.spec.ts` — 2 drafts, 0 sent |
| 5 | Real Gmail | ⏳ manual | needs a logged-in session — see `docs/manual-test.md` |
| 6 | Stability/polish | 🔶 partial | retry loop, statuses, cleanup, logs done; repair loop deferred |

## Repo layout (as built)

```
neohacks/
├── apps/
│   ├── extension/            MV3 extension (esbuild → dist/)
│   │   ├── manifest.json     userScripts/tabs/sidePanel/storage + <all_urls>
│   │   ├── build.mjs         esbuild: sw.js, content.js, sidepanel.js/html
│   │   └── src/
│   │       ├── background/sw.ts        orchestrator + onUserScriptMessage
│   │       ├── background/matchPattern.ts
│   │       ├── content/context.ts      PageContext extractor
│   │       ├── runtime/widgetSource.ts prelude + code assembly + cleanup
│   │       └── sidepanel/              React chat (index.html + main.tsx)
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts                Fastify + auth hook + static fixtures
│   │       ├── config.ts
│   │       ├── llm/                    provider.ts, anthropic.ts, openai.ts,
│   │       │                           mock.ts + mockdata.ts
│   │       ├── generation/prompt.ts    WIDGET_SYSTEM_PROMPT + context render
│   │       ├── generation/parse.ts     JSON extract + validation + acorn
│   │       └── routes/generate.ts      generation + retry-with-feedback
│   │           routes/inference.ts     inference + caps + token bucket
│   ├── fixture-gmail/        SPA: inbox/unread rows/msg view/composer/drafts
│   └── fixture-youtube/      SPA: comments page (generality proof)
├── packages/shared/src/index.ts   ALL contracts (single source of truth)
├── tests/e2e/                Playwright: helpers.ts + 2 specs + config
├── tests/tools/              manual debug/live scripts (tsx)
├── poc/                      feasibility spike (standalone, evidence)
└── docs/ AGENTS.md README.md
```

## Contracts (authoritative in `packages/shared/src/index.ts`)

- `GeneratedWidget` — `{name, description, matchPatterns[], grants[],
  code, insertionHint?}` — what the LLM returns.
- `WidgetRecord` — widget + `{id, version, origin, status, createdAt}`.
- `PageContext` — `{url, origin, title, landmarks[], insertionCandidates[],
  interactive[], textSample, domSkeleton?}`.
- `PanelToSW` / `SWToPanel` — side-panel messaging.
- `UserScriptMsg` / `UserScriptReply` — generated-code messaging
  (`WIDGET_INFERENCE`, `WIDGET_STORAGE`, `WIDGET_LOG`, `WIDGET_STATUS`).
- `LIMITS` — prompt/context caps, timeouts, rate limits.

## Generation pipeline

1. `buildGenerationUserPrompt` renders context → landmarks list, insertion
   candidates, interactive elements, DOM skeleton, text sample, request.
2. Model returns strict JSON → `parseGeneratedWidget`:
   strip fences → JSON.parse → field checks → grant whitelist →
   banned-construct denylist → non-standard-selector check → acorn parse.
3. On failure: one retry with `{prior: {code, error}}` appended to the prompt.
4. Validated widget returned to extension.

## Execution pipeline (the verified path)

```
RUN_WIDGET
  → findTargetTab(matchPatterns)          // active http(s) tab that matches
  → chrome.userScripts.configureWorld({worldId: w.id, messaging: true})
  → chrome.userScripts.execute({
      target: {tabId}, world:'USER_SCRIPT', worldId: w.id,
      js: [{code: buildWidgetSource(w)}], injectImmediately: true })
  → InjectionResult[0].error → failed; else running (widget reports the rest)
```

`buildWidgetSource` = prelude (WidgetAI impl over sendMessage, grant-gated)
+ `WIDGET_META` + generated `code`, inside `(async()=>{...})().catch(report)`.

## Acceptance criteria & tests

- `npm run test:unit -w apps/backend` — parse/validation (6 tests)
- `npm run test:unit -w apps/extension` — matchPattern (4 tests)
- `cd tests/e2e && npx playwright test` — 2 E2E:
  - Gmail fixture: 2 drafts w/ correct bodies on correct threads, `__sent`
    empty, status `completed`, host SPA functional, native-toolbar insertion
  - YouTube fixture: different site/request/widget — inference result rendered
- Live path: `LLM_PROVIDER=anthropic npm run dev:backend` + `tests/tools/live.mjs`

## What to do when blocked (priority order)

1. `chrome.userScripts` undefined → toggle not enabled → run
   `enableToggles` flow (helpers.ts) or flip it manually; restart needed.
2. Generation 422 → backend logs the parse error; retry loop already ran —
   check `warnings`, tighten the prompt or context extraction.
3. Widget injects but does nothing → check panel log (WidgetAI.log) →
   usually a selector assumption; the fix is prompt/context, not platform.
4. "origin not allowed" → widget matchPatterns vs sender.tab.url mismatch —
   check `matchPattern.ts` port handling.
5. Messaging silent → `configureWorld({worldId, messaging:true})` must run
   BEFORE execute in that worldId.
