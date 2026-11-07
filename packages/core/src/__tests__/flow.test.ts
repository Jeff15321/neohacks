import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_LIMITS } from '@app/contracts';
import {
  createFlowRun, transitionFlow, flowWaitReply, isFlowTerminal, clampFlowTimeout, sinkOk,
  checkBundle, bundleSites, patternHost, lineageEdges,
} from '../index.js';

/** Phase F: FlowRun state machine (doc §5 coordinator 1–8). */
const T0 = 1_000_000;
const mk = (over: Partial<Parameters<typeof createFlowRun>[0]> = {}) =>
  createFlowRun({ runId: 'fr1', widgetId: 'w1', role: 'jira-sink', handler: 'createTicket', input: { title: 'x' }, homeTabId: 1, ...over }, T0);

test('create → tab → injected → checkpoint → navigated (reinject) → injected → result ok → succeeded', () => {
  let r = mk();
  assert.equal(r.status, 'pending');
  assert.equal(r.stage, 'opening');
  assert.equal(r.deadline, T0 + FLOW_LIMITS.DEFAULT_TIMEOUT_MS);
  let t = transitionFlow(r, { type: 'tab', tabId: 7 }, T0 + 1);
  assert.deepEqual(t.effects, ['inject']);
  r = t.run; assert.equal(r.status, 'running'); assert.equal(r.targetTabId, 7); assert.equal(r.stage, 'loading');
  r = transitionFlow(r, { type: 'injected' }, T0 + 2).run;
  assert.equal(r.stage, 'injected'); assert.equal(r.injections, 1);
  r = transitionFlow(r, { type: 'checkpoint', state: { submitted: true } }, T0 + 3).run;
  assert.deepEqual(r.checkpoint, { submitted: true });
  // a "complete" on some other tab is ignored
  assert.equal(transitionFlow(r, { type: 'navigated', tabId: 99 }, T0 + 4).changed, false);
  t = transitionFlow(r, { type: 'navigated', tabId: 7 }, T0 + 4);
  assert.deepEqual(t.effects, ['reinject']);
  r = t.run; assert.equal(r.stage, 'loading');
  // navigation while loading (not yet injected) does not double-inject
  assert.equal(transitionFlow(r, { type: 'navigated', tabId: 7 }, T0 + 5).changed, false);
  r = transitionFlow(r, { type: 'injected' }, T0 + 6).run;
  assert.equal(r.injections, 2);
  assert.deepEqual(r.checkpoint, { submitted: true }, 'checkpoint survives re-injection (resumeState)');
  t = transitionFlow(r, { type: 'result', ok: true, result: { ok: true, evidence: { url: 'http://t/1', id: 'TRK-1' } } }, T0 + 7);
  assert.equal(t.run.status, 'succeeded');
  assert.equal(t.run.stage, 'done');
  assert.deepEqual(t.effects, ['cleanup', 'returnFocus']);
  assert.deepEqual(flowWaitReply(t.run), { done: true, success: true, result: { ok: true, evidence: { url: 'http://t/1', id: 'TRK-1' } }, status: 'succeeded' });
  assert.deepEqual(t.run.events!.map(e => e.event), ['created', 'tab', 'injected', 'checkpoint', 'navigated', 'reinjected', 'succeeded']);
});

test('target tab closed / timeout / cancel / handler error → terminal with a reason; terminal runs ignore later events', () => {
  const running = transitionFlow(transitionFlow(mk(), { type: 'tab', tabId: 7 }, T0).run, { type: 'injected' }, T0).run;
  const closed = transitionFlow(running, { type: 'tabClosed', tabId: 7 }, T0 + 10).run;
  assert.equal(closed.status, 'failed');
  assert.match(closed.error!, /target tab was closed/);
  assert.equal(flowWaitReply(closed).success, false);
  assert.match(flowWaitReply(closed).reason!, /target tab/);
  // unrelated tab closing is a no-op; home tab closing cancels
  assert.equal(transitionFlow(running, { type: 'tabClosed', tabId: 42 }, T0).changed, false);
  assert.equal(transitionFlow(running, { type: 'tabClosed', tabId: 1 }, T0).run.status, 'cancelled');
  const to = transitionFlow(running, { type: 'timeout' }, T0 + FLOW_LIMITS.DEFAULT_TIMEOUT_MS).run;
  assert.equal(to.status, 'failed'); assert.match(to.error!, /timed out after 120 s/);
  const c = transitionFlow(running, { type: 'cancel', reason: 'by user' }, T0).run;
  assert.equal(c.status, 'cancelled'); assert.equal(c.error, 'cancelled: by user');
  const err = transitionFlow(running, { type: 'result', ok: false, error: 'boom' }, T0).run;
  assert.equal(err.status, 'failed'); assert.match(err.error!, /sink handler failed: boom/);
  // a late result / checkpoint after cancel: no change, checkpoint rejected (the sink's next platform call rejects)
  assert.equal(transitionFlow(c, { type: 'result', ok: true, result: { ok: true } }, T0).changed, false);
  const late = transitionFlow(c, { type: 'checkpoint', state: {} }, T0);
  assert.equal(late.changed, false);
  assert.equal(late.rejected, 'run cancelled');
  // pending (no tab yet) can also fail
  assert.equal(transitionFlow(mk(), { type: 'error', error: 'no tab' }, T0).run.status, 'failed');
});

