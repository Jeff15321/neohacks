import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '@app/contracts';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';
import { listLlmCalls } from '../../llm/callModel.js';

const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const headers = { 'x-extension-token': TOKEN, 'content-type': 'application/json', 'x-trace-id': 't_rectest' };
const origin = 'http://127.0.0.1:8787';
const url = `${origin}/fixture-g2/index.html`;
const base = (seq: number, kind: Step['action']['kind'], extra: Partial<Step['action']> = {}, effects: Partial<Step['effects']> = {}): Step => ({
  id: `st${seq}`, seq, tabId: 1, origin, url, action: { kind, ...extra },
  effects: { addedRegions: [], removedRegions: [], liveRegionText: [], net: [], mutatingOk: false, ...effects },
  settled: true, tStart: seq * 1000, tEnd: seq * 1000 + 400,
});
const steps: Step[] = [
  base(1, 'click', { target: { tag: 'tr', role: 'row', accessibleName: 'Priya Nair Q4 launch checklist', candidates: [{ kind: 'data', selector: 'tr[data-legacy-message-id="m1"]', matches: 1 }] } }),
  base(2, 'click', { target: { tag: 'span', role: 'link', accessibleName: 'Reply', candidates: [{ kind: 'aria-label', selector: '[aria-label="Reply"]', matches: 1 }] } },
    { addedRegions: [{ root: 'div.aoI > div.Am', skeleton: 'div.Am[role=textbox][aria-label="Message Body"][contenteditable]' }] }),
  base(3, 'input-commit', { valuePreview: 'Thanks Priya, will do!' }, { liveRegionText: ['Draft saved'] }),
];

test('POST /api/recordings/steps/interpret: Tier-1 labels (mock), logged as steps.interpret on the fast model', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'POST', url: '/api/recordings/steps/interpret', headers, payload: { steps } });
  assert.equal(r.statusCode, 200, r.body);
  const sem = r.json().semantic;
  assert.equal(sem.length, 3);
  assert.equal(sem[1].verb, 'reply');
  assert.equal(sem[0].verb, 'open');
  const calls = listLlmCalls(deps.db, { traceId: 't_rectest' });
  assert.equal(calls[0].stage, 'steps.interpret');
  assert.equal(calls[0].model, cfg.models.fast);
  assert.equal(calls[0].parseOk, true);
  await app.close();
});

test('POST /api/recordings/interpret: WorkflowSpec with goal + slots, evidence enriched from Steps, struck Steps dropped', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'POST', url: '/api/recordings/interpret', headers, payload: { recordingId: 'rec_t', steps, struck: [1] } });
  assert.equal(r.statusCode, 200, r.body);
  const spec = r.json().spec;
  assert.match(spec.goal, /unread/i);
  assert.ok(spec.inputs.length >= 1);
  assert.ok(spec.consequentialActions.some((a: string) => /send/i.test(a)));
  const reply = spec.steps.find((s: { intent: string }) => /composer/i.test(s.intent));
  assert.deepEqual(reply.evidence.stepSeq, [2]);
  assert.equal(reply.evidence.locators[0].candidates[0].selector, '[aria-label="Reply"]');
  assert.match(reply.evidence.regionSkeleton, /Message Body/);
  assert.ok(!spec.steps.some((s: { evidence: { stepSeq: number[] } }) => s.evidence.stepSeq.includes(1)), 'struck step not cited');
  const calls = listLlmCalls(deps.db, { traceId: 't_rectest' });
  assert.equal(calls[0].stage, 'recordings.interpret');
  assert.equal(calls[0].model, cfg.models.generation);
  assert.ok(!calls[0].input.includes('tr[data-legacy-message-id=\\"m1\\"]'), 'struck step not sent to the model');
  const trace = deps.db.prepare('SELECT kind FROM traces WHERE id = ?').get('rec_t') as { kind: string };
  assert.equal(trace.kind, 'recording');
  await app.close();
});

test('generate-widget with spec renders the spec + evidence into the user prompt (mock picks the spec widget)', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const i = await app.inject({ method: 'POST', url: '/api/recordings/interpret', headers, payload: { recordingId: 'rec_g', steps } });
  const spec = i.json().spec;
  const pageContext = { url, origin, title: 'HardMail', landmarks: [], insertionCandidates: [], textSample: '', interactive: [] };
  const evidence = [{ seq: 2, kind: 'click', url, addedRegions: steps[1].effects.addedRegions, liveRegionText: [], net: [], target: steps[1].action.target }];
  const r = await app.inject({ method: 'POST', url: '/api/generate-widget', headers: { ...headers, 'x-trace-id': 't_gen' }, payload: { request: 'Automate: ' + spec.goal, pageContext, spec, evidence } });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.json().widget.name, /Recorded/);
  const call = listLlmCalls(deps.db, { traceId: 't_gen' })[0];
  assert.match(call.input, /RECORDED WORKFLOW SPEC/);
  assert.match(call.input, /STEP EVIDENCE/);
  assert.match(call.input, /RECORDED WORKFLOWS \(only when/); // system section present
  await app.close();
});

test('recordings: boundary validation names the route', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const r = await app.inject({ method: 'POST', url: '/api/recordings/interpret', headers, payload: { steps: [] } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /POST \/api\/recordings\/interpret/);
  await app.close();
});
