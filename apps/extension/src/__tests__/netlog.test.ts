import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetLog, correlate, summarize } from '../background/netlog.js';
import type { NetRequestRecord, NetTrigger } from '@app/shared';

const rec = (over: Partial<NetRequestRecord> = {}): NetRequestRecord => ({
  id: 'r' + Math.random().toString(36).slice(2, 8), tabId: 1,
  frameUrl: 'http://a.test/page', url: 'http://a.test/api/x', method: 'GET',
  initiator: 'fetch', startTs: 10_000, ...over,
});
const gesture = (ts: number, text = 'Save draft'): NetTrigger => ({ kind: 'click', target: 'button#cm-save', text, ts });

test('correlate picks the most recent gesture inside the window', () => {
  const gs = [gesture(1000, 'first'), gesture(8000, 'second')];
  const t = correlate(rec({ startTs: 10_000 }), gs);
  assert.equal(t?.text, 'second');
});

test('correlate ignores gestures outside the 6s window or after the request', () => {
  assert.equal(correlate(rec({ startTs: 10_000 }), [gesture(1000)]), undefined);   // 9s old
  assert.equal(correlate(rec({ startTs: 10_000 }), [gesture(11_000)]), undefined); // after request
});

test('addRecord stamps tabId, correlates, and ops() prioritizes mutations', () => {
  const log = new NetLog();
  log.addGesture(1, gesture(9_000, 'Save draft'));
  log.addRecord(1, rec({ id: 'g1', method: 'GET', startTs: 5_000 }));
  log.addRecord(1, rec({ id: 'p1', method: 'POST', url: 'http://a.test/api/drafts', startTs: 9_500, requestBody: '{}' }));
  const ops = log.ops(1);
  assert.equal(ops[0].id, 'p1');                       // mutation first despite ordering
  assert.equal(ops[0].triggerText, 'click "Save draft"');
  assert.equal(ops[1].id, 'g1');
  assert.equal(ops[1].triggerText, undefined);         // before the gesture
});

test('ops() origin filter drops records from other page origins', () => {
  const log = new NetLog();
  log.addRecord(1, rec({ id: 'a', frameUrl: 'http://a.test/p' }));
  log.addRecord(1, rec({ id: 'b', frameUrl: 'http://other.test/p' }));
  const ops = log.ops(1, 40, 'http://a.test');
  assert.deepEqual(ops.map(o => o.id), ['a']);
});

test('summarize produces compact op view', () => {
  const s = summarize(rec({
    url: 'http://a.test/api/drafts?x=1', method: 'POST', status: 201,
    requestBody: '{"to":"x"}', responseBody: '{"ok":true}',
    trigger: gesture(1),
  }));
  assert.equal(s.path, '/api/drafts?x=1');
  assert.equal(s.requestBodyTemplate, '{"to":"x"}');
  assert.equal(s.triggerText, 'click "Save draft"');
});

test('hydrate + clearTab', () => {
  const log = new NetLog();
  log.hydrate(2, [rec({ id: 'h1', tabId: 2 })]);
  assert.equal(log.all(2).length, 1);
  log.clearTab(2);
  assert.equal(log.all(2).length, 0);
});
