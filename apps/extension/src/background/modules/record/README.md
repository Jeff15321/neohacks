# modules/record

**STUB — owner: Phase B.** Settings flag: see `Settings` in `@app/contracts` (system messages).

RecordingSession (commands, REC badge, storage.session), recording stop → interpret → generate.

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/record.ts`. Wire `registerRecord(bus)` into `background/main.ts`.
