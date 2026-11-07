# Phase E — Network upgrades (attribution, op analysis, verification tiers)

## HANDOFF
- Branch `phase-e` (from `nextgen`), worktree `.worktrees/phase-e`, E2E port 8804.
- State: all of doc §4 items 2–5 implemented; full gate green; live Opus run 1/1 verified (see Phase report).
- If continuing: optional extras are listed under "Not implemented".

## Phase report
### Phase E — Network upgrades — DONE

**Implemented** (mapped to `docs/next-gen-architecture.md` §4 / §8 Phase 6):
- §4 item 2 **Step attribution** →
  - `packages/contracts/src/net.ts`: `NetRequestRecord.stepId`; `NetOpSummary.stepId` + `attribution: 'step'|'window'`.
  - `apps/extension/src/content/netbridge/index.ts`: new export `netAttribution.setStepProvider(fn)` for Phase B's Step
    recorder. Gestures carry the provider's current `stepId` (resolved after the event's other capture listeners);
    requests are stamped with the step open at their probe `start` event. The stepId is stamped in the isolated world —
    a page-posted `stepId` is deleted. `netActivity` API unchanged.
  - `packages/core/src/net/netlog.ts` `correlate`: record stepId → latest gesture of that step (primary), else the 6 s
    window (fallback). `addRecord` now always correlates SW-side (a page-supplied `trigger` is ignored).
- §4 cross-check coverage (optional item) → `NetLog.browserOnly()`: webRequest xhr/ping completions with no probe
  record (worker / pre-document_start requests) returned by `GET_NET_OPS` as `browserOnly` and listed in the Inspector
  as "Browser-seen only (no body, not replayable)". `WebRequestSeen.type` added (platform passes `d.type`).
- §4 item 3 **Op analysis** → `packages/core/src/op-analysis.ts` (pure, unit-tested), attached to every summary as
  `analysis` (`NetOpAnalysis` in contracts; field names/paths only — never raw values):
  - route templates (`/repos/:repo/:repo2/issues/:n`, `/api/messages/:message`): id-shaped segments + variance across
    captures of the same method/origin; different resources (`/api/drafts` vs `/api/messages`) never merge;
  - `tokenFields` (secret-named via the redaction regexes, high-entropy, or opaque values that differ across captures)
    vs `paramFields` (human values that differ);
  - `dependsOn` `{field, opId, fromTemplate, path}`: a token/opaque request value (body/header/query) that appeared in
    the most recent EARLIER response (JSON path or `header:<name>`);
  - idempotency: `clientIdFields` (clientMutationId/request_id/nonce/idempotency-key/uuid-valued) + `idempotencyHint`
    for every mutating op.
