import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetRequestRecord, NetTrigger } from '@app/contracts';
import {
  analyzeOps, routeTemplates, routeTemplate, segmentPlaceholder, shapeSimilar, tierAfterReplay, canVerify, maxTier,
  NetLog, correlate, REDACTED,
} from '../index.js';

let n = 0;
const rec = (over: Partial<NetRequestRecord> = {}): NetRequestRecord => ({
  id: 'r' + (n++), tabId: 1, frameUrl: 'http://a.test/app', url: 'http://a.test/api/x', method: 'GET', initiator: 'fetch',
  startTs: 1_000 + n * 100, status: 200, ok: true, confirmed: true, ...over,
});
const tplOf = (rs: NetRequestRecord[]) => { const m = routeTemplates(rs); return rs.map(r => m.get(r.id)!.template); };

// ---------- route templates ----------
test('segmentPlaceholder: numeric, uuid, long opaque ids', () => {
  assert.equal(segmentPlaceholder('42'), ':n');
  assert.equal(segmentPlaceholder('3f2504e0-4f89-11d3-9a0c-0305e82c3301'), ':id');
  assert.equal(segmentPlaceholder('a1b2c3d4e5f6a7b8'), ':id');
  assert.equal(segmentPlaceholder('issues'), undefined);
  assert.equal(routeTemplate('http://a.test/repos/x/y/issues/12'), '/repos/x/y/issues/:n');
});

test('route templates: variance across captures → named params; different resources never merge', () => {
  const rs = [
    rec({ url: 'http://a.test/repos/jeff/neohacks/issues/12' }),
    rec({ url: 'http://a.test/repos/octo/hello/issues/7?state=open' }),
    rec({ url: 'http://a.test/api/messages/n1' }),
    rec({ url: 'http://a.test/api/messages/n2' }),
    rec({ url: 'http://a.test/api/drafts' }),
    rec({ url: 'http://a.test/api/messages' }),
  ];
  assert.deepEqual(tplOf(rs), [
    '/repos/:repo/:repo2/issues/:n', '/repos/:repo/:repo2/issues/:n',
    '/api/messages/:message', '/api/messages/:message',
    '/api/drafts', '/api/messages',
  ]);
  const key = routeTemplates(rs).get(rs[0]!.id)!.templateKey;
  assert.equal(key, 'GET /repos/:repo/:repo2/issues/:n');
});

test('route templates: methods and origins are separate', () => {
  const rs = [rec({ url: 'http://a.test/api/m/1', method: 'GET' }), rec({ url: 'http://a.test/api/m/2', method: 'DELETE' }), rec({ url: 'http://b.test/api/m/3' })];
  const m = routeTemplates(rs);
  assert.equal(m.get(rs[0]!.id)!.templateKey, 'GET /api/m/:n');
  assert.equal(m.get(rs[1]!.id)!.templateKey, 'DELETE /api/m/:n');
  assert.equal(analyzeOps(rs).get(rs[0]!.id)!.captures, 1); // b.test capture is a different API
});

// ---------- token / param fields ----------
test('token fields: secret-named, high-entropy, and opaque values differing across captures; human values are params', () => {
  const post = (body: object, headers: Record<string, string> = {}) =>
    rec({ method: 'POST', url: 'http://a.test/api/drafts', requestBody: JSON.stringify(body), requestHeaders: { 'content-type': 'application/json', ...headers } });
  const rs = [
    post({ to: 'a@x.com', subject: 'Hello there', csrf: 'c1', reqSeq: 'ab12cd34ef', meta: { v: 1 } }, { 'x-csrf-token': 'tok' }),
    post({ to: 'b@x.com', subject: 'Other subject', csrf: 'c2', reqSeq: 'zz98yy76xx', meta: { v: 1 } }, { 'x-csrf-token': 'tok2' }),
  ];
  const a = analyzeOps(rs).get(rs[1]!.id)!;
  assert.equal(a.captures, 2);
  assert.deepEqual(a.tokenFields, ['body.csrf', 'body.reqSeq', 'header.x-csrf-token']);
  assert.deepEqual(a.paramFields, ['body.subject', 'body.to']);
  assert.ok(!a.tokenFields.includes('header.content-type'));
  // single capture: a high-entropy value is still a token
  const one = rec({ method: 'POST', url: 'http://a.test/api/save', requestBody: JSON.stringify({ sig: 'Zk3qP9xL2mN8vB4cR7tY1wQ6' }) });
  assert.deepEqual(analyzeOps([one]).get(one.id)!.tokenFields, ['body.sig']);
});

