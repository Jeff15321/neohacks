# modules/observe

**STUB — owner: Phase D.**

Tier-1 step interpreter (B may host it here or in recordings), Tier-2 activity model + reconsolidation, Tier-3 judge (POST /api/observe/steps).

Layout when implemented: `routes.ts` (HTTP only) · `service.ts` (logic) · `prompts/` (one file per prompt + `*.mock.ts`) · tests.
Register by adding `registerObserve` to `MODULES` in `src/server.ts`.
