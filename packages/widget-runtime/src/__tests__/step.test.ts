import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import vm from 'node:vm';
import { buildWidgetSource } from '../index.js';
import { buildBranchSource } from '../sections/helpers.js';

/** Minimal sandbox: no real DOM (expectations use custom checks), fake chrome.runtime bridge. */
function sandbox(reply: (m: any) => any) {
  const sent: any[] = [];
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {}, addEventListener() {}, attachShadow: () => ({ getElementById: () => ({ addEventListener() {} }) }) });
  const ctx: any = {
    chrome: { runtime: { lastError: undefined, sendMessage: (m: any, cb?: (r: any) => void) => { sent.push(m); if (cb) setTimeout(() => cb(reply(m)), 1); } } },
    setTimeout, clearTimeout, console: { error() {}, log() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: null, documentElement: { appendChild() {} }, createElement: el },
    window: { addEventListener() {} },
    location: { href: 'http://127.0.0.1/fixture-g2/index.html' },
    MouseEvent: class {}, InputEvent: class {}, KeyboardEvent: class {},
  };
  return { ctx, sent };
}
const W = (code: string) => ({ id: 'w_s', name: 'S', version: 1, grants: ['log'], code });
const run = async (code: string, reply: (m: any) => any) => {
  const { ctx, sent } = sandbox(reply);
  vm.runInNewContext(buildWidgetSource(W(code), 't_s'), ctx);
  for (let i = 0; i < 100 && !sent.some(m => m.type === 'WIDGET_STATUS'); i++) await new Promise(r => setTimeout(r, 20));
  return sent;
};

test('step source parses (prelude + branch wrapper)', () => {
  acorn.parse(buildWidgetSource(W('await WidgetAI.step("a", { run: async () => {}, expect: () => true });'), 't'), { ecmaVersion: 'latest' });
  acorn.parse(buildBranchSource('return { ...state, x: 1 };', { a: 1 }), { ecmaVersion: 'latest' });
});

test('step passes locally without calling the agent; state flows as JSON', async () => {
  const sent = await run(`
    const r = await WidgetAI.run('goal', async () => {
      const s1 = await WidgetAI.step('one', { goal: 'g', run: async (s) => ({ ...s, n: 1 }), expect: (s) => s.n === 1 });
      const s2 = await WidgetAI.step('two', { goal: 'g', run: async (s) => ({ ...s, n: s.n + 1 }), expect: (s) => s.n === 2 });
      return s2;
    });
    WidgetAI.status(r.ok ? 'completed' : 'failed', JSON.stringify(r.state));`, () => ({ ok: true }));
  assert.equal(sent.filter(m => m.type === 'WIDGET_ASSIST').length, 0);
  const kinds = sent.filter(m => m.type === 'WIDGET_RUN_EVENT').map(m => m.event.kind);
  assert.deepEqual(kinds, ['run-start', 'step-start', 'step-ok', 'step-start', 'step-ok', 'completed']);
  assert.equal(sent.at(-1).status, 'completed');
  assert.equal(sent.at(-1).detail, '{"n":2}');
});

test('expect failure → assist picks a pre-generated branch → step ok', async () => {
  const sent = await run(`
    let fixed = false;
    const r = await WidgetAI.run('goal', async () => WidgetAI.step('open', {
      goal: 'open', timeoutMs: 100,
      run: async () => { throw new Error('popup in the way'); },
      expect: () => fixed || 'popup still open',
      branches: [{ id: 'dismiss-popup', when: 'an interstitial popup blocks the page', run: async (s) => { fixed = true; return { ...s, via: 'popup' }; } }],
    }));
    WidgetAI.status(r.ok ? 'completed' : 'failed', JSON.stringify(r.state));`,
  (m) => m.type === 'WIDGET_ASSIST' ? { ok: true, action: 'branch', source: 'decide', branchId: 'dismiss-popup', reason: 'popup' } : { ok: true });
  const a = sent.find(m => m.type === 'WIDGET_ASSIST');
  assert.equal(a.report.step, 'open');
  assert.deepEqual(JSON.parse(JSON.stringify(a.report.branches)), [{ id: 'dismiss-popup', when: 'an interstitial popup blocks the page' }]);
  assert.match(a.report.error, /popup in the way/);
  const res = sent.find(m => m.type === 'WIDGET_RUN_EVENT' && m.event.kind === 'branch-result');
  assert.equal(res.event.data.ok, true);
  assert.equal(sent.at(-1).status, 'completed');
  assert.equal(sent.at(-1).detail, '{"via":"popup"}');
});

test('new branch result (executed by the SW) hands state back; stop → StepFailed with narrative', async () => {
  let n = 0;
  const sent = await run(`
    const r = await WidgetAI.run('goal', async () => WidgetAI.step('reply', { goal: 'open composer', timeoutMs: 50, run: async () => {}, expect: (s) => s.composer === true || 'no composer' }));
    WidgetAI.status(r.ok ? 'completed' : 'failed', r.ok ? JSON.stringify(r.state) : r.narrative);`,
  (m) => {
    if (m.type === 'WIDGET_ASSIST') return ++n === 1
      ? { ok: true, action: 'new', source: 'create', branchId: 'n1', reason: 'r', result: { ok: true, state: { composer: false } } }
      : { ok: true, action: 'stop', source: 'cap', reason: 'cap: 2 recovery attempts' };
    if (m.type === 'WIDGET_RUN_EVENT' && m.event.kind === 'final-failure') return { ok: true, narrative: 'NARRATIVE' };
    return { ok: true };
  });
  assert.equal(sent.filter(m => m.type === 'WIDGET_ASSIST').length, 2);
  assert.equal(sent.filter(m => m.type === 'WIDGET_ASSIST')[1].report.attempt, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.filter(m => m.type === 'WIDGET_ASSIST')[1].report.tried)), ['n1']);
  assert.equal(sent.at(-1).status, 'failed');
  assert.equal(sent.at(-1).detail, 'NARRATIVE');
});
