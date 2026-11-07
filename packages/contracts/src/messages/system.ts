import { z } from 'zod';
import { msg } from './_msg.js';

/** Module on/off switches (Rules §5) — used to isolate bugs. */
export const Settings = z.object({
  net: z.boolean(),
  observe: z.boolean(),
  record: z.boolean(),
  assist: z.boolean(),
  suggestions: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;
export const DEFAULT_SETTINGS: Settings = { net: true, observe: false, record: true, assist: true, suggestions: false };

export const BusLogEntry = z.object({
  id: z.number(),
  ts: z.number(),
  type: z.string(),
  channel: z.enum(['panel', 'content', 'userScript', 'broadcast', 'toContent', 'internal']),
  from: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  error: z.string().optional(),
  traceId: z.string().optional(),
});
export type BusLogEntry = z.infer<typeof BusLogEntry>;

export const HealthInfo = z.object({
  userScripts: z.boolean(),
  backend: z.enum(['ok', 'down', 'unauthorized']),
  backendUrl: z.string(),
  provider: z.string().optional(),
  widgets: z.number(),
});
export type HealthInfo = z.infer<typeof HealthInfo>;

/** Owner: extension modules/system. */
export const panel = [
  msg('PANEL_READY', {}),
  msg('GET_HEALTH', {}),
  msg('GET_PAGE_CONTEXT', { tabId: z.number().optional() }),
  msg('GET_BUS_LOG', { limit: z.number().optional() }),
  msg('GET_LLM_CALLS', { filterTraceId: z.string().optional(), limit: z.number().optional() }),
  msg('GET_SETTINGS', {}),
  msg('SET_SETTINGS', { patch: Settings.partial() }),
] as const;

/** SW → content script */
export const toContent = [
  msg('WWA_GET_CONTEXT', {}),
  msg('WWA_PING', {}),
] as const;

export const broadcast = [
  msg('ERROR', { message: z.string(), widgetId: z.string().optional() }),
  msg('SETTINGS_CHANGED', { settings: Settings }),
] as const;
