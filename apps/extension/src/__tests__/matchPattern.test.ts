import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPatternToRegExp, matchesAny } from '../background/matchPattern.js';

test('*://host/* matches http+https, any port, any path', () => {
  const re = matchPatternToRegExp('*://127.0.0.1/*')!;
  assert.ok(re.test('http://127.0.0.1:8787/fixture/index.html'));
  assert.ok(re.test('https://127.0.0.1/'));
  assert.ok(!re.test('http://example.com/'));
});

test('*://mail.google.com/* matches gmail urls', () => {
  const re = matchPatternToRegExp('*://mail.google.com/*')!;
  assert.ok(re.test('https://mail.google.com/mail/u/0/#inbox'));
  assert.ok(!re.test('https://google.com/'));
});

test('*. wildcard host', () => {
  const re = matchPatternToRegExp('*://*.example.com/*')!;
  assert.ok(re.test('https://a.b.example.com/x'));
  assert.ok(re.test('https://example.com/x'));
  assert.ok(!re.test('https://example.org/'));
});

test('matchesAny', () => {
  assert.ok(matchesAny(['*://a.com/*', '*://b.com/*'], 'https://b.com/p'));
  assert.ok(!matchesAny(['*://a.com/*'], 'https://b.com/'));
});
