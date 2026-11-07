import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_LIMITS } from '@app/contracts';
import { openDb } from '../../store/db.js';
import { DataError, DataStore } from './store.js';
import { buildApp } from '../../server.js';
import { loadConfig } from '../../config.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const fresh = () => { let t = 1_000; return new DataStore(openDb(':memory:'), () => ++t); };
const err = (fn: () => unknown, status: number, code?: string) => assert.throws(fn, (e: unknown) =>
  e instanceof DataError && e.status === status && (!code || e.code === code));

test('store: CRUD + newest-first list + collections with counts', () => {
  const s = fresh();
  const d1 = s.create(A, 'saved_movies', { title: 'Dune', year: 2021 });
  const d2 = s.create(A, 'saved_movies', { title: 'Arrival', year: 2016 }, 'arrival');
  assert.match(d1.id, /^d_/);
  assert.equal(d2.id, 'arrival');
  assert.deepEqual(s.get(A, 'saved_movies', 'arrival')?.data, { title: 'Arrival', year: 2016 });
  assert.deepEqual(s.list(A, 'saved_movies').docs.map(d => d.data.title), ['Arrival', 'Dune']);
  s.create(A, 'notes', { text: 'x' });
  assert.deepEqual(s.listCollections(A).map(c => [c.name, c.count]), [['notes', 1], ['saved_movies', 2]]);
  assert.equal(s.remove(A, 'saved_movies', d1.id), true);
  assert.equal(s.remove(A, 'saved_movies', d1.id), false);
  assert.equal(s.get(A, 'saved_movies', d1.id), undefined);
  assert.equal(s.clear(A, 'saved_movies'), 1);
  assert.deepEqual(s.listCollections(A).map(c => c.name), ['notes']);
});

test('store: upsert with id keeps createdAt, replaces data', () => {
  const s = fresh();
  const a = s.create(A, 'c', { a: 1, b: 2 }, 'x');
  const b = s.create(A, 'c', { a: 9 }, 'x');
  assert.equal(b.createdAt, a.createdAt);
  assert.ok(b.updatedAt > a.updatedAt);
  assert.deepEqual(b.data, { a: 9 });
  assert.equal(s.list(A, 'c').docs.length, 1);
});

test('store: user isolation (A cannot see or touch B)', () => {
  const s = fresh();
  s.create(A, 'saved_movies', { title: 'Dune' }, 'dune');
  s.create(B, 'saved_movies', { title: 'Heat' }, 'heat');
  assert.deepEqual(s.list(A, 'saved_movies').docs.map(d => d.id), ['dune']);
  assert.deepEqual(s.list(B, 'saved_movies').docs.map(d => d.id), ['heat']);
  assert.equal(s.get(A, 'saved_movies', 'heat'), undefined);
  assert.equal(s.remove(A, 'saved_movies', 'heat'), false);
  err(() => s.merge(A, 'saved_movies', 'heat', { x: 1 }), 404, 'not_found');
  assert.equal(s.clear(A, 'saved_movies'), 1);
  assert.equal(s.list(B, 'saved_movies').docs.length, 1);
  // same id in two users' collections is fine
  s.create(A, 'saved_movies', { title: 'mine' }, 'heat');
  assert.equal(s.get(B, 'saved_movies', 'heat')?.data.title, 'Heat');
});

test('store: PATCH merges shallowly, PUT replaces; missing → 404', () => {
  const s = fresh();
  s.create(A, 'c', { a: 1, nested: { x: 1, y: 2 } }, 'k');
  assert.deepEqual(s.merge(A, 'c', 'k', { b: 2, nested: { x: 5 } }).data, { a: 1, b: 2, nested: { x: 5 } });
  assert.deepEqual(s.replace(A, 'c', 'k', { only: true }).data, { only: true });
  assert.deepEqual(s.get(A, 'c', 'k')?.data, { only: true });
  err(() => s.replace(A, 'c', 'missing', {}), 404);
});

