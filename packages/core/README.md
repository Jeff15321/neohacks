# @app/core

Pure logic. **Zero `chrome.*` / node / fastify imports** → unit-testable in node (`node:test` via tsx).
Depends only on `@app/contracts` and `acorn`.

| File | What | Owner |
|---|---|---|
| `match-pattern.ts` | Chrome match pattern → RegExp, `matchesAny` | 0 |
| `net/invoke.ts` | replay request building (`mergeBody`, header stripping, same-origin) | 0 (ported) |
| `net/netlog.ts` | per-tab NetLog: gesture correlation, **webRequest confirmation**, redacted summaries | 0 (ported + §4.1b) |
| `redact.ts` | header/body/token redaction before anything leaves the extension | 0 (§4.1c) |
| `validate-code.ts` | denylist + non-standard-selector + acorn syntax check for generated JS | 0 (ported from backend parse.ts) |
| `util.ts` | `randomId`, `newTraceId`, `Ring` | 0 |
| `settle.ts`, `locators.ts`, `lineage.ts` | Steps (stubs) | B |
| `danger.ts` | runtime danger classifier (stub) | C |
| `activity.ts`, `suggest.ts`, `job-machine.ts` | activity reducer, suggestion gating, jobs (stubs) | D |
| `op-analysis.ts` | route templates, token fields, dependencies (stub) | E |
| `flow-machine.ts` | flow run state machine (stub) | F |

Test: `npm run test:unit -w packages/core`.
