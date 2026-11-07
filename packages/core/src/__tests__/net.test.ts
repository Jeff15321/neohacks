import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetRequestRecord, NetTrigger } from '@app/contracts';
import {
  buildInvokeRequest, buildDirectRequest, sameOrigin, stripForbiddenHeaders, headersToRecord, isTextualContentType,
  NetLog, correlate, summarize, matchesWebRequest,
} from '../index.js';

const rec = (over: Partial<NetRequestRecord> = {}): NetRequestRecord => ({
  id: 'r' + Math.random().toString(36).slice(2, 8), tabId: 1, frameUrl: 'http://a.test/page',
  url: 'http://a.test/api/drafts', method: 'POST', initiator: 'fetch', startTs: 10_000,
  requestHeaders: { 'content-type': 'application/json', 'x-csrf': 'tok1', cookie: 'SECRET=1' },
  requestBody: '{"to":"a@x.com","subject":"s","body":"b","nonce":"n7"}',
  ...over,
});
const gesture = (ts: number, text = 'Save draft'): NetTrigger => ({ kind: 'click', target: 'button#cm-save', text, ts });

// --- invoke (ported from MVP) ---
test('verbatim replay keeps captured headers + body, strips browser-managed headers', () => {
  const spec = buildInvokeRequest(rec());
  assert.equal(spec.method, 'POST');
  assert.equal(spec.headers?.['x-csrf'], 'tok1');
  assert.equal(spec.headers?.cookie, undefined);
  assert.equal(spec.body, rec().requestBody);
});

test('mergeBody shallow-merges into captured JSON body', () => {
  const body = JSON.parse(buildInvokeRequest(rec(), { mergeBody: { to: 'b@y.com', extra: true } }).body!);
  assert.equal(body.to, 'b@y.com');
  assert.equal(body.subject, 's');
  assert.equal(body.nonce, 'n7');
  assert.equal(body.extra, true);
});

test('mergeBody on non-JSON body throws a helpful error', () => {
  const r = rec({ requestBody: 'a=1&b=2', contentType: 'application/x-www-form-urlencoded' });
  assert.throws(() => buildInvokeRequest(r, { mergeBody: { a: '9' } }), /JSON/);
});

test('body override replaces; object body becomes JSON + content-type', () => {
  const spec = buildInvokeRequest(rec({ requestHeaders: {} }), { body: { to: 'c@z.com' } });
  assert.equal(spec.body, '{"to":"c@z.com"}');
  assert.equal(spec.headers?.['content-type'], 'application/json');
});

test('header overrides merge; null deletes; GET drops body', () => {
  const spec = buildInvokeRequest(rec({ method: 'GET' }), { headers: { 'x-csrf': null, 'x-new': '1' } });
  assert.equal(spec.headers?.['x-csrf'], undefined);
  assert.equal(spec.headers?.['x-new'], '1');
  assert.equal(spec.body, undefined);
});

test('buildDirectRequest resolves relative URLs + defaults method', () => {
  const spec = buildDirectRequest({ url: '/api/x', body: { a: 1 } }, 'http://a.test/page');
  assert.equal(spec.url, 'http://a.test/api/x');
  assert.equal(spec.method, 'POST');
  const get = buildDirectRequest({ url: 'api/y' }, 'http://a.test/dir/page');
  assert.equal(get.url, 'http://a.test/dir/api/y');
  assert.equal(get.method, 'GET');
});

test('sameOrigin enforces the replay boundary', () => {
  assert.ok(sameOrigin('http://a.test/x', 'http://a.test/page'));
  assert.ok(sameOrigin('/x', 'http://a.test/page'));
  assert.ok(!sameOrigin('http://evil.test/x', 'http://a.test/page'));
});

test('stripForbiddenHeaders + headersToRecord + isTextualContentType', () => {
  assert.deepEqual(stripForbiddenHeaders({ 'sec-fetch-mode': 'cors', 'x-ok': '1', origin: 'x' }), { 'x-ok': '1' });
  assert.deepEqual(headersToRecord([['a', '1'], ['b', '2']]), { a: '1', b: '2' });
  assert.ok(isTextualContentType('application/json; charset=utf-8'));
  assert.ok(!isTextualContentType('video/mp4'));
});

