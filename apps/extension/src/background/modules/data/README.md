# modules/data

**STUB — owner: Phase A.** Settings flag: see `Settings` in `@app/contracts` (system messages).

WIDGET_DATA user-script handler (grant data + declared collections) and panel DATA_* messages → /api/data.

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/data.ts`. Wire `registerData(bus)` into `background/main.ts`.
