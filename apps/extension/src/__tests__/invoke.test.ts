import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvokeRequest, buildDirectRequest, sameOrigin, stripForbiddenHeaders,
  headersToRecord, isTextualContentType,
} from '../net/invoke.js';
import type { NetRequestRecord } from '@app/shared';

const rec = (over: Partial<NetRequestRecord> = {}): NetRequestRecord => ({
  id: 'r1', tabId: 1, frameUrl: 'http://a.test/', url: 'http://a.test/api/drafts',
  method: 'POST', initiator: 'fetch', startTs: 1000,
  requestHeaders: { 'content-type': 'application/json', 'x-csrf': 'tok1', cookie: 'SECRET=1' },
  requestBody: '{"to":"a@x.com","subject":"s","body":"b","nonce":"n7"}',
  ...over,
});

test('verbatim replay keeps captured headers + body, strips browser-managed headers', () => {
  const spec = buildInvokeRequest(rec());
  assert.equal(spec.method, 'POST');
  assert.equal(spec.url, 'http://a.test/api/drafts');
  assert.equal(spec.headers?.['x-csrf'], 'tok1');
  assert.equal(spec.headers?.cookie, undefined); // forbidden header stripped
  assert.equal(spec.body, rec().requestBody);
});

test('mergeBody shallow-merges into captured JSON body', () => {
  const spec = buildInvokeRequest(rec(), { mergeBody: { to: 'b@y.com', extra: true } });
  const body = JSON.parse(spec.body!);
  assert.equal(body.to, 'b@y.com');        // overridden
  assert.equal(body.subject, 's');         // captured field preserved
  assert.equal(body.nonce, 'n7');          // dynamic token preserved
  assert.equal(body.extra, true);          // new field added
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
  assert.equal(spec.body, '{"a":1}');
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
  const h = stripForbiddenHeaders({ 'sec-fetch-mode': 'cors', 'x-ok': '1', origin: 'x' });
  assert.deepEqual(h, { 'x-ok': '1' });
  assert.deepEqual(headersToRecord([['a', '1'], ['b', '2']]), { a: '1', b: '2' });
  assert.ok(isTextualContentType('application/json; charset=utf-8'));
  assert.ok(!isTextualContentType('video/mp4'));
});