// --- netlog (ported) ---
test('correlate picks the most recent gesture inside the window; ignores outside/after', () => {
  assert.equal(correlate(rec(), [gesture(1000, 'first'), gesture(8000, 'second')])?.text, 'second');
  assert.equal(correlate(rec(), [gesture(1000)]), undefined);
  assert.equal(correlate(rec(), [gesture(11_000)]), undefined);
});

test('addRecord stamps tabId + provenance, correlates, and ops() prioritizes mutations', () => {
  const log = new NetLog();
  log.addGesture(1, gesture(9_000));
  log.addRecord(1, rec({ id: 'g1', method: 'GET', startTs: 5_000, requestBody: undefined, tabId: 99 }));
  log.addRecord(1, rec({ id: 'p1', startTs: 9_500 }));
  const ops = log.ops(1);
  assert.equal(ops[0].id, 'p1');
  assert.equal(ops[0].triggerText, 'click "Save draft"');
  assert.equal(ops[1].triggerText, undefined);
  assert.equal(log.recordById(1, 'g1')?.tabId, 1);
  assert.equal(log.recordById(1, 'g1')?.provenance, 'page');
});

test('ops() origin filter drops records from other page origins', () => {
  const log = new NetLog();
  log.addRecord(1, rec({ id: 'a', frameUrl: 'http://a.test/p' }));
  log.addRecord(1, rec({ id: 'b', frameUrl: 'http://other.test/p' }));
  assert.deepEqual(log.ops(1, 40, 'http://a.test').map(o => o.id), ['a']);
});

test('hydrate + clearTab', () => {
  const log = new NetLog();
  log.hydrate(2, [rec({ id: 'h1', tabId: 2 })]);
  assert.equal(log.all(2).length, 1);
  log.clearTab(2);
  assert.equal(log.all(2).length, 0);
});

// --- integrity cross-check (new, doc §4 1b) ---
test('webRequest confirmation works in either arrival order; forged records stay unconfirmed', () => {
  const log = new NetLog();
  // probe record first, webRequest later
  log.addRecord(1, rec({ id: 'p1', startTs: 10_000, durationMs: 50 }));
  assert.equal(log.recordById(1, 'p1')?.confirmed, false);
  assert.equal(log.addWebRequest(1, { url: 'http://a.test/api/drafts', method: 'POST', ts: 10_040 }), 1);
  assert.equal(log.recordById(1, 'p1')?.confirmed, true);
  // webRequest first, record later
  log.addWebRequest(1, { url: 'http://a.test/api/other', method: 'GET', ts: 20_010 });
  log.addRecord(1, rec({ id: 'p2', url: 'http://a.test/api/other', method: 'GET', startTs: 20_000 }));
  assert.equal(log.recordById(1, 'p2')?.confirmed, true);
  // forged: no matching webRequest
  log.addRecord(1, rec({ id: 'forged', url: 'http://a.test/api/admin/delete', startTs: 30_000 }));
  assert.equal(log.recordById(1, 'forged')?.confirmed, false);
});

test('matchesWebRequest requires same url (ignoring hash), method and time window', () => {
  const r = rec({ startTs: 10_000, durationMs: 100 });
  assert.ok(matchesWebRequest(r, { url: 'http://a.test/api/drafts#x', method: 'post', ts: 10_100 }));
  assert.ok(!matchesWebRequest(r, { url: 'http://a.test/api/drafts', method: 'GET', ts: 10_100 }));
  assert.ok(!matchesWebRequest(r, { url: 'http://a.test/api/drafts', method: 'POST', ts: 20_000 }));
});

test('summarize redacts secrets by default', () => {
  const s = summarize(rec({
    url: 'http://a.test/api/drafts?x=1', status: 201,
    requestBody: '{"to":"x","csrfToken":"abc123","password":"hunter2"}', responseBody: '{"ok":true}', trigger: gesture(1),
  }));
  assert.equal(s.path, '/api/drafts?x=1');
  const body = JSON.parse(s.requestBodyTemplate!);
  assert.equal(body.to, 'x');
  assert.equal(body.csrfToken, '[REDACTED]');
  assert.equal(body.password, '[REDACTED]');
  assert.equal(s.triggerText, 'click "Save draft"');
  assert.match(summarize(rec({ requestBody: '{"password":"p"}' }), false).requestBodyTemplate!, /"p"/);
});
