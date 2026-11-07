import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildPartSource, buildWidgetSource } from '../index.js';

/** Phase F: WidgetAI.flow prelude section (home call/long-poll, sink handle with baked-in invocation). */
const exec = async (src: string, reply: (m: any) => any, ms = 30) => {
  const sent: any[] = [];
  const chrome = { runtime: { lastError: undefined, sendMessage: (m: any, cb?: (r: any) => void) => { sent.push(JSON.parse(JSON.stringify(m))); if (cb) setTimeout(() => cb(reply(m)), 0); } } };
  vm.runInNewContext(src, { chrome, setTimeout, clearTimeout, console: { error() {}, warn() {} } });
  await new Promise(r => setTimeout(r, ms));
  return sent;
};
const statusDetail = (sent: any[]) => sent.filter(m => m.type === 'WIDGET_STATUS').map(m => m.detail);

test('home: flow.call → FLOW_CALL then FLOW_WAIT until done → resolves with the sink result', async () => {
  let waits = 0;
  const sent = await exec(buildWidgetSource({ id: 'w_f', name: 'F', version: 1, grants: ['flow'], code: `
    const r = await WidgetAI.flow.call('jira-sink', 'createTicket', { title: 'T' }, { openUrl: 'https://x.atlassian.net/' });
    WidgetAI.status('completed', r.evidence.id);
  ` }, 't1'), (m) => {
    if (m.type === 'FLOW_CALL') return { ok: true, runId: 'fr_1' };
    if (m.type === 'FLOW_WAIT') return ++waits < 2 ? { ok: true, done: false, status: 'running' } : { ok: true, done: true, success: true, result: { ok: true, evidence: { id: 'TRK-9' } }, status: 'succeeded' };
    return { ok: true };
  });
  const call = sent.find(m => m.type === 'FLOW_CALL');
  assert.deepEqual([call.role, call.handler, call.input, call.opts], ['jira-sink', 'createTicket', { title: 'T' }, { openUrl: 'https://x.atlassian.net/', reuseTab: true, activate: true }]);
  assert.equal(call.widgetId, 'w_f');
  assert.equal(sent.filter(m => m.type === 'FLOW_WAIT').length, 2);
  assert.deepEqual(statusDetail(sent), ['TRK-9']);
});

test('home: a failed run rejects with the reason (tab closed); missing grant throws before any message', async () => {
  const sent = await exec(buildWidgetSource({ id: 'w_f', name: 'F', version: 1, grants: ['flow'], code: `
    try { await WidgetAI.flow.call('jira-sink', 'createTicket', {}); } catch (e) { WidgetAI.status('completed', e.message + '|' + e.status + '|' + e.runId); }
  ` }), (m) => m.type === 'FLOW_CALL' ? { ok: true, runId: 'fr_2' }
    : m.type === 'FLOW_WAIT' ? { ok: true, done: true, success: false, reason: 'target tab was closed before the flow finished', status: 'failed' } : { ok: true });
  assert.deepEqual(statusDetail(sent), ['target tab was closed before the flow finished|failed|fr_2']);
  const noGrant = await exec(buildWidgetSource({ id: 'w_g', name: 'G', version: 1, grants: [], code: `
    try { await WidgetAI.flow.call('a', 'b', {}); } catch (e) { WidgetAI.status('completed', e.message); }
  ` }), () => ({ ok: true }));
  assert.equal(noGrant.filter(m => m.type === 'FLOW_CALL').length, 0);
  assert.match(statusDetail(noGrant)[0], /grant "flow" not declared/);
});

test('sink: handle() runs only for the baked-in invocation; checkpoint + resumeState + FLOW_RESULT from part id', async () => {
  const w = { id: 'w_f', name: 'Issue → Ticket', version: 2, grants: ['flow'] };
  const code = `
    WidgetAI.flow.handle('other', async () => { throw new Error('must not run'); });
    WidgetAI.flow.handle('createTicket', async (input, ctx) => {
      if (ctx.resumeState && ctx.resumeState.submitted) return { ok: true, evidence: { id: 'TRK-1', text: input.title } };
      await ctx.checkpoint({ submitted: true });
      return { ok: false };
    });`;
  const fresh = await exec(buildPartSource(w, { role: 'jira-sink', code }, { runId: 'fr_3', handler: 'createTicket', input: { title: 'T' }, activate: false, n: 1 }), () => ({ ok: true }));
  assert.deepEqual(fresh.filter(m => m.type.startsWith('FLOW_')).map(m => [m.type, m.widgetId, m.state ?? m.result]), [
    ['FLOW_CHECKPOINT', 'w_f#jira-sink', { submitted: true }],
    ['FLOW_RESULT', 'w_f#jira-sink', { ok: false }],
  ]);
  const resumed = await exec(buildPartSource(w, { role: 'jira-sink', code }, { runId: 'fr_3', handler: 'createTicket', input: { title: 'T' }, resumeState: { submitted: true }, n: 2 }), () => ({ ok: true }));
  const res = resumed.find(m => m.type === 'FLOW_RESULT');
  assert.deepEqual([res.ok, res.result], [true, { ok: true, evidence: { id: 'TRK-1', text: 'T' } }]);
  // thrown handler → FLOW_RESULT ok:false with the message; cancelled run → checkpoint rejects
  const thrown = await exec(buildPartSource(w, { role: 'jira-sink', code: `WidgetAI.flow.handle('createTicket', async (i, ctx) => { await ctx.checkpoint({a:1}); return { ok: true }; });` },
    { runId: 'fr_4', handler: 'createTicket', input: {} }), (m) => m.type === 'FLOW_CHECKPOINT' ? { ok: false, error: 'flow run is cancelled' } : { ok: true });
  const r4 = thrown.find(m => m.type === 'FLOW_RESULT');
  assert.deepEqual([r4.ok, r4.error], [false, 'flow run is cancelled']);
  // a plain (non-invoked) home source has no invocation: handle() is a no-op
  const none = await exec(buildWidgetSource({ ...w, code: `WidgetAI.status('completed', String(WidgetAI.flow.handle('createTicket', async () => ({ ok: true }))));` }), () => ({ ok: true }));
  assert.deepEqual(statusDetail(none), ['false']);
});

test('part source keeps the Phase C danger guard and the part world id', () => {
  const src = buildPartSource({ id: 'w_f', name: 'F', version: 1, grants: ['flow'] }, { role: 'jira-sink', code: `WidgetAI.flow.handle('x', async () => ({ ok: true }));` }, { runId: 'r', handler: 'x', input: {} });
  assert.match(src, /__wwaGuardInstalled/);
  assert.match(src, /const __WID = "w_f#jira-sink"/);
  assert.match(src, /const __FLOW_INV = \{"runId":"r"/);
});
