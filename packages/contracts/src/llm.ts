import { z } from 'zod';

/** Reasoning effort levels supported by `output_config.effort`. */
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/** One row of the backend `llm_calls` log (GET /api/debug/llm-calls). */
export const LlmCallLog = z.object({
  id: z.string(),
  traceId: z.string().nullable(),
  stage: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.string().nullable(),
  startedAt: z.number(),
  latencyMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  /** JSON string: {system, messages}. Truncated for storage. */
  input: z.string(),
  output: z.string().nullable(),
  parseOk: z.boolean().nullable(),
  error: z.string().nullable(),
});
export type LlmCallLog = z.infer<typeof LlmCallLog>;
