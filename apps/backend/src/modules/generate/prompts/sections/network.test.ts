import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateWidgetRequest, NetOpSummary } from '@app/contracts';
import { buildWidgetUserPrompt, widgetSystemPrompt } from '../widget.js';
import { networkSection, renderNetOpAnalysis } from './network.js';
import { parseGeneratedWidget } from '../../validate.js';
import { widgetMock } from '../widget.mock.js';

const op: NetOpSummary = {
  id: 'r_save', method: 'POST', url: 'http://a.test/api/drafts', path: '/api/drafts', status: 201, initiator: 'fetch',
  requestBodyTemplate: '{"to":"a@x.com","csrf":"[REDACTED]"}', confirmed: true, ts: 1, tier: 'replayed', stepId: 's_3',
  analysis: {
    template: '/api/drafts', templateKey: 'POST /api/drafts', captures: 2, mutating: true, tokenFields: ['body.csrf'], paramFields: ['body.to'],
    dependsOn: [{ field: 'body.csrf', opId: 'r_csrf', fromTemplate: 'GET /api/csrf', path: 'token' }], clientIdFields: [],
  },
};

test('system prompt carries the strategy rule, tiers and reportVerified', () => {
  const sys = widgetSystemPrompt();
  assert.ok(sys.includes(networkSection));
  for (const s of ['STRATEGY RULE', 'DOM fallback', 'reportVerified', 'dependsOn', 'tokenFields', 'Gmail']) assert.ok(sys.includes(s), s);
});

test('user prompt renders op analysis + tier (field names only)', () => {
  assert.equal(renderNetOpAnalysis(op),
    '· tier replayed · step s_3 · template POST /api/drafts (2 captures) · tokenFields body.csrf · paramFields body.to · dependsOn body.csrf ← GET /api/csrf [r_csrf] .token');
  const req = { request: 'make drafts', pageContext: { url: 'http://a.test/', origin: 'http://a.test', title: 't', landmarks: [], insertionCandidates: [], textSample: '', interactive: [], networkOps: [op] } } as unknown as GenerateWidgetRequest;
  const p = buildWidgetUserPrompt(req);
  assert.match(p, /\[r_save\] POST \/api\/drafts → 201 · tier replayed .* dependsOn body\.csrf ← GET \/api\/csrf \[r_csrf\] \.token/);
  assert.ok(p.includes('"csrf":"[REDACTED]"'));
});

test('mock net widget passes the generated-code validator and uses the dependency + reportVerified', () => {
  const raw = widgetMock({ messages: [{ role: 'user', content: 'url: http://127.0.0.1/fixture-net/index.html' }] } as any) as string;
  const r = parseGeneratedWidget(raw);
  assert.ok(r.widget, r.error);
  for (const s of ['dependsOn', 'WidgetAI.net.reportVerified', 'mergeBody', 'viaDom']) assert.ok(r.widget!.code.includes(s), s);
});
