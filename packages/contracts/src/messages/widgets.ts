import { z } from 'zod';
import { msg, usMsg } from './_msg.js';
import { WidgetRecord, WidgetStatus } from '../widget.js';

/** Owner: extension modules/widgets. */
export const panel = [
  msg('GENERATE_WIDGET', { request: z.string().min(1).max(4000), tabId: z.number().optional() }),
  /** Approve → register (persist) + execute now. */
  msg('APPROVE_WIDGET', { widgetId: z.string() }),
  msg('RUN_WIDGET', { widgetId: z.string() }),
  /** Repair (instruction absent) or conversational edit (instruction present). */
  msg('REPAIR_WIDGET', { widgetId: z.string(), instruction: z.string().max(4000).optional() }),
  msg('REMOVE_WIDGET', { widgetId: z.string() }),
  msg('LIST_WIDGETS', {}),
] as const;

export const userScript = [
  usMsg('WIDGET_INFERENCE', { prompt: z.string(), context: z.unknown().optional(), instruction: z.string().optional() }),
  usMsg('WIDGET_STORAGE', { op: z.enum(['get', 'set', 'remove']), key: z.string().max(200), value: z.unknown().optional() }),
  usMsg('WIDGET_LOG', { level: z.enum(['info', 'warn', 'error']), message: z.string() }),
  usMsg('WIDGET_STATUS', { status: z.enum(['running', 'completed', 'failed']), detail: z.string().optional() }),
] as const;

export const broadcast = [
  msg('GENERATION_PROGRESS', { stage: z.string(), detail: z.string().optional(), widgetId: z.string().optional() }),
  msg('WIDGET_GENERATED', { widget: WidgetRecord }),
  msg('WIDGET_STATUS', { widgetId: z.string(), status: WidgetStatus, log: z.string().optional() }),
  msg('WIDGET_LIST', { widgets: z.array(WidgetRecord) }),
] as const;
