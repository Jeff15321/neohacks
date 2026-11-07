# modules/assist (Phase C)

Self-healing runtime agent (decision B). HTTP only in `routes.ts`, logic in `service.ts`.

- `POST /api/assist/decide` (`AssistDecideRequest` → `{ok, decision: {choice, reason}}`) — stage `assist.decide`,
  model `cfg.models.fast` (Haiku 5.5), effort low, JSON schema output. Choice = pre-generated branch id | `new` | `stop`
  (| `primary` for multiOutcome steps).
- `POST /api/assist/create` (`AssistCreateRequest` with `tier`) → `{ok, branch: {id, when, code, reason}, review}` —
  `tier:create` = stage `assist.create`, `cfg.models.inference` (Sonnet 5.5); `tier:escalate` = stage `assist.escalate`,
  `cfg.models.generation` (Opus 5.5, streamed), effort medium. Output is validated (`AssistNewBranch` zod) and reviewed
  (`reviewBranchCode` from `@app/core/assist`: acorn + denylist + no consequential-control literals); one retry with the
  rejection reason (`assist.<tier>.retry`).

Prompts (one file per prompt + deterministic mock): `prompts/decide.ts` + `decide.mock.ts`, `prompts/create.ts` +
`create.mock.ts`, `prompts/escalate.ts` (create contract + escalation diagnosis; uses `create.mock.ts`), `prompts/shared.ts`
(report rendering). All page-derived text is framed as UNTRUSTED (`<untrusted_dom>`).

Mocks exercise: branch pick (dialog → popup branch, aria-expanded=false → collapsed branch, quoted label → learned
branch), new branch (`aria-label="Respond"` → `click-respond`), cap → failure (branches that cannot fix an empty inbox).

Test: `src/modules/assist/assist.test.ts`.
