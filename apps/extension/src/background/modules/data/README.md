# modules/data (extension) — user data store (`WidgetAI.db`)

**Purpose:** the trusted path between generated widgets / the panel and the backend `/api/data` store. The widget never
sees the extension token or the user id (the platform backend client adds `x-extension-token` + `x-user-id`).

**Files:** `index.ts` (registers bus handlers + services) · `service.ts` (`DataService` REST client over an injected
`DataBackend`, `collectionDenied` gate) · `data.test.ts` (fake bus/backend).

**Messages handled**
- user script: `WIDGET_DATA {op: list|get|add|update|remove, collection, id?, data?, query?}` — registered with grant `data`,
  so the bus first checks widget exists + approved + tab URL matches its patterns + grant declared; then this module
  requires `collection ∈ widget.collections` (declared at generation, shown on the approval card). No `clear` for widgets.
- panel: `DATA_LIST_COLLECTIONS`, `DATA_LIST {collection, limit?, after?}`, `DATA_DELETE {collection, id}`, `DATA_CLEAR {collection}`.

**Services provided:** `data.collections()` → existing collection names (modules/widgets sends them as
`existingCollections` with every generate/repair request). **Uses:** `widgets.get`.

**Data owned:** none locally (the backend `docs` table is the source of truth). No settings flag: the feature is inert
unless a widget declares grant `data` (decision recorded in `docs/phases/A.md`).

**Test:** `npm run test:unit -w apps/extension`; E2E `tests/e2e/data.spec.ts`.
