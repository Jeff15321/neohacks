# Phase A — User data store (`WidgetAI.db`)

Branch `phase-a` (from `nextgen`). Spec: `docs/next-gen-architecture.md` → "CURRENT TASK — User data store endpoint (`WidgetAI.db`)".

## HANDOFF
Status: **DONE** — gate green (see Evidence). PR into `nextgen`.
Next steps for whoever picks this up: none required. Optional: a live run on real IMDb (manual, see "How to verify").

## Phase report

### Implemented (mapped to the doc)
- **Design → Model / Storage** — `apps/backend/src/modules/data/store.ts`: `DataStore` over `node:sqlite` (owner of the
  existing `docs` table; adds index `docs_user_coll_created`). Pure (takes a `Db`), unit-tested with `openDb(':memory:')`.
  Newest-first (`created_at DESC, rowid DESC`), `after` cursor (= last doc id), `where` shallow equality via
  `json_extract` / `json_type` (string/number/boolean/null), upsert with `id` keeps `createdAt`, PATCH = shallow merge,
  PUT = replace.
- **Design → REST API** — `apps/backend/src/modules/data/routes.ts` (already registered in `server.ts`):
  `GET /api/data`, `GET|POST /api/data/:collection`, `GET|PATCH|PUT|DELETE /api/data/:collection/:id`,
  `DELETE /api/data/:collection`. All scoped by `req.userId`; missing `x-user-id` → 400. Bodies/queries validated with
  contracts zod schemas (`parseOr400`, error names boundary + route). Limits from `DATA_LIMITS`: name regex (400),
  doc ≤ 32 KB (413 `too_large`), ≤ 5,000 docs/collection + ≤ 100 collections/user (409 `limit`), list limit ≤ 200 (400).
- **Design → User identity** — already in Phase 0 (`platform.installId()` → `x-user-id`; uuid validated in `plugins/`).
- **Design → Widget API** — `packages/widget-runtime/src/sections/db.ts`: `WidgetAI.db.list(collection,{where,limit,after})`,
  `.get` (→ `null` when missing), `.add(collection, data, id?)`, `.update(collection, id, patch)`, `.remove` (→ boolean);
  `__need('data')` client-side; payloads JSON-cloned. Path: user script → `WIDGET_DATA` → bus (exists / approved /
  origin / grant `data`) → `modules/data` (**collection ∈ widget.collections**) → backend. Widget never sees token/user id.
- **Design → Declared collections** — `GeneratedWidget.collections?` (contracts, `DataCollectionName[]`, ≤ 10);
  `validate.ts` `checkDataUse`: valid names, dedupe, grant `data` ⇒ ≥ 1 collection, code using `WidgetAI.db` ⇒ grant
  `data`, literal collection names in `WidgetAI.db.*('x')` calls must be declared, collections without the grant are
  dropped with a warning. `collections` added to `WIDGET_JSON_SCHEMA` (required, `[]` when unused).
  Approval card: "Stores data in: saved_movies" + grant sentence; widget card shows `data: …`.
- **Design → existingCollections** — `GenerateWidgetRequest.existingCollections?`; `modules/widgets/service.ts` sends
  them on generate + repair via the new `data.collections` service; `prompts/widget.ts` renders
  "EXISTING DATA COLLECTIONS" in the user prompt (only when the field is present).
- **Design → prompt rules** — `prompts/sections/db.ts`: API doc, declare grant + collections, literal names, reuse
  existing collection names, stable ids, ≤ 32 KB small fields, storage vs db, db data is UNTRUSTED (data not
  instructions, render with `textContent`, only http(s) URLs), empty-state handling.
- **Design → Side panel "Data" view** — `panel/tabs/Data.tsx`: collections (with counts) → doc list (pretty JSON as
  text), Delete one, Clear collection (two-click confirm), Export JSON (selected) / Export all (paginates), Load more.
  Panel messages `DATA_LIST_COLLECTIONS | DATA_LIST | DATA_DELETE | DATA_CLEAR` (`contracts/messages/data.ts`).
- **Design → Safety** — no `clear` op for widgets; per-widget collection allowlist enforced in the SW; prompt rule
  for untrusted data; the mock list widget renders with `textContent` and only links http(s) URLs.