// ---------- dependency inference ----------
test('dependency inference: request token that appeared in an earlier response → dependsOn {opId, path}', () => {
  const csrfOld = rec({ url: 'http://a.test/api/csrf', responseBody: JSON.stringify({ token: 'c0ffee11deadbeef22' }), startTs: 1000 });
  const list = rec({ url: 'http://a.test/api/items', responseBody: JSON.stringify({ items: [{ id: 'itm_9f8e7d6c' }] }), startTs: 1100 });
  const csrf = rec({ url: 'http://a.test/api/csrf', responseBody: JSON.stringify({ data: { token: 'abc123def456ghi789' } }), startTs: 1200 });
  const hdr = rec({ url: 'http://a.test/api/session', responseHeaders: { 'x-next-token': 'Bearer sess9988aabbcc' }, startTs: 1250 });
  const save = rec({
    method: 'POST', url: 'http://a.test/api/drafts', startTs: 1300,
    requestHeaders: { 'x-session': 'sess9988aabbcc' },
    requestBody: JSON.stringify({ csrf: 'abc123def456ghi789', item: 'itm_9f8e7d6c', subject: 'Hello world' }),
  });
  const a = analyzeOps([csrfOld, list, csrf, hdr, save]).get(save.id)!;
  const by = Object.fromEntries(a.dependsOn.map(d => [d.field, d]));
  assert.equal(by['body.csrf']?.opId, csrf.id); // the LATEST response carrying that value
  assert.equal(by['body.csrf']?.path, 'data.token');
  assert.equal(by['body.csrf']?.fromTemplate, 'GET /api/csrf');
  assert.equal(by['body.item']?.path, 'items[0].id');
  assert.equal(by['header.x-session']?.path, 'header:x-next-token');
  assert.equal(by['body.subject'], undefined); // human text never inferred as a dependency
  // a response that came AFTER the request is not a dependency
  const late = rec({ url: 'http://a.test/api/csrf', responseBody: JSON.stringify({ token: 'zzz999yyy888xxx777' }), startTs: 5000 });
  const early = rec({ method: 'POST', url: 'http://a.test/api/drafts', requestBody: JSON.stringify({ csrf: 'zzz999yyy888xxx777' }), startTs: 4000 });
  assert.deepEqual(analyzeOps([early, late]).get(early.id)!.dependsOn, []);
});

test('analysis never contains raw values (field names / paths only)', () => {
  const csrf = rec({ url: 'http://a.test/api/csrf', responseBody: JSON.stringify({ token: 'SECRETVALUE123456789' }) });
  const save = rec({ method: 'POST', url: 'http://a.test/api/drafts', requestBody: JSON.stringify({ csrf: 'SECRETVALUE123456789' }) });
  const json = JSON.stringify([...analyzeOps([csrf, save]).values()]);
  assert.ok(!json.includes('SECRETVALUE'));
});

// ---------- idempotency hints ----------
test('idempotency: mutating op + client-generated id fields; GETs get no hint', () => {
  const post = rec({ method: 'POST', url: 'http://a.test/api/comments', requestHeaders: { 'Idempotency-Key': 'k-1' },
    requestBody: JSON.stringify({ clientMutationId: 'm1', text: 'hi', ref: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }) });
  const a = analyzeOps([post]).get(post.id)!;
  assert.equal(a.mutating, true);
  assert.deepEqual(a.clientIdFields, ['body.clientMutationId', 'body.ref', 'header.idempotency-key']);
  assert.match(a.idempotencyHint!, /FRESH/);
  const plain = rec({ method: 'POST', url: 'http://a.test/api/notes', requestBody: '{"text":"x"}' });
  assert.match(analyzeOps([plain]).get(plain.id)!.idempotencyHint!, /not idempotent/);
  const get = rec();
  assert.equal(analyzeOps([get]).get(get.id)!.idempotencyHint, undefined);
});

