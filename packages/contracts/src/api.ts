import { z } from 'zod';
import { PageContext } from './page.js';
import { GeneratedWidget } from './widget.js';

/** Uniform backend error shape (plugins/errors). */
export const ApiError = z.object({
  ok: z.literal(false),
  error: z.string(),
  /** Machine code, e.g. "validation", "unauthorized", "llm". */
  code: z.string().optional(),
  traceId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const GenerateWidgetRequest = z.object({
  request: z.string().min(1).max(4000),
  pageContext: PageContext,
  /** Optional prior widget to repair/iterate on. */
  prior: z.object({
    code: z.string(),
    error: z.string().optional(),
    feedback: z.string().optional(),
  }).optional(),
  /** Last N conversation turns for this widget (edit thread). */
  history: z.array(z.object({ role: z.enum(['user', 'generator']), text: z.string() })).max(20).optional(),
  /** The user's existing WidgetAI.db collection names, so the generator reuses them (Phase A). */
  existingCollections: z.array(z.string().max(64)).max(100).optional(),
});
export type GenerateWidgetRequest = z.infer<typeof GenerateWidgetRequest>;

export const GenerateWidgetResponse = z.object({
  ok: z.boolean(),
  widget: GeneratedWidget.optional(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  traceId: z.string().optional(),
});
export type GenerateWidgetResponse = z.infer<typeof GenerateWidgetResponse>;

export const InferenceRequest = z.object({
  prompt: z.string().min(1),
  context: z.unknown().optional(),
  instruction: z.string().optional(),
  widgetId: z.string().optional(),
});
export type InferenceRequest = z.infer<typeof InferenceRequest>;

export const InferenceResponse = z.object({
  ok: z.boolean(),
  text: z.string().optional(),
  error: z.string().optional(),
});
export type InferenceResponse = z.infer<typeof InferenceResponse>;

export const HealthResponse = z.object({ ok: z.boolean(), provider: z.string(), models: z.record(z.string(), z.string()).optional() });
export type HealthResponse = z.infer<typeof HealthResponse>;
