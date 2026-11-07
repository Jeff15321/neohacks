import { z } from 'zod';
import { msg, usMsg } from './_msg.js';
import { DATA_LIMITS, DataBody, DataCollectionName, DataDocId, DataQuery } from '../data.js';

/** Owner: Phase A (extension modules/data). */
export const panel = [
  msg('DATA_LIST_COLLECTIONS', {}),
  msg('DATA_LIST', { collection: DataCollectionName, limit: z.number().int().min(1).max(DATA_LIMITS.LIST_MAX_LIMIT).optional(), after: DataDocId.optional() }),
  msg('DATA_DELETE', { collection: DataCollectionName, id: DataDocId }),
  /** Delete every doc in a collection — panel only (widgets have no "clear"). */
  msg('DATA_CLEAR', { collection: DataCollectionName }),
] as const;
export const page = [] as const;
export const toContent = [] as const;

/**
 * WidgetAI.db → SW. The bus checks widget existence/approval/origin + grant "data"; modules/data additionally
 * requires `collection` ∈ the widget's declared `collections`.
 */
export const userScript = [
  usMsg('WIDGET_DATA', {
    op: z.enum(['list', 'get', 'add', 'update', 'remove']),
    collection: DataCollectionName,
    id: DataDocId.optional(),
    data: DataBody.optional(),
    query: DataQuery.optional(),
  }),
] as const;
export const broadcast = [] as const;
