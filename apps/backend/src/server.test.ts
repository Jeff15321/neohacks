import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './server.js';
import { loadConfig } from './config.js';

const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const headers = { 'x-extension-token': TOKEN, 'content-type': 'application/json' };
const pageContext = {
  url: 'http://127.0.0.1:8787/fixture-g2/index.html', origin: 'http://127.0.0.1:8787', title: 'HardMail',
  landmarks: [], insertionCandidates: [], textSample: '', interactive: [],
};

test('health is public and reports provider + models', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().provider, 'mock');
  assert.equal(r.json().models.generation, 'claude-opus-5-5');
  await app.close();
});

test('auth: token required on /api, x-user-id must be a uuid', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  assert.equal((await app.inject({ method: 'POST', url: '/api/inference', payload: { prompt: 'x' } })).statusCode, 401);
  const bad = await app.inject({ method: 'POST', url: '/api/inference', headers: { ...headers, 'x-user-id': 'nope' }, payload: { prompt: 'x' } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, 'validation');
  await app.close();
});

test('generate-widget: boundary validation error names the boundary + type', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'POST', url: '/api/generate-widget', headers, payload: { request: 'x' } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /\[extension→backend\] invalid POST \/api\/generate-widget: pageContext/);
  assert.ok(r.json().traceId);
  await app.close();
});

test('generate-widget (mock) → widget + llm_calls row with the request traceId, parse_ok, stage', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const r = await app.inject({
    method: 'POST', url: '/api/generate-widget', headers: { ...headers, 'x-trace-id': 't_test123' },
    payload: { request: 'draft replies to unread', pageContext },
  });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.ok, true);
  assert.equal(body.widget.name, 'Unread Reply Drafter');
  assert.ok(body.widget.plan.length >= 2);
  assert.equal(r.headers['x-trace-id'], 't_test123');

  const inf = await app.inject({ method: 'POST', url: '/api/inference', headers: { ...headers, 'x-trace-id': 't_test123' }, payload: { prompt: 'Write a reply', context: { a: 1 }, widgetId: 'w_1' } });
  assert.match(inf.json().text, /thanks for reaching out/);

  const calls = (await app.inject({ method: 'GET', url: '/api/debug/llm-calls?traceId=t_test123', headers })).json().calls;
  assert.deepEqual(calls.map((c: any) => c.stage).sort(), ['generate.widget', 'inference']);
  const gen = calls.find((c: any) => c.stage === 'generate.widget');
  assert.equal(gen.model, 'claude-opus-5-5');
  assert.equal(gen.effort, 'high');
  assert.equal(gen.parseOk, true);
  assert.equal(gen.provider, 'mock');
  assert.ok(gen.latencyMs !== null);
  assert.match(gen.input, /USER REQUEST: draft replies to unread/);
  await app.close();
});

test('fixtures are served without auth', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  for (const u of ['/fixture/index.html', '/fixture-g2/index.html', '/fixture-yt/index.html', '/fixture-net/index.html']) {
    assert.equal((await app.inject({ method: 'GET', url: u })).statusCode, 200, u);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/fixture-api/drafts' })).statusCode, 200);
  await app.close();
});
