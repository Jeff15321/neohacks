import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedWidget } from '../generation/parse.js';

const good = JSON.stringify({
  name: 'T', description: 'd', matchPatterns: ['*://a.com/*'], grants: ['inference'],
  code: 'const b = document.createElement("button"); document.body.appendChild(b);',
});

test('parses a clean widget', () => {
  const r = parseGeneratedWidget(good);
  assert.equal(r.widget?.name, 'T');
  assert.equal(r.widget?.grants[0], 'inference');
});

test('strips markdown fences', () => {
  const r = parseGeneratedWidget('```json\n' + good + '\n```');
  assert.ok(r.widget);
});

test('rejects eval / new Function / fetch / cookie access', () => {
  for (const bad of ['eval("x")', 'new Function("x")', 'document.cookie', 'fetch("https://evil.com")', 'new XMLHttpRequest()']) {
    const w = JSON.parse(good); w.code = `const x = document.createElement("div"); ${bad}; document.body.appendChild(x);`;
    const r = parseGeneratedWidget(JSON.stringify(w));
    assert.ok(!r.widget, `should reject: ${bad}`);
    assert.match(r.error ?? '', /banned/);
  }
});

test('rejects non-standard selector pseudos', () => {
  const w = JSON.parse(good);
  w.code = 'document.querySelector("button:has-text(\\"Reply\\")"); const x = 1;';
  const r = parseGeneratedWidget(JSON.stringify(w));
  assert.ok(!r.widget);
  assert.match(r.error ?? '', /non-standard/);
});

test('rejects syntax-broken code', () => {
  const w = JSON.parse(good); w.code = 'const x = document.createElement("div"); x.appendChild((; broken syntax here';
  const r = parseGeneratedWidget(JSON.stringify(w));
  assert.ok(!r.widget);
  assert.match(r.error ?? '', /syntax/);
});

test('filters unknown grants and defaults matchPatterns', () => {
  const w = JSON.parse(good); w.grants = ['inference', 'admin', 'debugger']; delete w.matchPatterns;
  const r = parseGeneratedWidget(JSON.stringify(w));
  assert.deepEqual(r.widget?.grants, ['inference']);
  assert.deepEqual(r.widget?.matchPatterns, ['*://*/*']);
});
