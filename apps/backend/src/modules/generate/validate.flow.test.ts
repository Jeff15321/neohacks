import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedWidget } from './validate.js';
import { widgetSystemPrompt, WIDGET_JSON_SCHEMA } from './prompts/widget.js';
import { widgetMock } from './prompts/widget.mock.js';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';

/** Phase F: bundle parts through the generator validator, schema, prompt, mock bundle and the tracker fixture API. */
const SINK = `WidgetAI.flow.handle('createTicket', async (input, ctx) => { await ctx.checkpoint({ s: 1 }); return { ok: true, evidence: { url: location.href } }; });`;
const base = {
  name: 'Issue to ticket', description: 'd', matchPatterns: ['*://github.com/*'], grants: ['flow', 'log'], collections: [],
  code: `const r = await WidgetAI.flow.call('jira-sink', 'createTicket', { title: 'x' }); WidgetAI.log(r.evidence.url);`,
  plan: [], changeSummary: '', consequentialActions: ['Creates a ticket in Jira'], warnings: [],
  parts: [{ role: 'jira-sink', matchPatterns: ['*://*.atlassian.net/*'], code: SINK, entryUrl: 'https://acme.atlassian.net/', handlers: ['createTicket'] }],
};
const parse = (o: object) => parseGeneratedWidget(JSON.stringify({ ...base, ...o }));

test('valid bundle → widget.parts (structured-output shape: entryUrl "" and parts [] accepted)', () => {
  const r = parse({});
  assert.equal(r.error, undefined);
  assert.equal(r.widget?.parts?.length, 1);
  assert.deepEqual(r.widget?.parts?.[0]?.handlers, ['createTicket']);
  const noEntry = parse({ parts: [{ ...base.parts[0], entryUrl: '' }] });
  assert.equal(noEntry.widget?.parts?.[0]?.entryUrl, undefined);
  const single = parse({ code: 'WidgetAI.log("single-site widget")', grants: ['log'], parts: [] });
  assert.equal(single.error, undefined);
  assert.equal(single.widget?.parts, undefined);
});

test('each part gets the same code checks as the home part; bundle rules enforced', () => {
  assert.match(parse({ parts: [{ ...base.parts[0], code: SINK + ' fetch("/rest/api/2/issue");' }] }).error!, /part "jira-sink": generated code uses banned construct/);
  assert.match(parse({ parts: [{ ...base.parts[0], matchPatterns: ['*://*/*'] }] }).error!, /not a concrete site/);
  assert.match(parse({ grants: ['log'] }).error!, /grant "flow" is not declared/);
  assert.match(parse({ parts: [] }).error!, /no parts/);
});

test('schema requires parts; prompt has the flow section; mock returns the issues→tracker bundle with a valid part', () => {
  assert.ok((WIDGET_JSON_SCHEMA.required as string[]).includes('parts'));
  assert.match(widgetSystemPrompt(), /CROSS-SITE FLOWS/);
  const raw = widgetMock({ messages: [{ role: 'user', content: 'PAGE URL: http://127.0.0.1:8806/fixture-issues/index.html?n=101\nUSER REQUEST: create ticket' }] } as any);
  const r = parseGeneratedWidget(raw as string);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.widget?.grants.sort(), ['flow', 'log']);
  assert.equal(r.widget?.parts?.[0]?.entryUrl, 'http://localhost:8806/fixture-tracker/index.html');
  assert.deepEqual(r.widget?.parts?.[0]?.matchPatterns, ['*://localhost/*', '*://*.atlassian.net/*']);
  assert.ok(!r.widget?.matchPatterns.some(p => p.includes('localhost')), 'home patterns exclude the sink origin');
  assert.deepEqual(r.widget?.consequentialActions, ['Creates a new ticket in the tracker (localhost)']);
});

test('tracker fixture REST mock: create → read back → search; 400 without summary', async () => {
  const { app } = await buildApp(loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: 't', DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv), { logger: false });
  try {
    await app.inject({ method: 'POST', url: '/fixture-tracker-api/__reset' });
    const bad = await app.inject({ method: 'POST', url: '/fixture-tracker-api/rest/api/2/issue', payload: { fields: {} } });
    assert.equal(bad.statusCode, 400);
    const c = await app.inject({ method: 'POST', url: '/fixture-tracker-api/rest/api/2/issue', payload: { fields: { summary: ' Crash ', description: 'body', labels: ['bug'] } } });
    assert.equal(c.statusCode, 201);
    assert.equal(c.json().key, 'TRK-1');
    const g = await app.inject({ method: 'GET', url: '/fixture-tracker-api/rest/api/2/issue/TRK-1' });
    assert.deepEqual([g.json().fields.summary, g.json().fields.description, g.json().fields.labels], ['Crash', 'body', ['bug']]);
    assert.equal((await app.inject({ method: 'GET', url: '/fixture-tracker-api/rest/api/2/search' })).json().total, 1);
    assert.equal((await app.inject({ method: 'GET', url: '/fixture-tracker-api/rest/api/2/issue/TRK-9' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/fixture-issues/index.html' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/fixture-tracker/ticket.html' })).statusCode, 200);
  } finally { await app.close(); }
});
