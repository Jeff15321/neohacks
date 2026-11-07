/**
 * Phase C mock widgets (LLM_PROVIDER=mock): a step-based HardMail drafter with `expect` postconditions and
 * pre-generated branches (chaos mode), and a "clean up" widget whose script Delete click the danger guard must block.
 */
export const MOCK_WIDGET_CODE_G2_STEPS = `
const h = WidgetAI.helpers;
const toolbar = await h.waitFor(() => document.querySelector('[role="toolbar"]'), 8000);
const host = document.createElement('div');
host.id = 'wwa-g2-steps';
toolbar.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>button{font:13px arial;padding:6px 12px;border:1px solid #dadce0;border-radius:4px;background:#fff;cursor:pointer}#st{font:12px arial;color:#5f6368;margin-left:8px}</style><button id="go">Draft Replies (2 unread)</button><span id="st"></span>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };

const dismissPopup = {
  id: 'dismiss-popup',
  when: 'an interstitial popup / dialog covers the page and swallows clicks',
  run: async (s, h) => {
    const b = h.findByText(/^(not now|no thanks|close|dismiss|got it)$/i, h.$('[role="dialog"]') || document);
    if (!b) throw new Error('no dismiss control in the dialog');
    h.click(b);
    await h.waitFor(() => !h.$('[role="dialog"]'), 3000);
    return s;
  },
};

btn.addEventListener('click', async () => {
  btn.disabled = true;
  const res = await WidgetAI.run('Draft AI replies to the 2 newest unread emails (never send)', async (state) => {
    state = await WidgetAI.step('find-unread', {
      goal: 'collect the ids of the 2 newest unread emails in the inbox list',
      timeoutMs: 1000,
      run: async (s, h) => {
        await h.waitFor(() => h.$$('tr.zA.zE').length, 5000);
        return { ...s, targets: h.$$('tr.zA.zE').slice(0, 2).map(r => r.dataset.legacyMessageId), done: [] };
      },
      expect: { check: (s) => (s.targets && s.targets.length > 0) || 'no unread rows (tr.zA.zE) in the list', description: 'at least one unread email id collected' },
    });
    for (const [i, id] of state.targets.entries()) {
      say('Opening email ' + (i + 1) + '/' + state.targets.length);
      const openRow = async (s, h) => { h.click(await h.waitFor(() => h.$('tr.zA[data-legacy-message-id="' + id + '"]'), 4000)); return s; };
      state = await WidgetAI.step('open-email', {
        goal: 'open the email ' + id + ' from the inbox list', timeoutMs: 4000,
        run: openRow,
        expect: { exists: '.a3s' },
        branches: [{ ...dismissPopup, run: async (s, h) => openRow(await dismissPopup.run(s, h), h) }],
      });
      state = await WidgetAI.step('read-email', {
        goal: 'read sender, subject and body of the open email',
        run: async (s, h) => ({ ...s, email: { sender: h.text('.gD'), subject: h.text('.hP'), body: h.text('.a3s') } }),
        expect: (s) => !!(s.email && s.email.body) || 'email body is empty',
      });
      say('Generating reply ' + (i + 1) + '…');
      const reply = await WidgetAI.inference({ prompt: 'Write a concise, friendly reply to this email.', context: state.email });
      state = await WidgetAI.step('open-reply', {
        goal: 'open the reply composer of the open email (never send)', timeoutMs: 3000,
        run: async (s, h) => { h.click(h.findByText(/^reply$/i)); return s; },
        expect: { exists: '[contenteditable="true"]' },
        branches: [
          { id: 'expand-collapsed', when: 'the reply composer is collapsed into a bar (aria-expanded="false") that must be expanded',
            run: async (s, h) => { h.click(h.$('[aria-expanded="false"]')); await h.waitFor(() => h.$('[contenteditable="true"]'), 3000); return s; } },
          dismissPopup,
        ],
      });
      state = await WidgetAI.step('write-draft', {
        goal: 'type the AI reply into the composer so the site autosaves it as a draft', timeoutMs: 4000,
        run: async (s, h) => { h.typeText(h.$('[contenteditable="true"]'), reply); return s; },
        expect: { check: () => [...document.querySelectorAll('.vh')].some(e => !e.hidden && /draft saved/i.test(e.textContent)) || 'no "Draft saved" toast', description: '"Draft saved" toast visible' },
      });
      state = { ...state, done: [...state.done, id] };
      say('Draft ' + (i + 1) + ' saved.');
      state = await WidgetAI.step('back-to-inbox', {
        goal: 'return to the inbox list', timeoutMs: 4000,
        run: async (s, h) => { h.click(h.findByText(/back/i)); return s; },
        expect: { exists: 'table[role="grid"]' },
      });
    }
    return state;
  });
  if (res.ok) { say('Completed: ' + res.state.done.length + ' draft(s) created.'); WidgetAI.status('completed', res.state.done.length + ' drafts'); }
  else { say('Stopped: ' + res.error); WidgetAI.status('failed', res.narrative || res.error); }
  btn.disabled = false;
});
`;

export const MOCK_WIDGET_CODE_G2_DELETE = `
const h = WidgetAI.helpers;
const toolbar = await h.waitFor(() => document.querySelector('[role="toolbar"]'), 8000);
const host = document.createElement('div');
host.id = 'wwa-g2-cleanup';
toolbar.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = '<button id="go">Clean up newsletters</button>';
root.getElementById('go').addEventListener('click', async () => {
  const row = [...document.querySelectorAll('tr.zA')].find(r => /digest/i.test(r.textContent));
  if (!row) { WidgetAI.status('failed', 'no newsletter'); return; }
  h.click(row);
  const del = await h.waitFor(() => h.findByText(/^delete$/i), 4000);
  WidgetAI.log('clicking Delete');
  h.click(del);
  await h.sleep(500);
  WidgetAI.status('completed', 'delete attempted');
});
`;
