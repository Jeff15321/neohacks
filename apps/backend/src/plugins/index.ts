import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { boundaryError, type z } from '@app/contracts';
import { newTraceId } from '@app/core';
import type { Config } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
    /** From `x-user-id` (install id, uuid). Hackathon-grade identity, not real auth. */
    userId?: string;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE = /^[\w-]{1,64}$/;
const isPublic = (url: string) => url === '/health' || url.startsWith('/fixture');

/** Thrown by routes for uniform error replies. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

/** Parse a request body/query with a contracts schema; throws a 400 naming the boundary + message type. */
export function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, type: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, boundaryError('extension→backend', type, r.error), 'validation');
  return r.data;
}

/** tracing: traceId from `x-trace-id` (or new), echoed back; one structured JSON log line per request. */
function tracing(app: FastifyInstance) {
  app.decorateRequest('traceId', '');
  app.addHook('onRequest', async (req, reply) => {
    const h = req.headers['x-trace-id'];
    req.traceId = typeof h === 'string' && TRACE.test(h) ? h : newTraceId();
    reply.header('x-trace-id', req.traceId);
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/fixture')) return;
    req.log.info({ traceId: req.traceId, module: 'http', event: `${req.method} ${req.routeOptions.url ?? req.url}`, ms: Math.round(reply.elapsedTime), ok: reply.statusCode < 400, status: reply.statusCode }, 'req');
  });
}

/** auth: shared extension token on /api/*, optional uuid `x-user-id`. */
function auth(app: FastifyInstance, cfg: Config) {
  app.decorateRequest('userId', undefined);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(req.url)) return;
    if (cfg.authToken && req.headers['x-extension-token'] !== cfg.authToken) {
      return reply.code(401).send({ ok: false, error: 'unauthorized', code: 'unauthorized', traceId: req.traceId });
    }
    const uid = req.headers['x-user-id'];
    if (uid !== undefined) {
      if (typeof uid !== 'string' || !UUID.test(uid)) {
        return reply.code(400).send({ ok: false, error: 'x-user-id must be a uuid', code: 'validation', traceId: req.traceId });
      }
      req.userId = uid.toLowerCase();
    }
  });
}

/** errors: uniform `{ok:false, error, code, traceId}` shape. */
function errors(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = err instanceof HttpError ? err.status : err.statusCode ?? 500;
    const code = err instanceof HttpError ? err.code : status >= 500 ? 'internal' : 'error';
    if (status >= 500) req.log.error({ traceId: req.traceId, err }, 'unhandled');
    reply.code(status).send({ ok: false, error: err.message, code, traceId: req.traceId });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ ok: false, error: `not found: ${req.method} ${req.url}`, code: 'not_found', traceId: req.traceId }));
}

export function registerPlugins(app: FastifyInstance, cfg: Config) {
  tracing(app);
  auth(app, cfg);
  errors(app);
}
