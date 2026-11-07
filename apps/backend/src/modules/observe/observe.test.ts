import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '@app/contracts';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';
import { listLlmCalls } from '../../llm/callModel.js';

const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const hdr = (user: string, trace = 't_obstest') => ({ 'x-extension-token': TOKEN, 'content-type': 'application/json', 'x-trace-id': trace, 'x-user-id': user });
const origin = 'http://127.0.0.1:8787';
const url = `${origin}/fixture-g2/index.html`;
const st = (seq: number, kind: Step['action']['kind'], extra: Partial<Step['action']> = {}, effects: Partial<Step['effects']> = {}): Step => ({
  id: `st${seq}`, seq, tabId: 1, origin, url, action: { kind, ...extra },
  effects: { addedRegions: [], removedRegions: [], liveRegionText: [], net: [], mutatingOk: false, ...effects },
  settled: true, tStart: seq * 1000, tEnd: seq * 1000 + 400,
});
/** One manual reply on HardMail: open row → Reply → type (auto-saved). */
const reply = (seq: number, msgId: string, subject: string): Step[] => [
  st(seq, 'click', { accessibleName: subject, target: { tag: 'tr', role: 'row', accessibleName: subject, candidates: [{ kind: 'data', selector: `tr[data-legacy-message-id="${msgId}"]`, matches: 1 }] } }),
  st(seq + 1, 'click', { accessibleName: 'Reply', target: { tag: 'span', role: 'link', accessibleName: 'Reply', candidates: [] } },
    { addedRegions: [{ root: 'div.aoI', skeleton: 'div.Am[role=textbox][aria-label="Message Body"][contenteditable]' }] }),
  st(seq + 2, 'input-commit', { valuePreview: 'Thanks, will do!' }, { liveRegionText: ['Draft saved'] }),
];
const back = (seq: number) => st(seq, 'click', { accessibleName: 'Back to Inbox', target: { tag: 'div', role: 'button', accessibleName: 'Back to Inbox', candidates: [] } });

test('observe: 1st completed reply → no suggestion; 2nd → Judge suggestion with request + spec; job generates the widget', async () => {
  const { app, deps } = await buildApp(cfg, { logger: false });
  const post = (steps: Step[]) => app.inject({ method: 'POST', url: '/api/observe/steps', headers: hdr(U1), payload: { steps } });
  const r1 = await post(reply(1, 'm1', 'Q4 launch checklist'));
  assert.equal(r1.statusCode, 200, r1.body);
  const b1 = r1.json();
  assert.equal(b1.suggestions.length, 0);
  assert.equal(b1.state.recentCompleted.filter((t: any) => t.status === 'completed').length, 1);
  assert.equal(b1.state.patterns[0].instanceIds.length, 1);
  assert.equal(b1.diag.reconsolidated || b1.diag.reconDeferred, true); // linked by Tier 2 → recon runs right after the response
  assert.match(b1.diag.judge, /gate: .*not flagged|1 completed/);
  // duplicate delivery of the same Steps is a no-op
  assert.equal((await post(reply(1, 'm1', 'Q4 launch checklist'))).json().diag.judge, 'duplicate steps');

  const r2 = await post([back(4), ...reply(5, 'm3', 'Weekly digest')]);
  const b2 = r2.json();
  assert.equal(b2.suggestions.length, 1, JSON.stringify(b2.diag));
  const s = b2.suggestions[0];
  assert.equal(s.patternId, 'p_reply_to_email');
  assert.match(s.title, /unread/i);
  assert.equal(s.taskIds.length, 2);
  assert.ok(s.spec.goal && s.spec.consequentialActions.includes('Send'));
  assert.ok(s.details.length === 2);

  const stages = new Set(listLlmCalls(deps.db, { traceId: 't_obstest' }).map(c => c.stage));
  for (const st of ['steps.interpret', 'observe.activity', 'observe.reconsolidate', 'observe.judge']) assert.ok(stages.has(st), st);
  const judgeCall = listLlmCalls(deps.db, { traceId: 't_obstest' }).find(c => c.stage === 'observe.judge')!;
  assert.equal(judgeCall.model, cfg.models.generation);
  assert.equal(listLlmCalls(deps.db, { traceId: 't_obstest' }).find(c => c.stage === 'observe.activity')!.model, cfg.models.inference);

  // the 3rd completion right after is suppressed by the per-pattern cooldown (one suggestion per pattern)
  const b3 = (await post([back(8), ...reply(9, 'm2', 'Dinner Saturday?')])).json();
  assert.equal(b3.suggestions.length, 0);
  assert.match(b3.diag.judge, /cooldown/);

  // GET state reflects the reducer output; the op log replays to the same memory
  const state = (await app.inject({ method: 'GET', url: '/api/observe/state', headers: hdr(U1) })).json();
  assert.equal(state.state.patterns[0].instanceIds.length, 3);
  const { replayActivity } = await import('@app/core');
  assert.deepEqual(replayActivity(state.opLog), state.state);
  await app.close();
});

test('observe: "Never for this" (dismiss) suppresses the pattern; restore re-enables it; clear keeps dismissals', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const post = (steps: Step[]) => app.inject({ method: 'POST', url: '/api/observe/steps', headers: hdr(U2, 't_obsdismiss'), payload: { steps } });
  await app.inject({ method: 'POST', url: '/api/observe/dismiss', headers: hdr(U2), payload: { patternId: 'p_reply_to_email' } });
  await post(reply(1, 'm1', 'Q4'));
  const b = (await post([back(4), ...reply(5, 'm3', 'Digest')])).json();
  assert.equal(b.suggestions.length, 0);
  assert.match(b.diag.judge, /dismissed/);
  await app.inject({ method: 'POST', url: '/api/observe/restore', headers: hdr(U2), payload: { patternId: 'p_reply_to_email' } });
  const b2 = (await post([back(8), ...reply(9, 'm2', 'Dinner')])).json();
  assert.equal(b2.suggestions.length, 1, JSON.stringify(b2.diag));
  await app.inject({ method: 'POST', url: '/api/observe/dismiss', headers: hdr(U2), payload: { patternId: 'p_reply_to_email' } });
  const cleared = (await app.inject({ method: 'DELETE', url: '/api/observe/state', headers: { ...hdr(U2), 'content-type': undefined as unknown as string } })).json();
  assert.equal(cleared.state.patterns.length, 0);
  assert.deepEqual(cleared.state.dismissed.map((d: any) => d.patternId), ['p_reply_to_email']);
  // users are isolated
  const other = (await app.inject({ method: 'GET', url: '/api/observe/state', headers: hdr(U1) })).json();
  assert.equal(other.state.dismissed.length, 0);
  await app.close();
});

test('observe: noise (open/back only) never completes a task or suggests', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  const post = (steps: Step[]) => app.inject({ method: 'POST', url: '/api/observe/steps', headers: hdr(U1, 't_obsnoise'), payload: { steps } });
  const steps = [reply(1, 'm1', 'Q4')[0]!, back(2), reply(3, 'm2', 'Dinner')[0]!, back(4)];
  const b = (await post(steps)).json();
  assert.equal(b.suggestions.length, 0);
  assert.equal(b.state.recentCompleted.filter((t: any) => t.status === 'completed').length, 0);
  await app.close();
});
