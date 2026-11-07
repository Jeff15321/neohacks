import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildWidgetSource } from '../index.js';

/** Phase A: WidgetAI.db prelude section. */
const run = async (grants: string[], code: string, reply: (m: any) => any) => {
  const sent: any[] = [];
  const chrome = { runtime: { lastError: undefined, sendMessage: (m: any, cb?: (r: any) => void) => { sent.push(m); if (cb) cb(reply(m)); } } };
  vm.runInNewContext(buildWidgetSource({ id: 'w_db', name: 'D', version: 1, grants, code }, 't_db'), { chrome, setTimeout, clearTimeout, console: { error() {} } });
  await new Promise(r => setTimeout(r, 20));
  return sent;
};

test('WidgetAI.db ops send WIDGET_DATA with op/collection/id/data/query and unwrap replies', async () => {
  const sent = await run(['data'], `
    const a = await WidgetAI.db.add('saved_movies', { title: 'Dune' }, 'dune');
    const g = await WidgetAI.db.get('saved_movies', 'dune');
    const l = await WidgetAI.db.list('saved_movies', { where: { title: 'Dune' }, limit: 5 });
    const u = await WidgetAI.db.update('saved_movies', 'dune', { rating: 5 });
    const r = await WidgetAI.db.remove('saved_movies', 'dune');
    WidgetAI.status('completed', JSON.stringify([a.id, g, l.length, u.id, r]));
  `, (m) => m.type !== 'WIDGET_DATA' ? { ok: true }
    : m.op === 'list' ? { ok: true, docs: [{ id: 'dune' }] }
    : m.op === 'get' ? { ok: true, doc: null }
    : m.op === 'remove' ? { ok: true, removed: true }
    : { ok: true, doc: { id: 'dune' } });
  const data = JSON.parse(JSON.stringify(sent.filter(m => m.type === 'WIDGET_DATA'))) as any[]; // cross-realm → plain
  assert.deepEqual(data.map(m => [m.op, m.collection, m.id ?? null]), [
    ['add', 'saved_movies', 'dune'], ['get', 'saved_movies', 'dune'], ['list', 'saved_movies', null], ['update', 'saved_movies', 'dune'], ['remove', 'saved_movies', 'dune'],
  ]);
  assert.deepEqual(data[0].data, { title: 'Dune' });
  assert.deepEqual(data[2].query, { where: { title: 'Dune' }, limit: 5 });
  assert.deepEqual(data[3].data, { rating: 5 });
  assert.ok(data.every((m: any) => m.widgetId === 'w_db' && m.traceId === 't_db' && m.requestId));
  const status = sent.find(m => m.type === 'WIDGET_STATUS');
  assert.equal(status.status, 'completed');
  assert.equal(status.detail, JSON.stringify(['dune', null, 1, 'dune', true]));
});

test('WidgetAI.db requires grant "data" and rejects non-object data', async () => {
  const s1 = await run(['log'], `await WidgetAI.db.list('saved_movies');`, () => ({ ok: true }));
  assert.equal(s1[0].type, 'WIDGET_STATUS');
  assert.match(s1[0].detail, /grant "data" not declared/);
  const s2 = await run(['data'], `await WidgetAI.db.add('saved_movies', 'str');`, () => ({ ok: true }));
  assert.match(s2[0].detail, /data must be a plain JSON object/);
  const s3 = await run(['data'], `await WidgetAI.db.list('x');`, () => ({ ok: false, error: 'collection "x" not declared by widget' }));
  assert.match(s3.find(m => m.type === 'WIDGET_STATUS').detail, /not declared by widget/);
});