test('store: where filter (string, number, boolean, null; AND of keys) + pagination cursor', () => {
  const s = fresh();
  s.create(A, 'm', { title: 'Dune', year: 2021, seen: true, note: null });
  s.create(A, 'm', { title: 'Dune', year: 1984, seen: false });
  s.create(A, 'm', { title: 'Heat', year: 1995, seen: true });
  const titles = (w: Record<string, string | number | boolean | null>) => s.list(A, 'm', { where: w }).docs.map(d => `${d.data.title}/${d.data.year}`);
  assert.deepEqual(titles({ title: 'Dune' }), ['Dune/1984', 'Dune/2021']);
  assert.deepEqual(titles({ year: 1995 }), ['Heat/1995']);
  assert.deepEqual(titles({ seen: true }), ['Heat/1995', 'Dune/2021']);
  assert.deepEqual(titles({ seen: false }), ['Dune/1984']);
  assert.deepEqual(titles({ note: null }), ['Dune/2021']);
  assert.deepEqual(titles({ title: 'Dune', seen: true }), ['Dune/2021']);
  assert.deepEqual(titles({ title: 'Nope' }), []);
  const p1 = s.list(A, 'm', { limit: 2 });
  assert.equal(p1.docs.length, 2);
  assert.ok(p1.next);
  const p2 = s.list(A, 'm', { limit: 2, after: p1.next });
  assert.deepEqual(p2.docs.map(d => d.data.title), ['Dune']);
  assert.equal(p2.next, undefined);
  err(() => s.list(A, 'm', { where: { 'a.b': 1 } as never }), 400, 'validation');
  err(() => s.list(A, 'm', { where: { a: { x: 1 } } as never }), 400, 'validation');
});

test('store: limits + validation errors', () => {
  const s = fresh();
  for (const bad of ['Bad', 'has space', '', 'x'.repeat(65), '../etc']) err(() => s.create(A, bad, { a: 1 }), 400, 'validation');
  err(() => s.create(A, 'c', { a: 1 }, 'bad id!'), 400, 'validation');
  err(() => s.create(A, 'c', [] as never), 400, 'validation');
  err(() => s.create(A, 'c', { blob: 'x'.repeat(DATA_LIMITS.DOC_MAX_BYTES) }), 413, 'too_large');
  // also on update
  s.create(A, 'c', { a: 1 }, 'k');
  err(() => s.merge(A, 'c', 'k', { blob: 'x'.repeat(DATA_LIMITS.DOC_MAX_BYTES) }), 413);
  // collections per user
  for (let i = 1; i < DATA_LIMITS.MAX_COLLECTIONS_PER_USER; i++) s.create(A, `c${i}`, { i });
  err(() => s.create(A, 'one_too_many', { a: 1 }), 409, 'limit');
  s.create(A, 'c1', { more: true }); // existing collection still writable
  s.create(B, 'one_too_many', { a: 1 }); // other user unaffected
});

test('store: docs per collection cap', () => {
  const s = fresh();
  const db = (s as unknown as { db: import('../../store/db.js').Db }).db;
  const ins = db.prepare('INSERT INTO docs (user_id, collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)');
  db.exec('BEGIN');
  for (let i = 0; i < DATA_LIMITS.MAX_DOCS_PER_COLLECTION; i++) ins.run(A, 'big', `d${i}`, '{}');
  db.exec('COMMIT');
  err(() => s.create(A, 'big', { a: 1 }), 409, 'limit');
  s.create(A, 'big', { a: 1 }, 'd5'); // upsert of an existing id is allowed at the cap
});

// ---------- routes via app.inject ----------
const TOKEN = 'test-token';
const cfg = loadConfig({ LLM_PROVIDER: 'mock', EXTENSION_AUTH_TOKEN: TOKEN, DATA_DB_PATH: ':memory:' } as NodeJS.ProcessEnv);
const h = (user?: string) => ({ 'x-extension-token': TOKEN, ...(user ? { 'x-user-id': user } : {}) });

