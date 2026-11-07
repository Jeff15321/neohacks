# @app/contracts

Types + zod schemas for **every boundary message and LLM output**. No logic (one formatting helper).

- `messages/<domain>.ts` — one file per domain (widgets, net, system, record, data, assist, flow, jobs, observe).
  Each exports `panel` (panel→SW), `page` (content→SW), `toContent` (SW→content), `userScript` (widget→SW),
  `broadcast` (SW→panel). `messages/index.ts` spreads them into the boundary unions — **add messages in your
  domain file only**.
- `widget.ts` (GeneratedWidget = generator LLM output, WidgetRecord), `net.ts`, `page.ts` (PageContext),
  `api.ts` (backend HTTP), `llm.ts` (llm_calls row), `steps.ts`, `workflow.ts`, `activity.ts`, `runtime.ts`,
  `data.ts`, `flow.ts`, `jobs.ts` — shapes for later phases (widen, never rename).
- Types are `z.infer` of the schema with the same name.

Consumed as TypeScript source (`exports: ./src/index.ts`) by esbuild (extension), tsx (backend) and tsc — no build step.

Test: `npm run typecheck -w packages/contracts`.