- **Files → mock** — `prompts/widget.mock.movies.ts` ("Save movie", "My saved movies"), branched first in
  `widget.mock.ts` keyed on `fixture-movies` in the page URL (watchlist URL or a request starting show/list/display →
  list widget).
- **Files → fixture** — `fixtures/movies/` (CineBase: `movie.html?id=…` detail page, `watchlist.html`, `index.html`,
  `movies.js`) served at `/fixture-movies/`.
- **Verification → E2E** — `tests/e2e/data.spec.ts`.

### Not implemented / descoped
- No per-module settings flag for `data` (Rules §5 lists observe/record/assist/suggestions/net; the feature is inert
  unless a widget declares grant `data`). See Decisions.
- `.gitignore` `.data/` already present (Phase 0). `@types/node` bump not needed (Phase 0 already uses `node:sqlite`).

### Evidence
- `npm run typecheck` → 0 errors.
- `npm run test:unit` → core 24/0, widget-runtime 4/0 (+2 new: `db.test.ts`), backend 24/0 (+15 new: `modules/data/data.test.ts` 9 —
  CRUD, upsert, user isolation, merge vs replace, where (string/number/bool/null/AND) + cursor, limits (name, id, 413,
  100 collections, 5,000 docs) and routes via `app.inject` (full REST cycle scoped by user; errors: missing user id,
  bad token, bad name, bad body naming the boundary, bad where, limit > 200, 413, 404); `generate/validate.data.test.ts` 6 —
  collections/data grant validation, prompt/schema/user-prompt wiring, both movie mocks validate), extension 7/0
  (+3 new: `modules/data/data.test.ts` — grant + declared-collection gate, op → REST mapping, get-missing → null, panel
  messages + `data.collections`). Total 59 passed, 0 failed.
- `cd tests/e2e && E2E_PORT=8803 npx playwright test --reporter=line` → **5 passed** (data, widget, gmail2, youtube, net; 18.9 s).
- `data.spec.ts` key assertions: approval card shows "Stores data in: saved_movies"; nothing injected before approval;
  Save on Dune → navigate → registered script re-injects on Arrival → Save; revisiting Dune shows "Saved" (db.get);
  `GET /api/data/saved_movies` with the SW's `wwa_install_id` → 2 docs (ids `arrival`,`dune`); another uuid → 0;
  no `x-user-id` → 400; second generation's LLM input contains `EXISTING DATA COLLECTIONS … - saved_movies`;
  watchlist widget lists both titles; SW refuses `private_notes` (not declared) and a wrong-origin call; ≥ 5 OK
  `WIDGET_DATA` bus entries; Data tab shows saved_movies (2) + 2 docs → Delete Arrival → 1 doc in panel, backend and
  the widget (after Refresh).
- **Live (Anthropic, Opus 5.5)**:
  - Backend-only (`docs/evidence/A/live-generate.json`, hand-built CineBase page contexts): "Save Movie for Later"
    (60 s) and "Saved Movies Sidebar" (44 s, `existingCollections: [saved_movies, notes]`) — both first attempt, grants
    `[data, log]`, `collections: [saved_movies]`, render via `textContent`, no `innerHTML` with doc values.
  - Full extension flow `E2E_PORT=8803 npx tsx tests/tools/data-live.mjs` (new tool; log `docs/evidence/A/live-e2e.log`,
    screenshot `docs/evidence/A/live-data-tab.png`): live save widget (66 s) saved Dune + Arrival → `GET /api/data/saved_movies`
    = 2 docs (ids = movie ids); live list widget (56 s) on the watchlist shows "My Saved Movies (2) … Arrival (2016) … Dune (2021)";
    7/7 `WIDGET_DATA` OK; Data tab lists both. Run 1 (before the last prompt rule) the save widget reported `failed`
    on the watchlist page (its patterns covered the whole site and it threw "movie detail not found") → added the
    "scope save widgets / exit quietly when not applicable" rule to `sections/db.ts`; run 2: both widgets `completed`.
