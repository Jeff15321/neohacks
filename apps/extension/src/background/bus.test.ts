import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from './bus.js';

const panel = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' } as chrome.runtime.MessageSender;
const page = { id: 'ext', url: 'http://a.test/', tab: { id: 7, url: 'http://a.test/' } as chrome.tabs.Tab, frameId: 0 } as chrome.runtime.MessageSender;

test('validates per boundary, names boundary + type on error, logs every message', async () => {
  const bus = new Bus();
  bus.on('LIST_WIDGETS', () => ({ widgets: [] }));
  const ok = await bus.dispatch('panel', { type: 'LIST_WIDGETS', traceId: 't_1' }, panel);
  assert.deepEqual(ok, { ok: true, traceId: 't_1', widgets: [] });

  const bad = await bus.dispatch('panel', { type: 'GENERATE_WIDGET' }, panel);
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /^\[panel→SW\] invalid GENERATE_WIDGET: request/);

  const unknown = await bus.dispatch('content', { type: 'NOPE' }, page);
  assert.match((unknown as { error: string }).error, /\[content→SW\] invalid NOPE/);

  const log = bus.log.list();
  assert.deepEqual(log.map(e => [e.type, e.channel, e.ok]), [['LIST_WIDGETS', 'panel', true], ['GENERATE_WIDGET', 'panel', false], ['NOPE', 'content', false]]);
  assert.equal(log[0].traceId, 't_1');
  assert.equal(log[2].from, 'content:7');
});

test('assigns a traceId when missing and passes sender tab info to handlers', async () => {
  const bus = new Bus();
  let seen: { tabId?: number; traceId: string; tabUrl: string } | undefined;
  bus.onPage('WWA_GESTURE', (_m, ctx) => { seen = ctx; });
  const r = await bus.dispatch('content', { type: 'WWA_GESTURE', gesture: { kind: 'click', target: 'button', ts: 1 } }, page);
  assert.equal(r.ok, true);
  assert.equal(seen?.tabId, 7);
  assert.equal(seen?.tabUrl, 'http://a.test/');
  assert.match(seen!.traceId, /^t_/);
});

test('user-script messages go through widgets.authorize with the declared grant', async () => {
  const bus = new Bus();
  const calls: Array<[string, string, string | undefined]> = [];
  bus.provide('widgets.authorize', (id, url, grant) => { calls.push([id, url, grant]); return grant === 'network' ? 'grant "network" not declared by widget' : undefined; });
  bus.onUserScript('WIDGET_LOG', () => ({}));
  bus.onUserScript('WIDGET_NET_OPS', () => ({ operations: [] }), 'network');
  assert.equal((await bus.dispatch('userScript', { type: 'WIDGET_LOG', widgetId: 'w_1', level: 'info', message: 'hi' }, page)).ok, true);
  const denied = await bus.dispatch('userScript', { type: 'WIDGET_NET_OPS', widgetId: 'w_1', requestId: 'r' }, page);
  assert.deepEqual(denied, { ok: false, error: 'grant "network" not declared by widget' });
  assert.deepEqual(calls, [['w_1', 'http://a.test/', undefined], ['w_1', 'http://a.test/', 'network']]);
});

test('broadcasts are validated; services are logged as internal calls', async () => {
  const sent: unknown[] = [];
  const bus = new Bus({ broadcast: m => sent.push(m) });
  bus.broadcast({ type: 'ERROR', message: 'x' });
  bus.broadcast({ type: 'ERROR' } as never);
  assert.equal(sent.length, 1);
  bus.provide('widgets.list', () => []);
  assert.deepEqual(bus.use('widgets.list')(), []);
  const types = bus.log.list().map(e => `${e.channel}:${e.type}:${e.ok}`);
  assert.deepEqual(types, ['broadcast:ERROR:true', 'broadcast:ERROR:false', 'internal:widgets.list:true']);
  assert.throws(() => bus.use('page.context'), /not provided/);
});
