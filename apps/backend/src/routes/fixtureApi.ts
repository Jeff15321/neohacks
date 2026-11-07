import type { FastifyInstance } from 'fastify';

/**
 * Real REST backend for the NetMail fixture app (apps/fixture-net). In-memory,
 * no auth — it exists so the extension's network observation/replay pipeline
 * has genuine request/response traffic and server-side state to verify.
 */
interface Msg { id: string; from: string; fromName: string; subject: string; body: string; date: string; unread: boolean; }
interface Draft { id: number; to: string; subject: string; body: string; ts: number; }
interface Sent { id: number; to: string; subject: string; body: string; ts: number; }

function seed() {
  return {
    seq: 1,
    messages: [
      { id: 'n1', from: 'priya@example.com', fromName: 'Priya Nair', subject: 'Q4 launch checklist', body: 'Hi,\n\nCan you review the Q4 launch checklist by Friday?\n\nThanks,\nPriya', date: 'Nov 6', unread: true },
      { id: 'n2', from: 'devon@example.com', fromName: 'Devon Cole', subject: 'Dinner Saturday?', body: 'Hey!\n\nDinner Saturday at 7, usual spot. You in?\n\n— Devon', date: 'Nov 6', unread: true },
      { id: 'n3', from: 'newsletter@corp.example.com', fromName: 'Alerts', subject: 'Weekly digest #482', body: 'Your weekly digest: 3 new docs, 1 pending approval.', date: 'Nov 4', unread: false },
    ] as Msg[],
    drafts: [] as Draft[],
    sent: [] as Sent[],
  };
}

export function registerFixtureApiRoutes(app: FastifyInstance) {
  let state = seed();

  app.post('/fixture-api/__reset', async () => { state = seed(); return { ok: true }; });

  app.get('/fixture-api/messages', async () => ({
    messages: state.messages.map(m => ({ id: m.id, from: m.from, subject: m.subject, date: m.date, unread: m.unread })),
  }));

  app.get<{ Params: { id: string } }>('/fixture-api/messages/:id', async (req, reply) => {
    const m = state.messages.find(x => x.id === req.params.id);
    if (!m) { reply.code(404); return { ok: false, error: 'not found' }; }
    return { message: m };
  });

  app.post<{ Params: { id: string } }>('/fixture-api/messages/:id/read', async (req) => {
    const m = state.messages.find(x => x.id === req.params.id);
    if (m) m.unread = false;
    return { ok: !!m };
  });

  app.get('/fixture-api/drafts', async () => ({ drafts: state.drafts }));

  app.post<{ Body: { to?: string; subject?: string; body?: string } }>('/fixture-api/drafts', async (req, reply) => {
    const { to, subject, body } = req.body ?? {};
    if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string' || !to.trim()) {
      reply.code(400);
      return { ok: false, error: 'draft requires to, subject, body' };
    }
    const draft: Draft = { id: state.seq++, to, subject, body, ts: Date.now() };
    state.drafts.push(draft);
    reply.code(201);
    return { ok: true, draft };
  });

  app.post<{ Body: { to?: string; subject?: string; body?: string } }>('/fixture-api/send', async (req, reply) => {
    const { to, subject, body } = req.body ?? {};
    if (!to?.trim()) { reply.code(400); return { ok: false, error: 'send requires to' }; }
    const msg: Sent = { id: state.seq++, to: to!, subject: subject ?? '', body: body ?? '', ts: Date.now() };
    state.sent.push(msg);
    return { ok: true, id: msg.id };
  });

  app.get('/fixture-api/sent', async () => ({ sent: state.sent }));
}
