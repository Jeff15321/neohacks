/**
 * Phase B: deterministic widget for spec-conditioned generation on the HardMail fixture (record.spec.ts).
 * Drafts replies for EVERY remaining unread email (spec goal "each unread email"), never sends.
 */
export const MOCK_WIDGET_CODE_SPEC_G2 = `
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(120); }
  return null;
};
const clickEl = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const byLabel = (re) => [...document.querySelectorAll('[aria-label]')].find(e => re.test(e.getAttribute('aria-label') || ''));
const toInbox = async () => {
  if (document.querySelector('table[role="grid"]')) return true;
  const back = byLabel(/back to inbox/i);
  if (back) clickEl(back);
  return !!(await waitFor(() => document.querySelector('table[role="grid"]'), 6000));
};

const toolbar = await waitFor(() => document.querySelector('[role="toolbar"]'));
const host = document.createElement('div');
host.id = 'wwa-spec-drafter';
toolbar.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>
  button { font:13px arial; padding:6px 12px; border:1px solid #dadce0; border-radius:4px; background:#fff; cursor:pointer; }
  #st { font:12px arial; color:#5f6368; margin-left:8px; }
</style><button id="go">Draft replies to unread</button><span id="st"></span>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    if (!(await toInbox())) { say('Inbox not found.'); WidgetAI.status('failed', 'inbox not found'); return; }
    const keys = [...document.querySelectorAll('tr.zA.zE')].map(r => r.dataset.legacyMessageId).filter(Boolean);
    if (!keys.length) { say('No unread emails.'); WidgetAI.status('completed', 'no unread'); return; }
    let done = 0;
    for (const [i, key] of keys.entries()) {
      await toInbox();
      const row = document.querySelector('tr.zA[data-legacy-message-id="' + key + '"]');
      if (!row) { WidgetAI.log('row gone: ' + key, 'warn'); continue; }
      say('Opening email ' + (i + 1) + '/' + keys.length);
      clickEl(row);
      await waitFor(() => document.querySelector('.a3s'), 8000);
      const body = document.querySelector('.a3s')?.textContent?.trim() ?? '';
      const subject = document.querySelector('.hP')?.textContent?.trim() ?? '';
      const sender = document.querySelector('.gD')?.textContent?.trim() ?? '';
      const reply = await WidgetAI.inference({ prompt: 'Write a concise, friendly reply to this email.', context: { sender, subject, body } });
      const replyBtn = await waitFor(() => byLabel(/^reply$/i));
      clickEl(replyBtn);
      const ed = await waitFor(() => document.querySelector('[contenteditable="true"][aria-label="Message Body"]'));
      ed.focus();
      ed.innerText = reply;
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: reply }));
      const saved = await waitFor(() => [...document.querySelectorAll('.vh')].some(e => !e.hidden && /draft saved/i.test(e.textContent)), 6000);
      say(saved ? 'Draft ' + (i + 1) + ' saved.' : 'Draft ' + (i + 1) + ' not confirmed.');
      if (saved) done++;
    }
    await toInbox();
    say('Done: ' + done + '/' + keys.length + ' drafts saved (nothing sent).');
    WidgetAI.status(done === keys.length ? 'completed' : 'failed', done + '/' + keys.length + ' drafts');
  } catch (e) {
    say('Error: ' + (e && e.message));
    WidgetAI.status('failed', String(e && e.message));
  } finally { btn.disabled = false; }
});
`;
