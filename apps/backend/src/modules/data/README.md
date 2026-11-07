# modules/data (backend) — user data store (`WidgetAI.db`)

**Purpose:** per-user named collections of JSON documents, shared across that user's widgets (save on one site,
list on another). No site-specific schemas — widgets own the shape of their documents.

**Files:** `routes.ts` (HTTP only) · `store.ts` (`DataStore` over `node:sqlite`, pure; takes a `Db`) · `data.test.ts`.

**Identity:** every route requires `x-user-id` (the extension's install id, uuid — validated in `plugins/`; 400 when
absent). Hackathon-grade, same honesty level as the shared `x-extension-token`.

**REST** (all scoped by `x-user-id`; errors use the uniform `{ok:false,error,code,traceId}` shape):
| Method | Path | Body / query | Reply |
|---|---|---|---|
| GET | `/api/data` | | `{collections:[{name,count,updatedAt}]}` |
| GET | `/api/data/:collection` | `?limit=&after=&where=` (`where` = JSON shallow equality, e.g. `{"title":"Dune"}`) | `{docs, next?}` newest first |
| POST | `/api/data/:collection` | `{data, id?}` (with `id` = upsert, keeps `createdAt`) | `{doc}` |
| GET | `/api/data/:collection/:id` | | `{doc}` / 404 |
| PATCH | `/api/data/:collection/:id` | `{data}` shallow merge | `{doc}` / 404 |
| PUT | `/api/data/:collection/:id` | `{data}` replace | `{doc}` / 404 |
| DELETE | `/api/data/:collection/:id` | | `{removed: 0\|1}` (idempotent) |
| DELETE | `/api/data/:collection` | (panel only — widgets have no "clear") | `{removed: n}` |

**Limits** (`DATA_LIMITS` in `@app/contracts`): collection `^[a-z0-9_-]{1,64}$` (400), doc id `^[A-Za-z0-9_.:-]{1,128}$`,
doc ≤ 32 KB serialized (413 `too_large`), ≤ 5,000 docs/collection and ≤ 100 collections/user (409 `limit`),
list limit ≤ 200 (default 50), `where` ≤ 8 keys with string/number/boolean/null values.

**Data owned:** the `docs` table (`store/db.ts`), plus index `docs_user_coll_created`. Ordering: `created_at DESC, rowid DESC`;
`after` is the id of the last doc of the previous page.

**Test:** `npm run test:unit -w apps/backend` (store CRUD, isolation, merge vs replace, where, limits; routes via `app.inject`).
E2E `tests/e2e/data.spec.ts`.
