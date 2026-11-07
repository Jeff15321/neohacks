# modules/jobs

**STUB — owner: Phase D.** Settings flag: see `Settings` in `@app/contracts` (system messages).

JobClient: background generation long-poll (POST /api/jobs, GET ?wait=25, DELETE).

Layout: `index.ts` (registers its bus handlers / services) · `service.ts` (logic, uses `@app/core`) · `store.ts` (its own storage keys) · this README (purpose, messages handled/emitted, data owned, how to test).
Messages go in `packages/contracts/src/messages/jobs.ts`. Wire `registerJobs(bus)` into `background/main.ts`.
