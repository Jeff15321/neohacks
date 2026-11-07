# modules/assist

**STUB — owner: Phase C.** Settings flag: see `Settings` in `@app/contracts` (system messages).

Self-healing runtime: WIDGET_ASSIST (decide/create branch via backend), branch execution in the widget worldId, danger-guard decisions.

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/assist.ts`. Wire `registerAssist(bus)` into `background/main.ts`.
