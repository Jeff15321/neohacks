import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchPatternToRegExp, matchesAny, redactBody, redactHeaders, looksSecret, REDACTED,
  checkGeneratedCode, Ring, randomId,
} from '../index.js';

// --- match patterns (ported) ---
test('*://host/* matches http+https, any port, any path', () => {
  const re = matchPatternToRegExp('*://127.0.0.1/*')!;
  assert.ok(re.test('http://127.0.0.1:8787/fixture/index.html'));
  assert.ok(re.test('https://127.0.0.1/'));
  assert.ok(!re.test('http://example.com/'));
});
test('*. wildcard host + matchesAny', () => {
  const re = matchPatternToRegExp('*://*.example.com/*')!;
  assert.ok(re.test('https://a.b.example.com/x'));
  assert.ok(re.test('https://example.com/x'));
  assert.ok(!re.test('https://example.org/'));
  assert.ok(matchesAny(['*://a.com/*', '*://b.com/*'], 'https://b.com/p'));
  assert.ok(!matchesAny(['*://a.com/*'], 'https://b.com/'));
});

// --- redaction (doc §4 1c) ---
test('redactHeaders: auth/cookie/x-*-token/csrf/xsrf + bearer-like values', () => {
  const h = redactHeaders({
    Authorization: 'Bearer abc', Cookie: 's=1', 'X-Goog-Token': 'v', 'x-csrf-token': 'v', 'X-XSRF': 'v',
    'content-type': 'application/json', 'x-trace': 'Bearer eyJabcdefgh12345678',
  })!;
  for (const k of ['Authorization', 'Cookie', 'X-Goog-Token', 'x-csrf-token', 'X-XSRF', 'x-trace']) assert.equal(h[k], REDACTED, k);
  assert.equal(h['content-type'], 'application/json');
});

test('redactBody: JSON deep fields, urlencoded, and free-text tokens', () => {
  const j = JSON.parse(redactBody('{"user":{"password":"x","otp":123,"name":"Ann"},"items":[{"apiKey":"k"}],"sessionId":"aZ9xQ2mP7rT4vB8nK1sD6fG3hJ5lW0eY"}')!);
  assert.equal(j.user.password, REDACTED);
  assert.equal(j.user.otp, REDACTED);
  assert.equal(j.user.name, 'Ann');
  assert.equal(j.items[0].apiKey, REDACTED);
  assert.equal(j.sessionId, REDACTED); // high-entropy value
  assert.equal(redactBody('a=1&csrf_token=zzz&q=hello'), `a=1&csrf_token=${REDACTED}&q=hello`);
  assert.match(redactBody('auth: Bearer abcdefgh12345678 ok')!, /Bearer \[REDACTED\] ok/);
  assert.equal(redactBody('hello world, plain text'), 'hello world, plain text');
});

test('looksSecret: ordinary strings are not secrets', () => {
  assert.ok(!looksSecret('Q4 launch checklist'));
  assert.ok(!looksSecret('priya@example.com'));
  assert.ok(!looksSecret('/fixture-api/drafts'));
  assert.ok(looksSecret('sk-ant-api03-Zx8Kq2Lm9Np4Rt7Vw1Yb5Cd'));
});

// --- generated-code validator (ported from backend parse.ts) ---
const ok = 'const b = document.createElement("button"); document.body.appendChild(b);';
test('checkGeneratedCode accepts clean code', () => assert.deepEqual(checkGeneratedCode(ok), { ok: true }));
test('checkGeneratedCode rejects banned constructs', () => {
  for (const bad of ['eval("x")', 'new Function("x")', 'document.cookie', 'fetch("/api/x")', 'new XMLHttpRequest()', 'navigator.sendBeacon("/x")', 'new WebSocket("wss://x")', 'chrome.storage.local.get()']) {
    const r = checkGeneratedCode(`${ok} ${bad};`);
    assert.ok(!r.ok && /banned/.test(r.error), bad);
  }
});
test('checkGeneratedCode rejects non-standard pseudos + broken syntax', () => {
  const p = checkGeneratedCode('document.querySelector("button:has-text(\\"Reply\\")"); const x = 1;');
  assert.ok(!p.ok && /non-standard/.test(p.error));
  const s = checkGeneratedCode(`${ok} x.appendChild((; broken`);
  assert.ok(!s.ok && /syntax/.test(s.error));
});

test('Ring keeps the newest N; randomId has prefix', () => {
  const r = new Ring<number>(3);
  for (let i = 0; i < 5; i++) r.push(i);
  assert.deepEqual(r.list(), [2, 3, 4]);
  assert.match(randomId('w'), /^w_[a-z0-9]{10}$/);
});
