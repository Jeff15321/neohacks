# modules/flow

**STUB — owner: Phase F.** Settings flag: see `Settings` in `@app/contracts` (system messages).

FlowCoordinator: cross-tab runs (WidgetAI.flow), durable FlowRun in storage.session, alarms, cancellation.

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/flow.ts`. Wire `registerFlow(bus)` into `background/main.ts`.
