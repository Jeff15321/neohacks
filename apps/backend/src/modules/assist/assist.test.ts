import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';
import { listLlmCalls } from '../../llm/callModel.js';

const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const headers = { 'x-extension-token': TOKEN, 'content-type': 'application/json' };
const base = {
  step: 'open-reply', goal: 'open the reply composer', expected: 'element [contenteditable="true"] exists', observed: 'no element matches',
  attempt: 1, branches: [{ id: 'dismiss-popup', when: 'an interstitial popup/dialog covers the page' }, { id: 'expand-collapsed', when: 'the composer is collapsed' }],
  tried: [], lastActions: ['click span "Reply"'], url: 'http://127.0.0.1/fixture-g2/index.html?chaos=popup',
};

test('assist.decide (mock): picks the popup branch when a dialog is in the DOM, else "new"; logged with stage + fast model', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const r1 = await app.inject({ method: 'POST', url: '/api/assist/decide', headers: { ...headers, 'x-trace-id': 't_as1' }, payload: { ...base, dom: '<div role="dialog" aria-label="Try the new HardMail">' } });
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.json().decision.choice, 'dismiss-popup');
  const r2 = await app.inject({ method: 'POST', url: '/api/assist/decide', headers, payload: { ...base, tried: ['dismiss-popup'], dom: '<div role="dialog">' } });
  assert.equal(r2.json().decision.choice, 'new');
  const calls = listLlmCalls(deps.db, { traceId: 't_as1' });
  assert.equal(calls[0].stage, 'assist.decide');
  assert.equal(calls[0].model, cfg.models.fast);
  assert.equal(calls[0].parseOk, true);
  await app.close();
});

test('assist.create / escalate (mock): reviewed branch; escalate uses the generation model', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'POST', url: '/api/assist/create', headers: { ...headers, 'x-trace-id': 't_as2' }, payload: { ...base, tier: 'create', dom: '<span role="link" aria-label="Respond">' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().branch.id, 'click-respond');
  assert.equal(r.json().review.safe, true);
  const e = await app.inject({ method: 'POST', url: '/api/assist/create', headers: { ...headers, 'x-trace-id': 't_as3' }, payload: { ...base, tier: 'escalate', dom: '<div>empty</div>', previous: { code: 'return state;', error: 'no composer' } } });
  assert.equal(e.json().branch.id, 'escalated-wait');
  assert.equal(listLlmCalls(deps.db, { traceId: 't_as2' })[0].model, cfg.models.inference);
  const esc = listLlmCalls(deps.db, { traceId: 't_as3' })[0];
  assert.equal(esc.stage, 'assist.escalate');
  assert.equal(esc.model, cfg.models.generation);
  // page text is framed as untrusted in every prompt
  assert.match(esc.input, /UNTRUSTED DATA/);
  await app.close();
});

test('assist prompts: decide never stops for overlays; create gets the state shape framed as untrusted', async () => {
  const { DECIDE_SYSTEM } = await import('./prompts/decide.js');
  const { CREATE_SYSTEM, createUser } = await import('./prompts/create.js');
  assert.match(DECIDE_SYSTEM, /NEVER "stop" because of such an overlay/);
  assert.match(CREATE_SYSTEM, /synonym/);
  const u = createUser({ ...base, dom: '<div>', tier: 'create', stateKeys: ['items', 'cur'], stateShape: '{"cur":0,"items":[{"id":"m1"}]}' });
  assert.match(u, /STATE SHAPE[^\n]*UNTRUSTED[\s\S]*<state_shape>\n\{"cur":0/);
  assert.doesNotMatch(createUser({ ...base, dom: '<div>', tier: 'create' }), /STATE SHAPE/);
});
