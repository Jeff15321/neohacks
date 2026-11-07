import type { FastifyInstance } from 'fastify';

/**
 * Phase F: real REST mock for the Jira-like tracker fixture (fixtures/tracker). In-memory, no auth.
 * The flow E2E opens the tracker on `localhost:<port>` while the issues fixture runs on `127.0.0.1:<port>`
 * (different origins). Shape loosely follows Jira's `/rest/api/2/issue` so generated code reads naturally.
 *   POST /fixture-tracker-api/rest/api/2/issue   {fields:{summary, description, labels?}} → 201 {id, key, self}
 *   GET  /fixture-tracker-api/rest/api/2/issue/:key → {key, fields:{summary, description, labels, created}}
 *   GET  /fixture-tracker-api/rest/api/2/search      → {issues:[…]}
 *   POST /fixture-tracker-api/__reset · POST /fixture-tracker-api/__slow {ms} · GET /fixture-tracker-api/__state (tests)
 */
interface Ticket { id: string; key: string; summary: string; description: string; labels: string[]; created: number; origin?: string }

export function registerTrackerApiRoutes(app: FastifyInstance) {
  let seq = 0;
  let tickets: Ticket[] = [];
  let slowMs = 0; // test hook: delay creates (so a test can close the tab mid-run)
  const view = (t: Ticket) => ({ id: t.id, key: t.key, self: `/fixture-tracker-api/rest/api/2/issue/${t.key}`,
    fields: { summary: t.summary, description: t.description, labels: t.labels, created: new Date(t.created).toISOString() } });

  app.post('/fixture-tracker-api/__reset', async () => { seq = 0; tickets = []; slowMs = 0; return { ok: true }; });
  app.post('/fixture-tracker-api/__slow', async (req) => { slowMs = Math.min(30_000, Number((req.body as { ms?: unknown })?.ms) || 0); return { ok: true, slowMs }; });

  app.post('/fixture-tracker-api/rest/api/2/issue', async (req, reply) => {
    const body = (req.body ?? {}) as { fields?: { summary?: unknown; description?: unknown; labels?: unknown } };
    const f = body.fields ?? {};
    if (typeof f.summary !== 'string' || !f.summary.trim()) return reply.code(400).send({ errorMessages: [], errors: { summary: 'You must specify a summary of the issue.' } });
    if (slowMs) await new Promise(r => setTimeout(r, slowMs));
    seq += 1;
    const t: Ticket = {
      id: String(10000 + seq), key: `TRK-${seq}`, summary: f.summary.trim().slice(0, 255),
      description: typeof f.description === 'string' ? f.description.slice(0, 20000) : '',
      labels: Array.isArray(f.labels) ? f.labels.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
      created: Date.now(), origin: String(req.headers.origin ?? ''),
    };
    tickets.push(t);
    return reply.code(201).send({ id: t.id, key: t.key, self: view(t).self });
  });

  app.get('/fixture-tracker-api/rest/api/2/issue/:key', async (req, reply) => {
    const t = tickets.find(x => x.key === (req.params as { key: string }).key);
    if (!t) return reply.code(404).send({ errorMessages: ['Issue does not exist'] });
    return view(t);
  });

  app.get('/fixture-tracker-api/rest/api/2/search', async () => ({ total: tickets.length, issues: tickets.map(view) }));

  /** Test-only: raw state incl. the Origin header each create came from. */
  app.get('/fixture-tracker-api/__state', async () => ({ tickets }));
}
