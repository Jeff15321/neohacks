# modules/observe

**STUB — owner: Phase D.** Settings flag: see `Settings` in `@app/contracts` (system messages).

Step ingest (seq, EventStore), ObserveClient (single in-flight POST /api/observe/steps, coalescing), suggestions.

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/observe.ts`. Wire `registerObserve(bus)` into `background/main.ts`.