test('routes: full REST cycle scoped by x-user-id', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  try {
    const post = (u: string, c: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/data/${c}`, headers: h(u), payload: payload as object });
    let r = await post(A, 'saved_movies', { data: { title: 'Dune', year: 2021 } });
    assert.equal(r.statusCode, 200, r.body);
    const id = r.json().doc.id;
    r = await post(A, 'saved_movies', { id: 'arrival', data: { title: 'Arrival' } });
    assert.equal(r.json().doc.id, 'arrival');
    await post(B, 'saved_movies', { data: { title: 'Heat' } });

    r = await app.inject({ method: 'GET', url: '/api/data', headers: h(A) });
    assert.deepEqual(r.json().collections.map((c: { name: string; count: number }) => [c.name, c.count]), [['saved_movies', 2]]);

    r = await app.inject({ method: 'GET', url: '/api/data/saved_movies', headers: h(A) });
    assert.deepEqual(r.json().docs.map((d: { data: { title: string } }) => d.data.title), ['Arrival', 'Dune']);

    r = await app.inject({ method: 'GET', url: `/api/data/saved_movies?where=${encodeURIComponent('{"title":"Dune"}')}&limit=5`, headers: h(A) });
    assert.deepEqual(r.json().docs.map((d: { id: string }) => d.id), [id]);

    r = await app.inject({ method: 'GET', url: `/api/data/saved_movies/${id}`, headers: h(A) });
    assert.equal(r.json().doc.data.title, 'Dune');
    r = await app.inject({ method: 'GET', url: `/api/data/saved_movies/${id}`, headers: h(B) });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'not_found');

    r = await app.inject({ method: 'PATCH', url: `/api/data/saved_movies/${id}`, headers: h(A), payload: { data: { rating: 5 } } });
    assert.deepEqual(r.json().doc.data, { title: 'Dune', year: 2021, rating: 5 });
    r = await app.inject({ method: 'PUT', url: `/api/data/saved_movies/${id}`, headers: h(A), payload: { data: { title: 'Dune: Part One' } } });
    assert.deepEqual(r.json().doc.data, { title: 'Dune: Part One' });

    r = await app.inject({ method: 'DELETE', url: `/api/data/saved_movies/${id}`, headers: h(A) });
    assert.deepEqual([r.statusCode, r.json().removed], [200, 1]);
    r = await app.inject({ method: 'DELETE', url: '/api/data/saved_movies', headers: h(A) });
    assert.equal(r.json().removed, 1);
    r = await app.inject({ method: 'GET', url: '/api/data/saved_movies', headers: h(B) });
    assert.equal(r.json().docs.length, 1); // B untouched
  } finally { await app.close(); }
});

test('routes: errors — missing user id, bad token, bad collection, bad body, bad where, too large', async () => {
  const { app } = await buildApp(cfg, { logger: false });
  try {
    let r = await app.inject({ method: 'GET', url: '/api/data', headers: h() });
    assert.deepEqual([r.statusCode, r.json().code], [400, 'validation']);
    assert.match(r.json().error, /x-user-id/);
    r = await app.inject({ method: 'GET', url: '/api/data', headers: { 'x-user-id': A } });
    assert.equal(r.statusCode, 401);
    r = await app.inject({ method: 'POST', url: '/api/data/Bad%20Name', headers: h(A), payload: { data: { a: 1 } } });
    assert.deepEqual([r.statusCode, r.json().code], [400, 'validation']);
    r = await app.inject({ method: 'POST', url: '/api/data/ok', headers: h(A), payload: { data: 'str' } });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, /\[extension→backend\] invalid POST \/api\/data\/:collection/);
    r = await app.inject({ method: 'GET', url: '/api/data/ok?where=notjson', headers: h(A) });
    assert.equal(r.statusCode, 400);
    r = await app.inject({ method: 'GET', url: `/api/data/ok?limit=${DATA_LIMITS.LIST_MAX_LIMIT + 1}`, headers: h(A) });
    assert.equal(r.statusCode, 400);
    r = await app.inject({ method: 'POST', url: '/api/data/ok', headers: h(A), payload: { data: { blob: 'x'.repeat(DATA_LIMITS.DOC_MAX_BYTES) } } });
    assert.deepEqual([r.statusCode, r.json().code], [413, 'too_large']);
    r = await app.inject({ method: 'PATCH', url: '/api/data/ok/nope', headers: h(A), payload: { data: { a: 1 } } });
    assert.equal(r.statusCode, 404);
  } finally { await app.close(); }
});
