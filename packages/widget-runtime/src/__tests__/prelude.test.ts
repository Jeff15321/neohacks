import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import vm from 'node:vm';
import { buildWidgetSource } from '../index.js';

const w = { id: 'w_test', name: 'T', version: 2, grants: ['inference', 'log'], code: 'WidgetAI.log("hi"); await WidgetAI.inference({ prompt: "p" }).then(t => WidgetAI.status("completed", t));' };

test('generated source parses', () => {
  acorn.parse(buildWidgetSource(w, 't_1'), { ecmaVersion: 'latest' });
});

test('prelude bridges messages with widgetId + traceId and enforces grants', async () => {
  const sent: any[] = [];
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (m: any, cb?: (r: any) => void) => { sent.push(m); if (cb) cb(m.type === 'WIDGET_INFERENCE' ? { ok: true, text: 'reply' } : { ok: true }); },
    },
  };
  await vm.runInNewContext(buildWidgetSource(w, 't_1').replace(/\)\.catch\(/, ').then(() => {}).catch('), { chrome, setTimeout, clearTimeout, console });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(sent.map(m => m.type), ['WIDGET_LOG', 'WIDGET_INFERENCE', 'WIDGET_STATUS']);
  assert.ok(sent.every(m => m.widgetId === 'w_test' && m.traceId === 't_1'));
  assert.equal(sent[2].detail, 'reply');

  const denied: any[] = [];
  const chrome2 = { runtime: { sendMessage: (m: any) => denied.push(m) } };
  vm.runInNewContext(buildWidgetSource({ ...w, grants: [], code: 'await WidgetAI.storage.get("k");' }, 't_2'), { chrome: chrome2, setTimeout, clearTimeout, console: { error() {} } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(denied[0].type, 'WIDGET_STATUS');
  assert.equal(denied[0].status, 'failed');
  assert.match(denied[0].detail, /grant "storage" not declared/);
});

test('WidgetAI.net.reportVerified sends {opId, evidence} and returns the refusal without throwing', async () => {
  const sent: any[] = [];
  const chrome = { runtime: { lastError: undefined, sendMessage: (m: any, cb?: (r: any) => void) => {
    sent.push(m);
    if (cb) cb(m.type === 'WIDGET_NET_REPORT_VERIFIED' ? { ok: true, verified: false, tier: 'observed', error: 'no replay' } : { ok: true });
  } } };
  const code = 'const v = await WidgetAI.net.reportVerified("op1", "GET /x contains y"); WidgetAI.status("completed", JSON.stringify(v));';
  vm.runInNewContext(buildWidgetSource({ ...w, grants: ['network'], code }, 't_3'), { chrome, setTimeout, clearTimeout, console });
  await new Promise(r => setTimeout(r, 10));
  const rv = sent.find(m => m.type === 'WIDGET_NET_REPORT_VERIFIED');
  assert.deepEqual(JSON.parse(JSON.stringify([rv.opId, rv.evidence])), ['op1', { readBack: 'GET /x contains y' }]);
  assert.deepEqual(JSON.parse(sent.find(m => m.type === 'WIDGET_STATUS').detail), { verified: false, tier: 'observed', error: 'no replay' });
});
