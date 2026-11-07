# modules/data

**STUB — owner: Phase A.**

User data store (WidgetAI.db): /api/data REST scoped by x-user-id; owns the docs table.

Layout when implemented: `routes.ts` (HTTP only) · `service.ts` (logic) · `prompts/` (one file per prompt + `*.mock.ts`) · tests.
Register by adding `registerData` to `MODULES` in `src/server.ts`.