- §4 item 4 **Verification tiers** → `NetLog` tiers keyed `${origin} ${METHOD} ${template}` (persisted in
  `storage.session` `wwa_net_tiers`): `observed` → `replayed` (`NetService.replay` — panel Replay or widget invoke,
  no url/method override — got 2xx with a similar response shape: JSON key-set Jaccard ≥ 0.5) → `verified`
  (`WidgetAI.net.reportVerified(opId, evidence)` → new user-script message `WIDGET_NET_REPORT_VERIFIED`, grant
  `network`; accepted only for confirmed ops whose template is already `replayed`; never throws — resolves
  `{verified, tier, error?}` so widgets can branch to their DOM fallback). Never demotes. Nothing auto-probes
  (mutating ops are exercised only by the user's Replay click or an approved widget run). Tier + evidence shown on
  every op (summary `tier`, `tierEvidence`) in the Inspector, to widgets, and to the generator.
- §4 item 5 **Generator strategy rule** → `apps/backend/src/modules/generate/prompts/sections/network.ts`: op
  analysis fields, dependency re-fetch recipe (GET only, raw `bodyText`, mergeBody/headers/query), idempotency, tiers,
  `reportVerified`, NETWORK / DOM (opaque/positional, Gmail-class) / HYBRID rule, mandatory DOM fallback for
  network-first code. `renderNetOpAnalysis()` renders tier/step/template/tokens/dependsOn per op in the user prompt.
- Fixture → rotating single-use CSRF: `GET /fixture-api/csrf` issues a fresh token (invalidates the previous one);
  `POST /fixture-api/drafts` requires the latest one (body `csrf` or header `x-csrf-token`), else 403;
  `GET /fixture-api/__csrf-stats` (test hook). NetMail's Save fetches a fresh token before every save.
- Mock net widget (`MOCK_WIDGET_CODE_NET`): finds the confirmed draft op → follows `analysis.dependsOn` to the GET csrf
  op → re-fetches it via `invoke` → replays the POST with `mergeBody {…, csrf: fresh}` → read-back
  `GET /fixture-api/drafts` → `reportVerified`; DOM fallback (compose UI) if the network path fails before anything
  was created.
- Panel Inspector `NetworkPane`: tier badge (`data-testid="net-tier"`), analysis block (`net-analysis`: template,
  captures, step/attribution, tokens, params, depends, idempotency, tier evidence), browser-only list.

**Not implemented / descoped:**
- Auto-probing GET ops during generation (doc: "may") — not built; GET csrf-style endpoints can have side effects
  (rotation), so promotion to `replayed` happens only via user Replay / widget runs.
- The Step recorder itself (Phase B) — only the attribution plumbing; until B calls `netAttribution.setStepProvider`,
  every op is attributed by `window`.
- CDP deep capture / WebSocket patch (doc §4 stretch rows).

**Evidence the phase is correct:**
- `npm run typecheck` → 0 errors.
- `npm run test:unit` → core 36/0 (12 new in `op-analysis.test.ts`: templates, token/param fields, dependency
  inference incl. JSON paths + response headers + "not from a later response", no raw values in analysis,
  idempotency, tier logic, NetLog tiers + refusal paths + snapshot/hydrate, redaction kept, step attribution,
  browserOnly), widget-runtime 3/0 (reportVerified), backend 12/0 (3 new: strategy section, op-analysis rendering,
  mock net widget passes the validator), extension 4/0 → 55 passed, 0 failed.
- `cd tests/e2e && E2E_PORT=8804 npx playwright test --reporter=line` → 4 passed (16.8 s): widget, gmail2, youtube, net.
  Flake check: `net.spec.ts --repeat-each=3` → 3 passed (12.0 s).
- `net.spec.ts` key assertions (all Phase 0 assertions kept): real POST confirmed + correlated to "Save draft";
  forged record unconfirmed and `NET_REPLAY` refused; analysis `POST /fixture-api/drafts`, `tokenFields ⊇ body.csrf`,
  `dependsOn body.csrf ← GET /fixture-api/csrf .token` (opId resolves to the csrf op), summary body shows
  `"csrf":"[REDACTED]"`, attribution `window`, tier `observed`; **stale replay** via `NET_REPLAY` → HTTP 403
  `stale csrf`, `ok:false`, server csrf rejections = 1, still 1 draft, tier stays `observed`; widget run → 2 drafts
  server-side (manual + replayed), 0 sent, csrf rejections still 1 (widget used a fresh token), bus log: exactly 1
  `WIDGET_NET_REPORT_VERIFIED` (ok) and 2 `WIDGET_NET_INVOKE` (csrf re-fetch + draft replay); `GET_NET_OPS` draft
  tier `verified` with evidence containing "API-authored draft", csrf GET tier `replayed`; Inspector row shows
  `verified` and `depends: body.csrf ← GET /fixture-api/csrf .token`.
- Live (Anthropic, own backend on :8804, `E2E_PORT=8804 npx tsx tests/tools/net-live.mjs`) → 1/1 first try: Opus 5.5
  widget "Live API Test Draft" (generation trace `t_cyzx6hdmp2wg`, 90.8 s) followed `analysis.dependsOn` to the captured
  `GET /fixture-api/csrf`, re-fetched it via `invoke`, replayed the save with `mergeBody {…, csrf}` → 201, read back the
  drafts list, `reportVerified` → tier `verified`; it also wrote a DOM fallback (compose form) guarded against duplicates.
  Server: 2 drafts (manual + "Live API test"), 0 CSRF rejections, 0 sent. Final tiers: `POST /fixture-api/drafts verified`,
  `GET /fixture-api/csrf replayed`, others `observed`.
- Artifacts: `docs/evidence/E/inspector-tiers.png` (Inspector after the E2E run), `docs/evidence/E/live-net.log`
  (live run incl. generated code).

**How to verify it yourself (≤5 min):**
1. `npm run test:unit -w packages/core` → 36 pass.
2. `cd tests/e2e && E2E_PORT=8804 npx playwright test net.spec.ts --reporter=line` → 1 passed; log lines
   `[e2e-net] analysis: …dependsOn…`, `stale-token replay → 403`, `tier = verified`.
3. Open `docs/evidence/E/inspector-tiers.png` — the POST /fixture-api/drafts row carries a green `verified` badge.

**Known issues:**
- Tiers are keyed per origin+template and kept in `storage.session` (cleared on browser restart) — by design for now.
- Dependency inference matches exact values only (no substring/base64/JWT-claim matches); a token reused from
  page HTML (meta tag) rather than a response is reported as a token field without `dependsOn`.
- Template variable naming is heuristic (`/repos/:repo/:repo2/…` rather than `:owner/:repo`).

## Decisions (made without the human)
- 13:05 — Analyses + tiers travel inside `NetOpSummary` (`analysis`, `tier`, …) instead of a new PageContext field —
  `PageContext.networkOps` already carries summaries, so `contracts/page.ts` is untouched — rejected: a parallel
  `networkAnalyses` array keyed by op id.
- 13:05 — `reportVerified` requires the template to be `replayed` first (platform-observed 2xx + similar shape) and
  never throws (returns `{verified:false, error}`) — keeps the tier honest and lets widgets fall back to DOM —
  rejected: trusting the widget's claim alone.
- 13:05 — Tier promotion only for replays without url/method overrides (otherwise it's a different endpoint).
- 13:05 — Step attribution via a provider hook in `content/netbridge` (`netAttribution.setStepProvider`) rather than a
  new bus message — B's recorder lives in the same content script; zero coupling to `content/steps`.
- 13:05 — `addRecord` now ignores a page-supplied `trigger` (always SW-side correlation) — the page could forge
  attribution text (prompt-injection vector, same rationale as §4 1b).
- 13:05 — CSRF token carried in the JSON body (`csrf`) by the NetMail UI (server also accepts `x-csrf-token`) so the
  widget exercises `mergeBody`; token format `c` + 32 hex.
- 13:15 — `tests/tools/net-live.mjs` now uses `BASE`/`E2E_PORT` and the e2e helpers (`openPanel`/`generate`/
  `approveFirst`; the old `#req` flow broke on the tabbed panel) and prints CSRF rejections + tiers.
- 13:05 — No GET auto-probing (doc says "may"): the rotating-CSRF fixture shows GETs can have side effects.

## Stuck log
(none)
