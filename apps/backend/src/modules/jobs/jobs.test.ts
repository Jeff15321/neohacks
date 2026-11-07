import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';

const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const U = '33333333-3333-4333-8333-333333333333';
const headers = { 'x-extension-token': TOKEN, 'content-type': 'application/json', 'x-trace-id': 't_jobtest', 'x-user-id': U };
const pageContext = { url: 'http://127.0.0.1:8787/fixture-g2/index.html', origin: 'http://127.0.0.1:8787', title: 'HardMail', landmarks: [], insertionCandidates: [], textSample: 'hardmail inbox', interactive: [] };

test('jobs: POST → long-poll → succeeded with a validated widget; dedupeKey reuses the live job', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const start = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { kind: 'generate', request: 'Draft replies to unread emails', pageContext, dedupeKey: 'p1:abc' } });
  assert.equal(start.statusCode, 200, start.body);
  const job = start.json().job;
  assert.equal(job.status, 'queued');
  const again = (await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { kind: 'generate', request: 'x', pageContext, dedupeKey: 'p1:abc' } })).json().job;
  assert.equal(again.id, job.id);
  let j = job;
  for (let i = 0; i < 5 && !['succeeded', 'failed'].includes(j.status); i++) {
    j = (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}?wait=5&since=${j.updatedAt}`, headers })).json().job;
  }
  assert.equal(j.status, 'succeeded', JSON.stringify(j));
  assert.ok(j.result.widget.code.length > 20);
  assert.ok(Array.isArray(j.result.warnings));
  // terminal: long-poll returns at once
  const t0 = Date.now();
  await app.inject({ method: 'GET', url: `/api/jobs/${job.id}?wait=20`, headers });
  assert.ok(Date.now() - t0 < 1000);
  // other users cannot read it
  const other = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: { ...headers, 'x-user-id': '44444444-4444-4444-8444-444444444444' } });
  assert.equal(other.statusCode, 404);
  await app.close();
});

test('jobs: cancel while running → cancelled; the late generation result is discarded; long-poll wakes on change', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  // slow generator to cancel mid-flight (service registry override = how a test fakes another module)
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const real = deps.services.use('generate.widget');
  deps.services.provide('generate.widget', async (b, t) => { await gate; return real(b, t); });
  const job = (await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { kind: 'generate', request: 'slow one', pageContext } })).json().job;
  await new Promise(r => setTimeout(r, 30));
  const poll = app.inject({ method: 'GET', url: `/api/jobs/${job.id}?wait=10&since=${Date.now()}`, headers });
  const del = (await app.inject({ method: 'DELETE', url: `/api/jobs/${job.id}`, headers: { ...headers, 'content-type': undefined as unknown as string } })).json().job;
  assert.equal(del.status, 'cancelled');
  assert.equal((await poll).json().job.status, 'cancelled');
  release();
  await new Promise(r => setTimeout(r, 100));
  const after = (await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers })).json().job;
  assert.equal(after.status, 'cancelled');
  assert.equal(after.result, undefined);
  const row = deps.db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as { status: string };
  assert.equal(row.status, 'cancelled');
  await app.close();
});
