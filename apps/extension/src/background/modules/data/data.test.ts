import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WidgetRecord } from '@app/contracts';
import { Bus } from '../../bus.js';
import { registerData } from './index.js';
import type { DataBackend } from './service.js';

const page = { id: 'ext', url: 'http://m.test/movie', tab: { id: 3, url: 'http://m.test/movie' } as chrome.tabs.Tab, frameId: 0 } as chrome.runtime.MessageSender;
const panel = { id: 'ext', url: 'chrome-extension://ext/sidepanel.html' } as chrome.runtime.MessageSender;

function setup(widget: Partial<WidgetRecord> | undefined) {
  const calls: Array<[string, string, unknown]> = [];
  const api: DataBackend = {
    async request<T>(method: string, path: string, body: unknown) {
      calls.push([method, path, body]);
      if (path === '/api/data') return { collections: [{ name: 'saved_movies', count: 2, updatedAt: 1 }] } as T;
      if (method === 'GET' && path.endsWith('/missing')) throw new Error('document not found: saved_movies/missing');
      if (method === 'GET' && /\/api\/data\/[^/?]+(\?|$)/.test(path)) return { docs: [{ id: 'dune' }] } as T;
      if (method === 'DELETE') return { removed: 1 } as T;
      return { doc: { id: 'dune', body } } as T;
    },
  };
  const bus = new Bus();
  bus.provide('widgets.authorize', (_id, _url, grant) => (widget?.grants ?? []).includes(grant!) ? undefined : `grant "${grant}" not declared by widget`);
  bus.provide('widgets.get', () => widget as WidgetRecord | undefined);
  registerData(bus, api);
  const us = (m: Record<string, unknown>): Promise<any> => bus.dispatch('userScript', { type: 'WIDGET_DATA', widgetId: 'w_1', requestId: 'r', ...m }, page);
  return { bus, calls, us };
}

test('WIDGET_DATA: grant "data" enforced by the bus, then declared collection by modules/data', async () => {
  const noGrant = setup({ grants: ['log'], collections: ['saved_movies'] });
  assert.deepEqual(await noGrant.us({ op: 'list', collection: 'saved_movies' }), { ok: false, error: 'grant "data" not declared by widget' });

  const { us, calls } = setup({ grants: ['data'], collections: ['saved_movies'] });
  const denied = await us({ op: 'list', collection: 'other_stuff' });
  assert.equal(denied.ok, false);
  assert.match((denied as { error: string }).error, /collection "other_stuff" not declared by widget \(declared: saved_movies\)/);
  assert.equal(calls.length, 0); // never reached the backend

  const bad = await us({ op: 'list', collection: 'Bad Name' });
  assert.match((bad as { error: string }).error, /^\[userScript→SW\] invalid WIDGET_DATA: collection/);
});

test('WIDGET_DATA ops map onto /api/data REST; get of a missing doc → null', async () => {
  const { us, calls } = setup({ grants: ['data'], collections: ['saved_movies'] });
  assert.deepEqual((await us({ op: 'list', collection: 'saved_movies', query: { where: { title: 'Dune' }, limit: 5 } }) as { docs: unknown[] }).docs, [{ id: 'dune' }]);
  await us({ op: 'add', collection: 'saved_movies', id: 'dune', data: { title: 'Dune' } });
  await us({ op: 'update', collection: 'saved_movies', id: 'dune', data: { rating: 5 } });
  assert.equal((await us({ op: 'remove', collection: 'saved_movies', id: 'dune' }) as { removed: boolean }).removed, true);
  assert.equal((await us({ op: 'get', collection: 'saved_movies', id: 'missing' }) as { doc: unknown }).doc, null);
  const noId = await us({ op: 'update', collection: 'saved_movies', data: { a: 1 } });
  assert.match((noId as { error: string }).error, /id is required/);
  assert.deepEqual(calls.map(c => `${c[0]} ${c[1]}`), [
    `GET /api/data/saved_movies?limit=5&where=${encodeURIComponent('{"title":"Dune"}')}`,
    'POST /api/data/saved_movies',
    'PATCH /api/data/saved_movies/dune',
    'DELETE /api/data/saved_movies/dune',
    'GET /api/data/saved_movies/missing',
  ]);
  assert.deepEqual(calls[1][2], { data: { title: 'Dune' }, id: 'dune' });
  assert.deepEqual(calls[2][2], { data: { rating: 5 } });
});

test('panel DATA_* messages + data.collections service', async () => {
  const { bus, calls } = setup(undefined);
  const r: any = await bus.dispatch('panel', { type: 'DATA_LIST_COLLECTIONS' }, panel);
  assert.deepEqual((r as { collections: Array<{ name: string }> }).collections.map(c => c.name), ['saved_movies']);
  assert.equal((await bus.dispatch('panel', { type: 'DATA_LIST', collection: 'saved_movies' }, panel)).ok, true);
  assert.equal(((await bus.dispatch('panel', { type: 'DATA_DELETE', collection: 'saved_movies', id: 'dune' }, panel)) as any).removed, 1);
  assert.equal((await bus.dispatch('panel', { type: 'DATA_CLEAR', collection: 'saved_movies' }, panel)).ok, true);
  assert.deepEqual(await bus.use('data.collections')(), ['saved_movies']);
  assert.deepEqual(calls.map(c => `${c[0]} ${c[1]}`), ['GET /api/data', 'GET /api/data/saved_movies', 'DELETE /api/data/saved_movies/dune', 'DELETE /api/data/saved_movies', 'GET /api/data']);
});
