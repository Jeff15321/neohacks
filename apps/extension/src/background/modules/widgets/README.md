# modules/widgets

**Purpose:** generate → approve → run → register → edit/repair → remove generated widgets. Ported from MVP `sw.ts`
(`userScripts.configureWorld/execute/register`, per-widget `worldId`, origin + grant checks).

**Messages handled**
- panel: `GENERATE_WIDGET`, `APPROVE_WIDGET` (approve + register + run), `RUN_WIDGET`, `REPAIR_WIDGET` (repair, or edit with
  `instruction`), `REMOVE_WIDGET`, `LIST_WIDGETS`
- user script: `WIDGET_INFERENCE` (grant inference), `WIDGET_STORAGE` (grant storage), `WIDGET_LOG`, `WIDGET_STATUS`
- emits: `GENERATION_PROGRESS`, `WIDGET_GENERATED`, `WIDGET_STATUS`

**Services provided:** `widgets.list`, `widgets.get` (Phase A: modules/data checks declared `collections`), `widgets.authorize` (the bus calls it for every user-script message: widget exists,
is approved, tab URL matches its patterns, declared grant). **Uses:** `page.context`, `net.opsForTab`, `data.collections` (sent as `existingCollections`).

**Data owned:** `wwa_widgets` (WidgetRecord[]), `wwa_store_<widgetId>_<key>` (WidgetAI.storage).

**Rules:** only `approved` widgets are registered or executed; every new version (repair/edit) needs approval again.

**Test:** E2E `widget.spec.ts`, `gmail2.spec.ts`, `youtube.spec.ts`.
