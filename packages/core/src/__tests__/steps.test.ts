import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SettleMachine, isSignificantMutation, isTimestampTick, type ClosedStep, type LateEffects,
  buildLocatorBundle, rankCandidates, looksGeneratedId, bestSelector,
  redactTypedValue, isSecretInput, redactStepForExport, REDACTED,
  hashValue, lineageEdges,
} from '../index.js';

// ------------------------------------------------------------------ settle machine (fake clock)
function harness(opts = {}) {
  const closed: ClosedStep<string>[] = [];
  const late: Array<{ id: string; late: LateEffects }> = [];
  const m = new SettleMachine<string>({ onClose: s => closed.push(s), onLate: (id, l) => late.push({ id, late: l }) }, opts);
  return { m, closed, late };
}

test('settle: closes after 400 ms of quiet (settled:true)', () => {
  const { m, closed } = harness();
  m.action('s1', 'click', 1000);
  m.mutation(1100, { added: [{ root: 'div.x', skeleton: 'div.x\n' }] });
  m.tick(1400); // 300 ms after last mutation
  assert.equal(closed.length, 0);
  assert.equal(m.nextDeadline(), 1500);
  m.tick(1500);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].settled, true);
  assert.equal(closed[0].reason, 'quiet');
  assert.equal(closed[0].tEnd, 1500);
  assert.equal(closed[0].effects.addedRegions[0].root, 'div.x');
  assert.equal(closed[0].lastActivityMs, 100);
});

test('settle: in-flight request blocks quiet; closes after it ends + quiet', () => {
  const { m, closed } = harness();
  m.action('s1', 'click', 0);
  m.netStart('r1', 50);
  m.tick(1000);
  assert.equal(closed.length, 0, 'in-flight keeps it open');
  m.netEnd('r1', 1200, { opId: 'r1', method: 'POST', status: 200 });
  m.tick(1599);
  assert.equal(closed.length, 0);
  m.tick(1600);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].settled, true);
  assert.deepEqual(closed[0].effects.net.map(n => n.opId), ['r1']);
  assert.equal(closed[0].effects.mutatingOk, true);
});

test('settle: 3 s cap → settled:false (never-quiescing page)', () => {
  const { m, closed } = harness();
  m.action('s1', 'click', 0);
  for (let t = 100; t < 4000; t += 200) m.mutation(t, {});
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, 'cap');
  assert.equal(closed[0].settled, false);
  assert.equal(closed[0].tEnd, 3000);
});

test('settle: a new action closes the open Step immediately', () => {
  const { m, closed } = harness();
  m.action('s1', 'click A', 0);
  m.mutation(10, {});
  m.action('s2', 'click B', 50);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].id, 's1');
  assert.equal(closed[0].reason, 'interrupted');
  assert.equal(closed[0].settled, true, 'nothing in flight');
  assert.equal(m.openId, 's2');
});

test('settle: background requests (started outside a Step) never block or attach', () => {
  const { m, closed } = harness();
  m.netStart('poll', 0);           // no step open
  m.action('s1', 'click', 10);
  m.netEnd('poll', 100, { opId: 'poll', method: 'GET', status: 200 });
  m.tick(410);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].effects.net.length, 0);
});

test('settle: late effects (≤6 s) merge into the previous Step; later ones are dropped', () => {
  const { m, closed, late } = harness();
  m.action('s1', 'click', 0);
  m.netStart('slow', 10);
  m.tick(3000); // cap
  assert.equal(closed[0].settled, false);
  m.liveText(4000, ['Draft saved']);
  m.netEnd('slow', 5000, { opId: 'slow', method: 'POST', status: 201 });
  m.liveText(9500, ['too late']);
  assert.deepEqual(late.map(l => l.id), ['s1', 's1']);
  assert.deepEqual(late[0].late.liveRegionText, ['Draft saved']);
  assert.equal(late[1].late.net[0].opId, 'slow');
});

test('settle: held input Step stays open while typing, settles after commit', () => {
  const { m, closed } = harness();
  m.action('s1', 'input', 0, { held: true });
  m.liveText(600, ['Draft saved']);
  m.tick(5000);
  assert.equal(closed.length, 0, 'held: no cap while typing');
  assert.equal(m.nextDeadline(), undefined);
  m.commit(6000, 'input: hello');
  m.tick(6400);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].action, 'input: hello');
  assert.deepEqual(closed[0].effects.liveRegionText, ['Draft saved']);
});

test('settle: url change is an effect; flush closes immediately', () => {
  const { m, closed } = harness();
  m.action('s1', 'click', 0);
  m.url(20, 'https://x/#inbox/1');
  m.flush(30);
  assert.equal(closed[0].effects.urlChange, 'https://x/#inbox/1');
  assert.equal(closed[0].reason, 'flush');
});

test('settle: region skeletons capped (~2 KB per Step)', () => {
  const { m, closed } = harness();
  m.action('s1', 'click', 0);
  m.mutation(1, { added: Array.from({ length: 10 }, (_, i) => ({ root: `r${i}`, skeleton: 'x'.repeat(1000) })) });
  m.flush(2);
  const total = closed[0].effects.addedRegions.reduce((n, r) => n + r.skeleton.length, 0);
  assert.ok(total <= 2500, `total ${total}`);
  assert.ok(closed[0].effects.addedRegions.length <= 4);
});