test('sink must return {ok:true} (read-back) — otherwise the run fails but keeps the result for the trace', () => {
  const running = transitionFlow(mk(), { type: 'tab', tabId: 7 }, T0).run;
  for (const bad of [undefined, null, 'ok', { ok: false, evidence: { text: 'mismatch' } }, { ok: 'true' }]) {
    const r = transitionFlow(running, { type: 'result', ok: true, result: bad }, T0).run;
    assert.equal(r.status, 'failed', JSON.stringify(bad));
    assert.match(r.error!, /not verified/);
  }
  assert.equal(sinkOk({ ok: true }), true);
});

test('activate:false → no returnFocus effect; re-injection cap; timeout clamp; isFlowTerminal', () => {
  const bg = transitionFlow(transitionFlow(mk({ activate: false }), { type: 'tab', tabId: 3 }, T0).run, { type: 'cancel' }, T0);
  assert.deepEqual(bg.effects, ['cleanup']);
  let r = transitionFlow(mk(), { type: 'tab', tabId: 3 }, T0).run;
  for (let i = 0; i < FLOW_LIMITS.MAX_INJECTIONS; i++) {
    r = transitionFlow(r, { type: 'injected' }, T0).run;
    r = transitionFlow(r, { type: 'navigated', tabId: 3 }, T0).run;
  }
  r = transitionFlow(r, { type: 'injected' }, T0).run;
  assert.equal(r.status, 'failed'); assert.match(r.error!, /too many re-injections/);
  assert.equal(clampFlowTimeout(1), 5_000);
  assert.equal(clampFlowTimeout(10 ** 9), FLOW_LIMITS.MAX_TIMEOUT_MS);
  assert.equal(isFlowTerminal('running'), false);
  assert.equal(flowWaitReply(mk()).done, false);
});

// ---------------- bundle validation (doc §5: every part validated like the home part) ----------------
const SINK = `WidgetAI.flow.handle('createTicket', async (input, ctx) => { document.querySelector('#summary').value = input.title; return { ok: true, evidence: { url: location.href } }; });`;
const HOME = `const r = await WidgetAI.flow.call('jira-sink', 'createTicket', { title: document.title }); WidgetAI.log(r.evidence.url);`;
const part = (o: object = {}) => ({ role: 'jira-sink', matchPatterns: ['*://*.atlassian.net/*'], code: SINK, entryUrl: 'https://acme.atlassian.net/jira/create', handlers: ['createTicket'], ...o });
const bundle = (o: object = {}, p: object[] = [part()]) => checkBundle({ code: HOME, matchPatterns: ['*://github.com/*'], grants: ['flow'], parts: p, ...o });

test('bundle: valid parts pass (deduped patterns/handlers); sites = home + every part origin', () => {
  const r = bundle({}, [part({ matchPatterns: ['*://*.atlassian.net/*', '*://*.atlassian.net/*'] })]);
  assert.equal(r.error, undefined);
  assert.equal(r.ok, true);
  assert.deepEqual(r.parts[0]!.matchPatterns, ['*://*.atlassian.net/*']);
  assert.deepEqual(r.parts[0]!.handlers, ['createTicket']);
  assert.deepEqual(bundleSites({ matchPatterns: ['*://github.com/*'], parts: r.parts }), ['github.com', '*.atlassian.net']);
  assert.equal(patternHost('*://localhost/*'), 'localhost');
  // handlers default to what the code registers; entryUrl "" = none
  const d = bundle({}, [part({ handlers: undefined, entryUrl: '' })]);
  assert.deepEqual(d.parts[0]!.handlers, ['createTicket']);
  assert.equal(d.parts[0]!.entryUrl, undefined);
  // no parts + no flow use = fine (single-site widget)
  assert.equal(checkBundle({ code: 'WidgetAI.log("hello world!!")', matchPatterns: ['*://a.com/*'], grants: [] }).ok, true);
});

