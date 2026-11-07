import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDangerText, classifyNetRequest } from '../danger.js';
import { beginAttempt, buildRunNarrative, newRunAssistState, planAssist, resolveDecision, reviewBranchCode, stateShapePreview } from '../assist.js';

test('danger classifier: consequential control labels', () => {
  for (const l of ['Send', 'Delete', 'Remove item', 'Publish', 'Buy now', 'Pay $20', 'Place order', 'Move to trash', 'Submit', 'Unsubscribe'])
    assert.equal(classifyDangerText(l).dangerous, true, l);
  for (const l of ['Reply', 'Respond', 'Back to Inbox', 'Save draft', 'Not now', 'Draft Replies (2 unread)', 'Open', 'Expand reply', '', undefined])
    assert.equal(classifyDangerText(l as string).dangerous, false, String(l));
  // long text blocks (whole rows) are not labels
  assert.equal(classifyDangerText('Priya Nair Q4 launch checklist — Hi, can you send me the review by Friday please, thanks!').dangerous, false);
  // any label in the list may trigger (aria-label vs text)
  assert.equal(classifyDangerText('🗑', 'Delete conversation').dangerous, true);
  assert.equal(classifyDangerText('Send').matched, 'Send');
});

test('danger classifier: network calls', () => {
  assert.equal(classifyNetRequest('DELETE', '/api/messages/1').dangerous, true);
  assert.equal(classifyNetRequest('POST', '/fixture-api/send').dangerous, true);
  assert.equal(classifyNetRequest('POST', 'https://x.example/api/v1/payments').dangerous, true);
  assert.equal(classifyNetRequest('POST', '/fixture-api/drafts').dangerous, false);
  assert.equal(classifyNetRequest('GET', '/fixture-api/send').dangerous, false);
  assert.equal(classifyNetRequest(undefined, '/api/delete').dangerous, false);
  assert.equal(classifyNetRequest('PUT', '/api/sender-profile').dangerous, false);
});

test('assist ladder: decide → new → escalate → cap; run cap', () => {
  const run = newRunAssistState(0);
  assert.deepEqual(planAssist(run, 'a', 1), { kind: 'decide' });
  const s = beginAttempt(run, 'a'); s.newCount = 1;
  assert.deepEqual(planAssist(run, 'a', 1), { kind: 'escalate' });
  beginAttempt(run, 'a');
  assert.equal(planAssist(run, 'a', 1).kind, 'stop');
  assert.match((planAssist(run, 'a', 1) as { reason: string }).reason, /2 recovery attempts/);
  for (const st of ['b', 'c', 'd']) { assert.equal(planAssist(run, st, 1).kind, 'decide'); beginAttempt(run, st); }
  assert.equal(run.interventions, 5);
  assert.match((planAssist(run, 'e', 1) as { reason: string }).reason, /5 agent interventions/);
  assert.match((planAssist(newRunAssistState(0), 'x', 10_000_000) as { reason: string }).reason, /exceeded/);
});

test('resolveDecision maps choices', () => {
  const r = { branches: [{ id: 'popup', when: 'popup' }, { id: 'collapsed', when: 'c' }], tried: ['collapsed'] };
  assert.deepEqual(resolveDecision({ choice: 'popup', reason: '' }, r), { kind: 'branch', branchId: 'popup' });
  assert.deepEqual(resolveDecision({ choice: 'collapsed', reason: '' }, r), { kind: 'new' }); // already tried
  assert.deepEqual(resolveDecision({ choice: 'nonsense', reason: '' }, r), { kind: 'new' });
  assert.deepEqual(resolveDecision({ choice: 'NEW', reason: '' }, r), { kind: 'new' });
  assert.equal(resolveDecision({ choice: 'stop', reason: 'empty inbox' }, r).kind, 'stop');
  assert.deepEqual(resolveDecision({ choice: 'primary', reason: '' }, { ...r, multiOutcome: true }), { kind: 'branch', branchId: 'primary' });
});

test('reviewBranchCode rejects unsafe agent branches', () => {
  const ok = `const b = await h.waitFor(() => h.findByText(/respond/i)); h.click(b); return state;`;
  assert.deepEqual(reviewBranchCode(ok), { safe: true, issues: [] });
  assert.equal(reviewBranchCode(`h.click(h.findByText(/send/i)); return state;`).safe, false);
  assert.equal(reviewBranchCode(`h.click(document.querySelector('[aria-label="Delete"]')); return state;`).safe, false);
  assert.equal(reviewBranchCode(`document.querySelector('form').submit(); return state;`).safe, false);
  assert.equal(reviewBranchCode(`await fetch('/x'); return state;`).safe, false);
  assert.equal(reviewBranchCode(`await WidgetAI.inference({prompt:'x'}); return state;`).safe, false);
  assert.equal(reviewBranchCode(`return state; }{ broken`).safe, false);
});

test('narrative lists steps, decisions, evidence and why', () => {
  const ev = (ts: number, kind: string, step?: string, detail?: string, data?: unknown) => ({ ts, kind, step, detail, data }) as never;
  const txt = buildRunNarrative({
    widgetName: 'Drafter', startedAt: 0, status: 'failed', events: [
      ev(0, 'run-start', undefined, 'draft replies'),
      ev(100, 'step-start', 'find-unread'),
      ev(5000, 'expect-fail', 'find-unread', undefined, { expected: 'at least 1 unread row', observed: '0 rows', dom: '<div>Your inbox is empty</div>' }),
      ev(6000, 'assist-decide', 'find-unread', undefined, { choice: 'new', reason: 'no branch fits', model: 'haiku' }),
      ev(7000, 'branch-result', 'find-unread', undefined, { branchId: 'n1', ok: false, observed: '0 rows' }),
      ev(8000, 'final-failure', 'find-unread', 'cap reached'),
    ],
  }, 'the inbox is empty');
  assert.match(txt, /Step "find-unread" started/);
  assert.match(txt, /expected at least 1 unread row but observed 0 rows/);
  assert.match(txt, /chose "new": no branch fits/);
  assert.match(txt, /Why it broke: step "find-unread" never reached its postcondition \(at least 1 unread row\); last observed: 0 rows\. Agent's last diagnosis: no branch fits\. Stopped because: the inbox is empty/);
  assert.match(txt, /Your inbox is empty/);
});

test('stateShapePreview: real ids, truncated strings/arrays, bounded size', () => {
  const state = { cur: 1, items: [{ id: 'm1', subject: 'Q4 launch checklist', body: 'x'.repeat(500) }, { id: 'm2', subject: 'Dinner' }], extra: Array.from({ length: 9 }, (_, i) => i) };
  const out = stateShapePreview(state);
  assert.match(out, /"cur":1/);
  assert.match(out, /"id":"m1"/);
  assert.match(out, /…\(500 chars\)/);
  assert.match(out, /…\+4 more/);
  assert.ok(stateShapePreview({ big: Array.from({ length: 5 }, () => ({ a: 'y'.repeat(60), b: 'z'.repeat(60), c: { d: { e: { f: 1 } } } })) }, 200).length <= 201);
  const cyc: Record<string, unknown> = {}; cyc.self = cyc;
  assert.equal(typeof stateShapePreview(cyc), 'string');
});