// ---------- tiers ----------
test('tiers: replayed only on 2xx + similar shape; never demotes; verify requires replayed', () => {
  const orig = JSON.stringify({ ok: true, draft: { id: 1, to: 'a', subject: 's', body: 'b', ts: 1 } });
  assert.equal(tierAfterReplay('observed', { status: 201, bodyText: JSON.stringify({ ok: true, draft: { id: 2, to: 'x', subject: 'y', body: 'z', ts: 2 } }) }, orig), 'replayed');
  assert.equal(tierAfterReplay('observed', { status: 403, bodyText: JSON.stringify({ ok: false, error: 'stale' }) }, orig), 'observed');
  assert.equal(tierAfterReplay('observed', { status: 200, bodyText: '<html>login</html>' }, orig), 'observed'); // 200 login page ≠ success
  assert.equal(tierAfterReplay('verified', { status: 500 }, orig), 'verified');
  assert.equal(shapeSimilar('plain', 'text'), true);
  assert.equal(shapeSimilar('{"a":1,"b":2,"c":3}', '{"x":1}'), false);
  assert.equal(maxTier('replayed', 'observed'), 'replayed');
  assert.equal(canVerify('observed').ok, false);
  assert.equal(canVerify('replayed').ok, true);
});

test('NetLog: replay → replayed, reportVerified → verified (per template, shared by captures); refusals are honest', () => {
  const log = new NetLog();
  const ok = JSON.stringify({ ok: true, draft: { id: 1 } });
  log.addWebRequest(1, { url: 'http://a.test/api/drafts/1', method: 'POST', ts: 1000 });
  log.addWebRequest(1, { url: 'http://a.test/api/drafts/2', method: 'POST', ts: 2000 });
  const a = log.addRecord(1, rec({ id: 'A', method: 'POST', url: 'http://a.test/api/drafts/1', startTs: 1000, responseBody: ok }));
  log.addRecord(1, rec({ id: 'B', method: 'POST', url: 'http://a.test/api/drafts/2', startTs: 2000, responseBody: ok }));
  log.addRecord(1, rec({ id: 'F', method: 'POST', url: 'http://a.test/api/send', startTs: 3000, confirmed: true })); // forged: no webRequest
  assert.equal(a.confirmed, true);
  const tierOf = (id: string) => log.ops(1).find(o => o.id === id)!.tier;
  assert.equal(tierOf('A'), 'observed');
  assert.equal(log.reportVerified(1, 'A', { readBack: 'x' }).ok, false); // no replay yet
  assert.equal(log.reportVerified(1, 'F', { readBack: 'x' }).ok, false); // unconfirmed
  assert.equal(log.noteReplay(1, 'A', { ok: false, status: 403, bodyText: '{"ok":false,"error":"stale"}' }), 'observed');
  assert.equal(log.noteReplay(1, 'A', { ok: true, status: 201, bodyText: ok }), 'replayed');
  assert.equal(tierOf('B'), 'replayed'); // same template /api/drafts/:n
  const v = log.reportVerified(1, 'B', { readBack: 'GET /api/drafts contains it' });
  assert.deepEqual([v.ok, v.tier], [true, 'verified']);
  const opA = log.ops(1).find(o => o.id === 'A')!;
  assert.equal(opA.tier, 'verified');
  assert.equal(opA.tierEvidence, 'GET /api/drafts contains it');
  assert.equal(opA.analysis?.templateKey, 'POST /api/drafts/:n');
  // tiers survive SW restarts via snapshot/hydrate
  const log2 = new NetLog(); log2.hydrateTiers(log.tierSnapshot());
  assert.equal(log2.tierOf('http://a.test POST /api/drafts/:n').tier, 'verified');
});