test('significance filter: ignores wwa UI, timestamp ticks, hidden attribute churn', () => {
  assert.equal(isSignificantMutation({ type: 'childList', inOwnUi: true, targetVisible: true, addedElements: 3 }), false);
  assert.equal(isSignificantMutation({ type: 'childList', inOwnUi: false, targetVisible: true, addedElements: 1 }), true);
  assert.equal(isSignificantMutation({ type: 'characterData', inOwnUi: false, targetVisible: true, textBefore: '3 min ago', textAfter: '4 min ago' }), false);
  assert.equal(isSignificantMutation({ type: 'characterData', inOwnUi: false, targetVisible: true, textBefore: '12:01', textAfter: '12:02' }), false);
  assert.equal(isSignificantMutation({ type: 'characterData', inOwnUi: false, targetVisible: true, textBefore: '', textAfter: 'Draft saved' }), true);
  assert.equal(isSignificantMutation({ type: 'attributes', inOwnUi: false, targetVisible: false, attributeName: 'class' }), false);
  assert.equal(isSignificantMutation({ type: 'attributes', inOwnUi: false, targetVisible: true, attributeName: 'hidden' }), true);
  assert.equal(isSignificantMutation({ type: 'attributes', inOwnUi: false, targetVisible: true, attributeName: 'data-tick' }), false);
  assert.ok(isTimestampTick('Nov 6', 'Nov 7'));
  assert.ok(!isTimestampTick('Inbox', 'Drafts'));
});

// ------------------------------------------------------------------ locators
test('locators: candidates with match counts, unique first, generated ids skipped', () => {
  const counts: Record<string, number> = {
    '#send': 1, '[aria-label="Reply"]': 1, '[role="link"][aria-label="Reply"]': 1,
    'tr[data-legacy-message-id="m1"]': 1, 'div.adn > span.ams': 1, 'span >> text="Reply"': 3,
  };
  const b = buildLocatorBundle({
    tag: 'SPAN', id: 'send', role: 'link', ariaLabel: 'Reply', accessibleName: 'Reply', text: 'Reply', cssPath: 'div.adn > span.ams',
  }, (sel) => counts[sel] ?? 2);
  assert.equal(b.tag, 'span');
  assert.equal(b.candidates[0].kind, 'id');
  assert.ok(b.candidates.every(c => typeof c.matches === 'number'));
  assert.deepEqual(new Set(b.candidates.map(c => c.kind)), new Set(['id', 'aria-label', 'role-name', 'css', 'text']));
  const gen = buildLocatorBundle({ tag: 'div', id: 'ember12345', dataAttrs: { 'data-legacy-message-id': 'm1' } }, s => counts[s] ?? 5);
  assert.ok(!gen.candidates.some(c => c.kind === 'id'));
  assert.equal(gen.candidates[0].selector, 'div[data-legacy-message-id="m1"]');
  assert.equal(gen.candidates[0].matches, 5);
  assert.ok(looksGeneratedId(':r5:'));
  assert.ok(!looksGeneratedId('inbox'));
  const ranked = rankCandidates([{ kind: 'id', selector: '#a', matches: 2 }, { kind: 'css', selector: 'a.b', matches: 1 }, { kind: 'text', selector: 't', matches: 0 }]);
  assert.deepEqual(ranked.map(r => r.selector), ['a.b', '#a', 't']);
  assert.equal(bestSelector(b), '#send');
});

test('locators: invalid selectors are dropped (count throws)', () => {
  const b = buildLocatorBundle({ tag: 'div', ariaLabel: 'x' }, () => { throw new Error('bad'); });
  assert.equal(b.candidates.length, 0);
});

// ------------------------------------------------------------------ redaction of typed values
test('redaction: password / secret fields never leave; tokens and card numbers masked', () => {
  assert.equal(redactTypedValue('hunter2', { type: 'password' }), REDACTED);
  assert.equal(redactTypedValue('123456', { autocomplete: 'one-time-code' }), REDACTED);
  assert.equal(redactTypedValue('abc', { name: 'api_key' }), REDACTED);
  assert.ok(isSecretInput({ ariaLabel: 'Password' }));
  assert.equal(redactTypedValue('sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0L'), REDACTED);
  assert.equal(redactTypedValue('pay with 4111 1111 1111 1111 thanks').includes('4111'), false);
  assert.equal(redactTypedValue('Thanks Priya, I will review it by Friday.'), 'Thanks Priya, I will review it by Friday.');
  assert.ok(redactTypedValue('x'.repeat(500)).length <= 201);
  const s = redactStepForExport({ action: { valuePreview: 'my token is ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' } });
  assert.ok(!s.action.valuePreview!.includes('ghp_A1b2'));
});

// ------------------------------------------------------------------ lineage
test('lineage: copied value reappearing in a paste yields an edge', () => {
  const h = hashValue('  Q4 Launch Checklist ');
  assert.equal(h, hashValue('q4 launch checklist'));
  assert.equal(hashValue('ab'), '');
  const edges = lineageEdges([
    { seq: 1, action: { kind: 'copy', valueHash: h } },
    { seq: 2, action: { kind: 'click' } },
    { seq: 3, action: { kind: 'paste', valueHash: h } },
  ]);
  assert.deepEqual(edges, [{ fromSeq: 1, toSeq: 3, valueHash: h }]);
});