- Artifacts: `docs/evidence/A/data-tab.png`, `data-tab-after-delete.png` (mock E2E), `live-data-tab.png`, `live-e2e.log`,
  `live-generate.json` (live).

### How to verify (≤ 5 min)
`npm run typecheck && npm run test:unit && (cd tests/e2e && E2E_PORT=8803 npx playwright test data.spec.ts --reporter=line)`
→ 0 errors, 59 unit passes, 1 E2E pass; open `docs/evidence/A/data-tab.png`.
Live on the fixture (~2.5 min): `npm run build` is done by the E2E globalSetup for the port; start
`LLM_PROVIDER=anthropic BACKEND_PORT=8803 EXTENSION_AUTH_TOKEN=dev-token-change-me npm run start -w apps/backend`, then
`cd tests/tools && E2E_PORT=8803 npx tsx data-live.mjs` → `list shows Dune: true Arrival: true`.
Manual live on a real site: `LLM_PROVIDER=anthropic npm run dev:backend`, build + load the extension, open a real IMDb title page,
ask "add a button to save this movie", approve, save; on another page ask "show my saved movies" → the approval card
should say "Stores data in: saved_movies"; Data tab lists the docs.

### Known issues
- Identity is the install id (not real auth), as the doc specifies; two Chrome profiles = two users.
- `WidgetAI.db.get` maps a backend 404 to `null` by matching the error text `document not found` (platform client
  only surfaces messages).
- Static check of collection names only covers literal first arguments; computed names are caught at runtime by the SW.

## Decisions (made without the human)
- 13:10 — Store errors are a fastify-free `DataError(status, code)` mapped to `HttpError` in routes — keeps `store.ts` pure/unit-testable.
- 13:10 — `DELETE /api/data/:collection/:id` is idempotent (`{removed:0|1}`, never 404) — simpler for widgets/panel; GET/PATCH/PUT still 404.
- 13:10 — Status codes: 400 validation, 404 not_found, 409 limit (docs/collections caps), 413 too_large.
- 13:12 — Order ties broken by sqlite `rowid` (insertion order) instead of id — same-millisecond inserts would otherwise sort by random id.
- 13:15 — Validator: grant `data` with no collections is an error (the retry lets the model fix it); collections without the grant are dropped with a warning; `WidgetAI.db` in code without the grant is an error.
- 13:15 — Mock routing: `fixture-movies` URL → watchlist page or request starting "show/list/display" → list widget, else save widget (a "save … to my saved movies list" request must stay the save widget).
- 13:18 — Platform backend client sends `content-type: application/json` only with a body: Fastify rejects DELETE with an empty JSON body (minimal edit in `platform/index.ts`).
- 13:18 — No `data` settings flag (Rules §5 flag list doesn't include it; inert without the grant).
- 13:22 — Added prompt rule: save-style widgets scope matchPatterns to the detail-page path and exit quietly (status completed) on other pages — observed in live run 1.
- 13:20 — Save widget matchPatterns are path-scoped (`*://127.0.0.1/fixture-movies/movie*`), list widget `…/watchlist*` — exercises real origin enforcement and keeps each widget off the other page.

## Shared files edited (minimal, called out)
- `packages/contracts/src/widget.ts` (grant `data`, `collections?`), `api.ts` (`existingCollections?`), `data.ts` (mine).
- `apps/extension/src/background/bus.ts` (`Services` += `widgets.get`, `data.collections`).
- `apps/extension/src/background/modules/widgets/index.ts` (provide `widgets.get`), `service.ts` (send `existingCollections`), `README.md`.
- `apps/extension/src/background/platform/index.ts` (content-type only with a body).
- `apps/extension/src/panel/components/WidgetCards.tsx` (grant text, "Stores data in", widget card line).
- `apps/backend/src/modules/generate/validate.ts` (`checkDataUse`), `prompts/widget.ts` (schema `collections`, user-prompt section), `prompts/widget.mock.ts` (branch + `collections` default `[]`).
- `apps/backend/src/fixtures/index.ts` (STATIC += movies).
- New tool `tests/tools/data-live.mjs` (live-LLM run of the data flow); could be listed in AGENTS.md "Testing tools" by the coordinator.

## Stuck log
(none)
