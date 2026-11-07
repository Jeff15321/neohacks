import { z } from 'zod';

/** Every extension message is `{type, traceId?, ...payload}`. */
export const msg = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), traceId: z.string().optional(), ...shape });

/** User-script messages additionally carry the widget id (and requestId for request/response calls). */
export const usMsg = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), widgetId: z.string(), requestId: z.string().optional(), traceId: z.string().optional(), ...shape });