test('bundle: rejects missing grant, banned code in a part, all-sites patterns, bad roles/handlers/entryUrl, flow misuse', () => {
  const cases: Array<[string, ReturnType<typeof checkBundle>]> = [
    ['grant "flow" is not declared', bundle({ grants: [] })],
    ['banned construct', bundle({}, [part({ code: SINK + ' fetch("/x");' })])],
    ['banned construct', bundle({}, [part({ code: SINK + ' document.cookie;' })])],
    ['non-standard CSS', bundle({}, [part({ code: SINK + ' document.querySelector("button:has-text(Create)");' })])],
    ['syntax check failed', bundle({}, [part({ code: SINK + ' }}}' })])],
    ['not a concrete site', bundle({}, [part({ matchPatterns: ['*://*/*'] })])],
    ['bad matchPattern', bundle({}, [part({ matchPatterns: ['atlassian.net'] })])],
    ['matchPatterns required', bundle({}, [part({ matchPatterns: [] })])],
    ['bad role', bundle({}, [part({ role: 'Jira Sink' })])],
    ['bad role', bundle({}, [part({ role: 'home' })])],
    ['duplicate role', bundle({}, [part(), part()])],
    ['declared but not registered', bundle({}, [part({ handlers: ['createTicket', 'deleteTicket'] })])],
    ['registers no WidgetAI.flow.handle', bundle({}, [part({ code: 'WidgetAI.log("no handler here at all")' })])],
    ['does not match the part', bundle({}, [part({ entryUrl: 'https://evil.example.com/' })])],
    ['entryUrl must be an http', bundle({}, [part({ entryUrl: 'javascript:alert(1)' })])],
    ['no part has that role', bundle({ code: HOME.replace("'jira-sink'", "'slack-sink'") })],
    ['does not declare', bundle({ code: HOME.replace("'createTicket'", "'closeTicket'") })],
    ['parts cannot start flows', bundle({}, [part({ code: SINK + ` await WidgetAI.flow.call('jira-sink', 'createTicket', {});` })])],
    ['home part cannot register', bundle({ code: HOME + ' ' + SINK })],
    ['no parts', checkBundle({ code: HOME, matchPatterns: ['*://github.com/*'], grants: ['flow'] })],
    ['too many parts', bundle({}, [1, 2, 3, 4, 5].map(i => part({ role: `p${i}` })))],
    ['must be an array', bundle({ parts: { role: 'x' } })],
  ];
  for (const [want, r] of cases) {
    assert.equal(r.ok, false, want);
    assert.ok(r.error?.includes(want), `${want} ← ${r.error}`);
  }
});

// ---------------- cross-tab lineage (doc §3: recording follows GitHub → Jira) ----------------
test('lineage edges link a copy on one tab to a paste/input on another (global seq across tabs)', () => {
  const steps = [
    { seq: 1, tabId: 10, action: { kind: 'copy', valueHash: 'aaaa1111' } },
    { seq: 2, tabId: 20, action: { kind: 'tab-switch' } },
    { seq: 3, tabId: 20, action: { kind: 'paste', valueHash: 'aaaa1111' } },
    { seq: 4, tabId: 10, action: { kind: 'copy', valueHash: 'bbbb2222' } },
    { seq: 5, tabId: 20, action: { kind: 'input-commit', valueHash: 'bbbb2222' } },
    { seq: 6, tabId: 20, action: { kind: 'input-commit', valueHash: 'cccc3333' } }, // typed, not copied
  ];
  const edges = lineageEdges(steps);
  assert.deepEqual(edges.map(e => [e.fromSeq, e.toSeq]), [[1, 3], [4, 5]]);
  const tab = new Map(steps.map(s => [s.seq, s.tabId]));
  assert.ok(edges.every(e => tab.get(e.fromSeq) !== tab.get(e.toSeq)));
});
