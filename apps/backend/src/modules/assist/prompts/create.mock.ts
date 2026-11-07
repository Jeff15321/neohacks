import type { MockFn } from '../../../llm/types.js';

/**
 * Deterministic create/escalate (LLM_PROVIDER=mock). If the DOM shows a renamed reply control ("Respond") it writes a
 * real fix; otherwise it writes a branch that cannot satisfy the postcondition (→ cap → failure narrative).
 */
export const createMock: MockFn = (req) => {
  const u = req.messages[0]?.content ?? '';
  const escalate = req.stage.startsWith('assist.escalate');
  if (/aria-label="Respond"/.test(u)) {
    return JSON.stringify({
      id: 'click-respond',
      when: 'the reply control is labelled "Respond" instead of "Reply"',
      code: `const b = await h.waitFor(() => h.findByText(/^respond$/i), 4000);
if (!b) throw new Error('no Respond control found');
h.click(b);
await h.waitFor(() => h.$('[contenteditable="true"]'), 4000);
return state;`,
      reason: 'mock: the DOM has a Respond control where Reply was expected',
    });
  }
  return JSON.stringify({
    id: escalate ? 'escalated-wait' : 'wait-and-retry',
    when: 'the page has not finished rendering the expected content',
    code: `await h.sleep(200);
const n = h.$$('tr.zA.zE').length;
if (!n) throw new Error('nothing to act on: the list shows no unread rows');
return state;`,
    reason: escalate ? 'mock escalate: no actionable element in the DOM skeleton' : 'mock: retry after the page settles',
  });
};
