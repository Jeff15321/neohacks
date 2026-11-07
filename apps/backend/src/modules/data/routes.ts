import type { FastifyRequest } from 'fastify';
import { DataCreateBody, DataListQueryString, DataWhere, DataWriteBody } from '@app/contracts';
import { HttpError, parseOr400 } from '../../plugins/index.js';
import type { RegisterModule } from '../types.js';
import { DataError, DataStore } from './store.js';

type P = { collection: string; id?: string };

/** User data store REST (WidgetAI.db). HTTP only — logic in store.ts. Every route is scoped by `x-user-id`. */
export const registerData: RegisterModule = (app, { db }) => {
  const store = new DataStore(db);

  const uid = (req: FastifyRequest) => {
    if (!req.userId) throw new HttpError(400, 'x-user-id header (install id, uuid) is required for /api/data', 'validation');
    return req.userId;
  };
  /** Map store errors onto the uniform error shape. */
  const run = <T>(fn: () => T): T => {
    try { return fn(); } catch (e) {
      if (e instanceof DataError) throw new HttpError(e.status, e.message, e.code);
      throw e;
    }
  };
  const params = (req: FastifyRequest) => req.params as P;
  const notFound = (c: string, id: string) => new HttpError(404, `document not found: ${c}/${id}`, 'not_found');

  app.get('/api/data', async (req) => ({ ok: true, collections: run(() => store.listCollections(uid(req))) }));

  app.get('/api/data/:collection', async (req) => {
    const u = uid(req);
    const q = parseOr400(DataListQueryString, req.query, 'GET /api/data/:collection');
    let where: DataWhere | undefined;
    if (q.where) {
      let raw: unknown;
      try { raw = JSON.parse(q.where); } catch { throw new HttpError(400, 'where must be a JSON object, e.g. {"title":"Dune"}', 'validation'); }
      where = parseOr400(DataWhere, raw, 'GET /api/data/:collection where');
    }
    return { ok: true, ...run(() => store.list(u, params(req).collection, { limit: q.limit, after: q.after, where })) };
  });

  app.post('/api/data/:collection', async (req) => {
    const u = uid(req);
    const body = parseOr400(DataCreateBody, req.body, 'POST /api/data/:collection');
    return { ok: true, doc: run(() => store.create(u, params(req).collection, body.data, body.id)) };
  });

  app.delete('/api/data/:collection', async (req) => {
    const u = uid(req);
    return { ok: true, removed: run(() => store.clear(u, params(req).collection)) };
  });

  app.get('/api/data/:collection/:id', async (req) => {
    const u = uid(req);
    const { collection, id } = params(req);
    const doc = run(() => store.get(u, collection, id!));
    if (!doc) throw notFound(collection, id!);
    return { ok: true, doc };
  });

  app.patch('/api/data/:collection/:id', async (req) => {
    const u = uid(req);
    const { collection, id } = params(req);
    const body = parseOr400(DataWriteBody, req.body, 'PATCH /api/data/:collection/:id');
    return { ok: true, doc: run(() => store.merge(u, collection, id!, body.data)) };
  });

  app.put('/api/data/:collection/:id', async (req) => {
    const u = uid(req);
    const { collection, id } = params(req);
    const body = parseOr400(DataWriteBody, req.body, 'PUT /api/data/:collection/:id');
    return { ok: true, doc: run(() => store.replace(u, collection, id!, body.data)) };
  });

  app.delete('/api/data/:collection/:id', async (req) => {
    const u = uid(req);
    const { collection, id } = params(req);
    // idempotent: deleting a missing doc is not an error (removed: 0)
    return { ok: true, removed: run(() => store.remove(u, collection, id!)) ? 1 : 0 };
  });
};
