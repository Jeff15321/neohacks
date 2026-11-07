import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedWidget } from './validate.js';

const good = JSON.stringify({
  name: 'T', description: 'd', matchPatterns: ['*://a.com/*'], grants: ['inference'],
  code: 'const b = document.createElement("button"); document.body.appendChild(b);',
  plan: ['Add a button'], changeSummary: '', consequentialActions: [], warnings: [],
});

test('parses a clean widget (incl. plan; empty changeSummary dropped)', () => {
  const r = parseGeneratedWidget(good);
  assert.equal(r.widget?.name, 'T');
  assert.deepEqual(r.widget?.grants, ['inference']);
  assert.deepEqual(r.widget?.plan, ['Add a button']);
  assert.equal(r.widget?.changeSummary, undefined);
});

test('strips markdown fences', () => assert.ok(parseGeneratedWidget('```json\n' + good + '\n```').widget));

test('accepts the network grant; filters unknown grants; defaults matchPatterns', () => {
  const w = JSON.parse(good); w.grants = ['inference', 'network', 'admin']; delete w.matchPatterns;
  const r = parseGeneratedWidget(JSON.stringify(w));
  assert.deepEqual(r.widget?.grants, ['inference', 'network']);
  assert.deepEqual(r.widget?.matchPatterns, ['*://*/*']);
});

test('rejects banned constructs, bad match patterns, broken syntax', () => {
  const w = JSON.parse(good);
  assert.match(parseGeneratedWidget(JSON.stringify({ ...w, code: w.code + ' fetch("/x");' })).error ?? '', /banned/);
  assert.match(parseGeneratedWidget(JSON.stringify({ ...w, matchPatterns: ['javascript:alert(1)'] })).error ?? '', /bad matchPattern/);
  assert.match(parseGeneratedWidget(JSON.stringify({ ...w, code: w.code + ' x.y((;' })).error ?? '', /syntax/);
  assert.match(parseGeneratedWidget('no json here').error ?? '', /no JSON/);
});