test('summaries keep token fields redacted while analysis names them', () => {
  const log = new NetLog();
  log.addWebRequest(1, { url: 'http://a.test/api/drafts', method: 'POST', ts: 1000 });
  log.addRecord(1, rec({ id: 'S', method: 'POST', url: 'http://a.test/api/drafts', startTs: 1000, requestBody: JSON.stringify({ csrf: 'c9f8e7d6c5b4a3', to: 'a@x.com' }) }));
  const s = log.ops(1)[0]!;
  assert.ok(s.requestBodyTemplate!.includes(REDACTED));
  assert.ok(!s.requestBodyTemplate!.includes('c9f8e7d6c5b4a3'));
  assert.ok(s.analysis!.tokenFields.includes('body.csrf'));
  assert.ok(log.recordById(1, 'S')!.requestBody!.includes('c9f8e7d6c5b4a3')); // raw kept for replay
});

// ---------- step attribution ----------
test('step attribution: record stepId is primary; time window is the fallback', () => {
  const g = (ts: number, text: string, stepId?: string): NetTrigger => ({ kind: 'click', target: 'button', text, ts, stepId });
  const gestures = [g(1000, 'Save draft', 's1'), g(1500, 'Other', 's2')];
  // by window the latest gesture (s2 "Other") wins; by step the request belongs to s1
  assert.equal(correlate(rec({ startTs: 2000, stepId: 's1' }), gestures)?.text, 'Save draft');
  assert.equal(correlate(rec({ startTs: 2000 }), gestures)?.text, 'Other');
  assert.equal(correlate(rec({ startTs: 2000, stepId: 'unknown' }), gestures)?.text, 'Other');
  const log = new NetLog();
  for (const x of gestures) log.addGesture(1, x);
  log.addRecord(1, rec({ id: 'P', startTs: 2000, stepId: 's1' }));
  log.addRecord(1, rec({ id: 'W', startTs: 2100, trigger: g(2099, 'forged by page') }));
  const ops = log.ops(1);
  const p = ops.find(o => o.id === 'P')!, w = ops.find(o => o.id === 'W')!;
  assert.deepEqual([p.stepId, p.attribution, p.triggerText], ['s1', 'step', 'click "Save draft"']);
  assert.deepEqual([w.stepId, w.attribution, w.triggerText], ['s2', 'step', 'click "Other"']); // gesture's stepId; page trigger ignored
  log.addRecord(2, rec({ id: 'X', startTs: 2000 }));
  log.addGesture(2, g(1900, 'Plain'));
  log.addRecord(2, rec({ id: 'Y', startTs: 2000 }));
  assert.equal(log.ops(2).find(o => o.id === 'Y')!.attribution, 'window');
});

test('browserOnly: webRequest completions without a probe record (worker requests) are surfaced, never replayable', () => {
  const log = new NetLog();
  log.addWebRequest(1, { url: 'http://a.test/api/seen', method: 'GET', ts: 1000, type: 'xmlhttprequest', statusCode: 200 });
  log.addWebRequest(1, { url: 'http://a.test/worker/poll', method: 'GET', ts: 1100, type: 'xmlhttprequest', statusCode: 204 });
  log.addWebRequest(1, { url: 'http://a.test/img.png', method: 'GET', ts: 1100, type: 'image' });
  log.addRecord(1, rec({ id: 'R', url: 'http://a.test/api/seen', startTs: 1000 }));
  const b = log.browserOnly(1, 'http://a.test', 15, 10_000);
  assert.deepEqual(b.map(o => o.path), ['/worker/poll']);
  assert.equal(b[0]!.browserOnly, true);
  assert.equal(b[0]!.confirmed, undefined);
  assert.equal(log.browserOnly(1, 'http://a.test', 15, 1200).length, 0); // too fresh — the probe record may be in flight
});
