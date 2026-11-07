import type { DataCollectionInfo, DataDoc, DataQuery, MsgOf, UserScriptMsg, WidgetRecord } from '@app/contracts';

/** The slice of the platform backend client this module needs (injected → unit-testable with a fake). */
export interface DataBackend {
  request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, traceId?: string): Promise<T>;
}

type WidgetDataMsg = MsgOf<UserScriptMsg, 'WIDGET_DATA'>;

const enc = encodeURIComponent;

/**
 * Collection gate on top of the bus checks (exists/approved/origin/grant "data"): a widget may only touch the
 * collections it declared at generation time (shown to the user on the approval card).
 */
export function collectionDenied(w: Pick<WidgetRecord, 'collections'> | undefined, collection: string): string | undefined {
  if (!w) return 'unknown widget';
  const declared = w.collections ?? [];
  if (!declared.includes(collection)) {
    return `collection "${collection}" not declared by widget (declared: ${declared.join(', ') || 'none'})`;
  }
  return undefined;
}

/** Client for the backend /api/data REST (scoped server-side by the install id the platform sends as x-user-id). */
export class DataService {
  constructor(private api: DataBackend) {}

  async collections(traceId?: string): Promise<DataCollectionInfo[]> {
    return (await this.api.request<{ collections: DataCollectionInfo[] }>('GET', '/api/data', undefined, traceId)).collections;
  }

  async list(collection: string, q: DataQuery = {}, traceId?: string): Promise<{ docs: DataDoc[]; next?: string }> {
    const qs = new URLSearchParams();
    if (q.limit) qs.set('limit', String(q.limit));
    if (q.after) qs.set('after', q.after);
    if (q.where && Object.keys(q.where).length) qs.set('where', JSON.stringify(q.where));
    const s = qs.toString();
    const r = await this.api.request<{ docs: DataDoc[]; next?: string }>('GET', `/api/data/${enc(collection)}${s ? `?${s}` : ''}`, undefined, traceId);
    return { docs: r.docs, ...(r.next ? { next: r.next } : {}) };
  }

  async get(collection: string, id: string, traceId?: string): Promise<DataDoc | null> {
    try {
      return (await this.api.request<{ doc: DataDoc }>('GET', `/api/data/${enc(collection)}/${enc(id)}`, undefined, traceId)).doc;
    } catch (e) {
      if (/^document not found/.test(String((e as Error)?.message))) return null;
      throw e;
    }
  }

  async add(collection: string, data: Record<string, unknown>, id?: string, traceId?: string): Promise<DataDoc> {
    return (await this.api.request<{ doc: DataDoc }>('POST', `/api/data/${enc(collection)}`, id ? { data, id } : { data }, traceId)).doc;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>, traceId?: string): Promise<DataDoc> {
    return (await this.api.request<{ doc: DataDoc }>('PATCH', `/api/data/${enc(collection)}/${enc(id)}`, { data: patch }, traceId)).doc;
  }

  async remove(collection: string, id: string, traceId?: string): Promise<number> {
    return (await this.api.request<{ removed: number }>('DELETE', `/api/data/${enc(collection)}/${enc(id)}`, undefined, traceId)).removed;
  }

  async clear(collection: string, traceId?: string): Promise<number> {
    return (await this.api.request<{ removed: number }>('DELETE', `/api/data/${enc(collection)}`, undefined, traceId)).removed;
  }

  /** WidgetAI.db op → backend. Widgets get list/get/add/update/remove only (no clear: panel only). */
  async widgetOp(m: WidgetDataMsg, traceId?: string): Promise<Record<string, unknown>> {
    const needId = () => { if (!m.id) throw new Error(`WidgetAI.db.${m.op}: id is required`); return m.id; };
    const needData = () => { if (!m.data) throw new Error(`WidgetAI.db.${m.op}: data must be a JSON object`); return m.data; };
    switch (m.op) {
      case 'list': return { docs: (await this.list(m.collection, m.query ?? {}, traceId)).docs };
      case 'get': return { doc: await this.get(m.collection, needId(), traceId) };
      case 'add': return { doc: await this.add(m.collection, needData(), m.id, traceId) };
      case 'update': return { doc: await this.update(m.collection, needId(), needData(), traceId) };
      case 'remove': return { removed: (await this.remove(m.collection, needId(), traceId)) > 0 };
    }
  }
}
