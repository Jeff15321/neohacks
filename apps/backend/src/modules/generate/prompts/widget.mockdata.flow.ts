/**
 * Phase F mock bundle (LLM_PROVIDER=mock): GitHub-like issue page (home, 127.0.0.1) → Jira-like tracker (sink, localhost).
 * Deterministic stand-in for what the generator writes for "create a tracker ticket from this issue".
 */

/** Home part: "Create ticket" button in the issue header → WidgetAI.flow.call → link to the created ticket. */
export const MOCK_FLOW_HOME_CODE = String.raw`
const waitFor = (sel, ms = 10000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => { const el = document.querySelector(sel); if (el) return resolve(el); if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for ' + sel)); setTimeout(tick, 100); };
  tick();
});
const old = document.getElementById('wwa-issue-to-ticket'); if (old) old.remove();
const actions = await waitFor('.gh-header-actions');
const root = document.createElement('span');
root.id = 'wwa-issue-to-ticket';
root.style.cssText = 'display:inline-flex;gap:8px;align-items:center';
const btn = document.createElement('button');
btn.type = 'button'; btn.className = 'btn'; btn.textContent = 'Create ticket'; btn.setAttribute('data-testid', 'wwa-create-ticket');
const out = document.createElement('span');
out.setAttribute('data-testid', 'wwa-ticket-result'); out.style.cssText = 'font-size:12px;color:#59636e';
root.append(btn, out);
actions.prepend(root);
btn.addEventListener('click', async () => {
  const title = (document.querySelector('.js-issue-title') || {}).textContent || '';
  const number = ((document.querySelector('.gh-header-number') || {}).textContent || '').trim();
  const body = ((document.querySelector('.js-comment-body') || {}).textContent || '').trim();
  const labels = [...document.querySelectorAll('.IssueLabel')].map(l => l.textContent.trim()).filter(Boolean);
  if (!title.trim()) { out.textContent = 'Could not read the issue title'; return; }
  const input = { title: title.trim(), body: body + '\n\nSource: ' + location.href + ' (' + number + ')', labels };
  // E7 hook: activate:false runs the sink in a background tab (default true: focus target, return focus here)
  const activate = document.documentElement.getAttribute('data-wwa-flow-activate') !== 'false';
  btn.disabled = true; out.removeAttribute('data-error'); out.textContent = 'Creating ticket…';
  WidgetAI.log('creating a tracker ticket for ' + number);
  try {
    const r = await WidgetAI.flow.call('tracker-sink', 'createTicket', input, { activate });
    out.textContent = 'Created ';
    const a = document.createElement('a');
    a.href = r.evidence.url; a.textContent = r.evidence.id; a.target = '_blank'; a.setAttribute('data-testid', 'wwa-ticket-link');
    out.appendChild(a);
    WidgetAI.status('completed', 'ticket ' + r.evidence.id + ' created: ' + r.evidence.url);
  } catch (e) {
    const msg = String((e && e.message) || e);
    out.textContent = 'Ticket not created: ' + msg; out.setAttribute('data-error', msg);
    WidgetAI.log('flow failed: ' + msg, 'error');
  } finally { btn.disabled = false; }
});
WidgetAI.log('Create ticket button added');
`;

/** Sink part (tracker): fill the Create form, checkpoint, click Create; after the navigation read the ticket back. */
export const MOCK_FLOW_SINK_CODE = String.raw`
const waitFor = (sel, ms = 10000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => { const el = document.querySelector(sel); if (el) return resolve(el); if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for ' + sel)); setTimeout(tick, 100); };
  tick();
});
const until = (fn, ms = 10000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => { const v = fn(); if (v) return resolve(v); if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for the ticket to render')); setTimeout(tick, 100); };
  tick();
});
const setValue = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
WidgetAI.flow.handle('createTicket', async (input, ctx) => {
  // read-back: the ticket page shows the key + summary the server stored
  const readBack = async () => {
    await waitFor('[data-testid="ticket-key"]');
    const key = await until(() => document.querySelector('[data-testid="ticket-key"]').textContent.trim());
    const summary = document.querySelector('[data-testid="ticket-summary"]').textContent.trim();
    const ok = summary === input.title;
    return { ok, evidence: { url: location.href, id: key, text: summary }, ...(ok ? {} : { error: 'ticket summary does not match the issue title' }) };
  };
  const st = ctx.resumeState || {};
  if (st.submitted) return readBack();
  if (!document.querySelector('#create-form')) {
    // reused tab is on another tracker page: checkpoint BEFORE navigating, the coordinator re-injects us
    await ctx.checkpoint({ submitted: false, openedForm: true });
    location.href = new URL('index.html', location.href).href;
    return new Promise(() => {});
  }
  setValue(await waitFor('#summary'), input.title);
  setValue(await waitFor('#description'), input.body || '');
  setValue(await waitFor('#labels'), (input.labels || []).join(', '));
  if (await ctx.cancelled()) throw new Error('cancelled before creating the ticket');
  await ctx.checkpoint({ submitted: true });
  document.querySelector('#create-btn').click();
  // the tracker navigates to the ticket page → resumed above with resumeState.submitted (SPA trackers: read here)
  await waitFor('[data-testid="ticket-key"]', 15000);
  return readBack();
});
`;

export function flowMockWidget(user: string) {
  const m = user.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/fixture-issues/i);
  if (!m) return null;
  const port = m[1];
  return {
    name: 'Issue → Tracker Ticket',
    description: 'Adds a "Create ticket" button to issue pages that files the issue in the tracker (another site) and links back to the new ticket.',
    matchPatterns: ['*://127.0.0.1/*', '*://github.com/*'],
    grants: ['flow', 'log'],
    insertionHint: 'Button in the issue header actions (.gh-header-actions).',
    code: MOCK_FLOW_HOME_CODE,
    plan: [
      'Add a "Create ticket" button to the issue header',
      'Read the issue title, description and labels',
      'Open the tracker (another site) and fill its Create issue form with them',
      'Click Create, then read the new ticket back from the tracker',
      'Show a link to the created ticket next to the button',
    ],
    consequentialActions: ['Creates a new ticket in the tracker (localhost)'],
    parts: [{
      role: 'tracker-sink',
      matchPatterns: ['*://localhost/*', '*://*.atlassian.net/*'],
      code: MOCK_FLOW_SINK_CODE,
      entryUrl: `http://localhost:${port}/fixture-tracker/index.html`,
      handlers: ['createTicket'],
    }],
  };
}
