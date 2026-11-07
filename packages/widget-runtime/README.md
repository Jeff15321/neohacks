# @app/widget-runtime

Builds the JavaScript injected around generated widget code (`buildWidgetSource`). Ported from the MVP
`runtime/widgetSource.ts` bridge pattern (`__request` over `chrome.runtime.sendMessage` from the
USER_SCRIPT world → `onUserScriptMessage` in the SW).

- `sections/bridge.ts` — `__WID`, `__GRANTS`, `__TRACE` (run traceId), `__send`, `__request`, `__need`, `__api`.
- `sections/core.ts` — `WidgetAI.inference/log/status/storage`.
- `sections/net.ts` — `WidgetAI.net.operations/invoke/request` (Phase E extends).
- Planned sections: `step.ts`/`assist.ts`/`danger.ts` (Phase C), `db.ts` (Phase A), `flow.ts` (Phase F).
  Register them in `SECTIONS` in `src/index.ts`. Sections only add members to `__api`.

USER_SCRIPT world shares the DOM but NOT page JS globals — verify via DOM only.

Test: `npm run test:unit -w packages/widget-runtime` (runs the prelude in `node:vm` with a fake `chrome`).
