import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedWidget } from './validate.js';
import { buildWidgetUserPrompt, widgetSystemPrompt, WIDGET_JSON_SCHEMA } from './prompts/widget.js';
import { widgetMock } from './prompts/widget.mock.js';

/** Phase A: `collections` + grant "data" validation, prompt + schema + mock wiring. */
const base = {
  name: 'Save movie', description: 'd', matchPatterns: ['*://a.com/*'], grants: ['data'], collections: ['saved_movies'],
  code: 'const r = await WidgetAI.db.add("saved_movies", { title: "Dune" }); WidgetAI.log(r.id);',
  plan: [], changeSummary: '', consequentialActions: [], warnings: [],
};
const parse = (o: object) => parseGeneratedWidget(JSON.stringify({ ...base, ...o }));

test('accepts the data grant with declared collections (deduped)', () => {
  const r = parse({ collections: ['saved_movies', 'saved_movies'] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.widget?.grants, ['data']);
  assert.deepEqual(r.widget?.collections, ['saved_movies']);
});

test('rejects bad collection names / non-array', () => {
  assert.match(parse({ collections: ['Saved Movies'] }).error ?? '', /bad collection name/);
  assert.match(parse({ collections: ['x'.repeat(65)] }).error ?? '', /bad collection name/);
  assert.match(parse({ collections: 'saved_movies' }).error ?? '', /array/);
  assert.match(parse({ collections: Array.from({ length: 11 }, (_, i) => `c${i}`) }).error ?? '', /too many/);
});

test('data grant requires collections; db use requires the grant; literal names must be declared', () => {
  assert.match(parse({ collections: [] }).error ?? '', /requires declaring the collections/);
  assert.match(parse({ grants: ['log'], collections: [] }).error ?? '', /grant "data" is not declared/);
  assert.match(parse({ code: 'await WidgetAI.db.list(\'movies_list\'); WidgetAI.log("x");' }).error ?? '', /"movies_list" that is not declared/);
});

test('collections without grant are dropped with a warning; widgets without db have no collections', () => {
  const r = parse({ grants: ['log'], code: 'const b = document.createElement("button"); document.body.appendChild(b);' });
  assert.equal(r.widget?.collections, undefined);
  assert.ok(r.warnings.some(w => /collections ignored/.test(w)));
  const plain = parse({ grants: ['log'], collections: undefined, code: 'const b = document.createElement("button"); document.body.appendChild(b);' });
  assert.equal(plain.widget?.collections, undefined);
  assert.equal(plain.warnings.length, 0);
});

test('prompt documents WidgetAI.db, schema requires collections, user prompt lists existing collections', () => {
  const sys = widgetSystemPrompt();
  assert.match(sys, /WidgetAI\.db\.list/);
  assert.match(sys, /textContent/);
  assert.ok((WIDGET_JSON_SCHEMA.required as string[]).includes('collections'));
  const pageContext = { url: 'http://x/', origin: 'http://x', title: 't', landmarks: [], insertionCandidates: [], textSample: '', interactive: [] };
  const p = buildWidgetUserPrompt({ request: 'show saved', pageContext, existingCollections: ['saved_movies', 'notes'] });
  assert.match(p, /EXISTING DATA COLLECTIONS[^\n]*\n- saved_movies\n- notes/);
  assert.doesNotMatch(buildWidgetUserPrompt({ request: 'x', pageContext }), /EXISTING DATA COLLECTIONS/);
});

test('mock: movies fixture → Save movie / My saved movies widgets that validate and share saved_movies', () => {
  const mk = (url: string, request: string) => widgetMock({ messages: [{ role: 'user', content: `url: ${url}\nUSER REQUEST: ${request}` }] } as never);
  const save = parseGeneratedWidget(mk('http://127.0.0.1:8803/fixture-movies/movie.html?id=dune', 'add a button to save this movie') as string);
  assert.equal(save.error, undefined);
  assert.equal(save.widget?.name, 'Save movie');
  assert.deepEqual(save.widget?.collections, ['saved_movies']);
  const list = parseGeneratedWidget(mk('http://127.0.0.1:8803/fixture-movies/watchlist.html', 'show my saved movies') as string);
  assert.equal(list.error, undefined);
  assert.equal(list.widget?.name, 'My saved movies');
  assert.deepEqual(list.widget?.collections, ['saved_movies']);
  assert.ok(list.widget?.grants.includes('data'));
});
