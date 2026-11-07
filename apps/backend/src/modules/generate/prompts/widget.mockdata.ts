/** Canned generated widgets used by the widget-generation mock. Written like real generated code (ported from the MVP). */

// Fixture-Gmail widget: mirrors what the LLM is expected to produce.
// Selectors target apps/fixture-gmail DOM (which mirrors real Gmail affordances).
export const MOCK_WIDGET_CODE = `
const host = document.querySelector('.gj-toolbar') || document.body;
const shadowHost = document.createElement('div');
shadowHost.id = 'wwa-unread-drafter';
host.appendChild(shadowHost);
const root = shadowHost.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>
  button { font: 13px system-ui; padding: 6px 12px; border-radius: 16px; border: 1px solid #dadce0; background: #fff; cursor: pointer; margin: 4px; }
  #st { font: 12px system-ui; color: #5f6368; margin-left: 8px; }
</style><button id="go">Draft replies to 2 unread</button><span id="st"></span>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000, poll = 150) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(poll); }
  return null;
};

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    say('Finding unread messages...');
    const rows = [...document.querySelectorAll('.msg-row.unread')].slice(0, 2);
    if (rows.length === 0) { say('No unread messages.'); return; }
    let done = 0;
    for (const [i, row] of rows.entries()) {
      say('Opening message ' + (i + 1) + ' of ' + rows.length + '...');
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const body = await waitFor(() => document.querySelector('.msg-view .msg-body'));
      if (!body) { WidgetAI.log('message view never rendered', 'warn'); continue; }
      const sender = document.querySelector('.msg-view .msg-sender')?.textContent?.trim() ?? '';
      const subject = document.querySelector('.msg-view .msg-subject')?.textContent?.trim() ?? '';
      const text = body.textContent?.trim() ?? '';
      say('Generating reply ' + (i + 1) + '...');
      const reply = await WidgetAI.inference({
        prompt: 'Write a concise, friendly reply to this email.',
        context: { sender, subject, body: text },
      });
      const replyBtn = await waitFor(() => document.querySelector('.msg-view .reply-btn'));
      replyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const composer = await waitFor(() => document.querySelector('.reply-composer[contenteditable="true"]'));
      if (!composer) { WidgetAI.log('composer never opened', 'warn'); continue; }
      composer.focus();
      composer.innerText = reply;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: reply }));
      say('Waiting for draft autosave...');
      // verify via DOM (USER_SCRIPT world cannot read page JS globals)
      const saved = await waitFor(() => [...document.querySelectorAll('.draft-saved')].some(e => !e.hidden && e.offsetParent !== null), 6000);
      say(saved ? 'Draft ' + (i + 1) + ' saved.' : 'Draft ' + (i + 1) + ' not confirmed.');
      if (saved) done++;
      document.querySelector('.msg-view .back-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => document.querySelector('.msg-list'), 5000);
    }
    say('Completed: ' + done + ' draft(s) created.');
    if (done === rows.length) WidgetAI.status('completed', done + ' drafts');
    else WidgetAI.status('failed', 'only ' + done + ' drafts');
  } catch (e) {
    say('Error: ' + (e?.message ?? e));
    WidgetAI.status('failed', String(e?.message ?? e));
  } finally { btn.disabled = false; }
});
`;

// YouTube-fixture widget: comment topic analyzer panel.
export const MOCK_WIDGET_CODE_YT = `
const anchor = document.querySelector('.comments h2') || document.querySelector('main');
const host = document.createElement('div');
host.id = 'wwa-topic-analyzer';
anchor.parentElement.insertBefore(host, anchor);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>
  .panel { background:#1e1e1e; border:1px solid #333; border-radius:10px; padding:12px; margin:8px 0; font:13px system-ui; color:#f1f1f1; }
  button { background:#f00; color:#fff; border:0; border-radius:16px; padding:6px 14px; font:13px system-ui; cursor:pointer; }
  pre { white-space:pre-wrap; margin:8px 0 0; font:12px/1.5 system-ui; }
  #st { color:#aaa; font-size:12px; margin-left:8px; }
</style><div class="panel"><button id="go">Analyze comment topics</button><span id="st"></span><pre id="out" hidden></pre></div>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const out = root.getElementById('out');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };
btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    say('Reading comments...');
    const comments = [...document.querySelectorAll('.comment')].map(c => ({
      author: c.querySelector('.author')?.textContent?.trim() ?? '',
      text: c.querySelector('.comment-text')?.textContent?.trim() ?? '',
    })).filter(c => c.text);
    if (!comments.length) { say('No comments found.'); WidgetAI.status('failed', 'no comments'); return; }
    say('Grouping ' + comments.length + ' comments into topics...');
    const result = await WidgetAI.inference({
      prompt: 'Group these video comments into the most common discussion topics. For each topic list the commenters.',
      context: { comments },
    });
    out.textContent = result;
    out.hidden = false;
    say('Done — ' + comments.length + ' comments analyzed.');
    WidgetAI.status('completed', comments.length + ' comments analyzed');
  } catch (e) {
    say('Error: ' + (e?.message ?? e));
    WidgetAI.status('failed', String(e?.message ?? e));
  } finally { btn.disabled = false; }
});
`;

// NetMail fixture widget — uses the NETWORK surface (Phase E): finds the captured, browser-confirmed
// POST /fixture-api/drafts op, resolves its token dependency (analysis.dependsOn → GET /fixture-api/csrf,
// a rotating single-use token) by re-fetching it, replays the draft POST with the fresh token via
// mergeBody/headers, reads the drafts list back, then WidgetAI.net.reportVerified → tier "verified".
// DOM fallback when the network path fails before anything was created. Mirrors what the LLM is expected to
// produce when OBSERVED NETWORK OPERATIONS (with op analysis) are present in the context.
export const MOCK_WIDGET_CODE_NET = `
const waitFor = async (fn, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 120)); }
  return null;
};
const parseJson = (t) => { try { return JSON.parse(t || ''); } catch (e) { return null; } };
const getPath = (obj, path) => String(path).replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean)
  .reduce((o, k) => (o == null ? undefined : o[k]), obj);
const toolbar = await waitFor(() => document.getElementById('nm-toolbar'));
const host = document.createElement('div');
host.id = 'wwa-net-drafter';
(toolbar || document.body).appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>
  button { font:13px arial; padding:6px 12px; border:1px solid #dadce0; border-radius:4px; background:#fff; cursor:pointer; }
  #st { font:12px arial; color:#5f6368; margin-left:8px; }
</style><button id="go">Create draft via captured API</button><span id="st"></span>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };

const DRAFT = {
  to: 'devin+api@example.com',
  subject: 'API-authored draft',
  body: 'This draft was created by replaying the captured save-draft request via WidgetAI.net.invoke with a re-fetched CSRF token — no UI clicks.',
};

async function viaNetwork() {
  say('Looking for the captured draft operation…');
  const ops = await WidgetAI.net.operations();
  const op = ops.find(o => o.method === 'POST' && /\\/fixture-api\\/drafts$/.test(o.path) && o.confirmed && !o.replay && o.ok);
  if (!op) throw new Error('no confirmed POST /fixture-api/drafts — save a draft via the UI once first');
  const a = op.analysis || { dependsOn: [], tokenFields: [] };
  WidgetAI.log('op ' + (a.templateKey || op.path) + ' tier=' + op.tier + ' tokenFields=' + (a.tokenFields || []).join(','));
  const mergeBody = { to: DRAFT.to, subject: DRAFT.subject, body: DRAFT.body };
  const headers = {};
  for (const dep of a.dependsOn || []) {
    const depOp = ops.find(o => o.id === dep.opId) || ops.find(o => o.analysis && o.analysis.templateKey === dep.fromTemplate);
    if (!depOp || depOp.method !== 'GET') throw new Error('cannot safely re-fetch dependency ' + dep.fromTemplate);
    say('Re-fetching ' + dep.fromTemplate + ' for a fresh ' + dep.field + '…');
    const fresh = await WidgetAI.net.invoke(depOp.id);
    if (!fresh.ok) throw new Error('dependency re-fetch failed: HTTP ' + fresh.status);
    const value = getPath(parseJson(fresh.bodyText), dep.path);
    if (value === undefined || value === null) throw new Error('dependency value missing at ' + dep.path);
    if (dep.field.startsWith('body.')) mergeBody[dep.field.slice(5)] = value;
    else if (dep.field.startsWith('header.')) headers[dep.field.slice(7)] = String(value);
  }
  say('Replaying ' + op.method + ' ' + op.path + ' with new parameters…');
  const res = await WidgetAI.net.invoke(op.id, { mergeBody, headers });
  if (!res.ok) throw new Error('invoke failed: HTTP ' + res.status + ' ' + String(res.bodyText || '').slice(0, 120));
  created = true;
  say('Verifying via read-back request…');
  const list = await WidgetAI.net.request({ url: '/fixture-api/drafts' });
  const drafts = (parseJson(list.bodyText) || {}).drafts || [];
  if (!list.ok || !drafts.some(d => d.subject === DRAFT.subject && d.to === DRAFT.to)) throw new Error('draft not present in read-back list');
  const v = await WidgetAI.net.reportVerified(op.id, { readBack: 'GET /fixture-api/drafts contains "' + DRAFT.subject + '"' });
  WidgetAI.log('reportVerified → ' + (v.verified ? 'verified' : 'refused: ' + v.error) + ' (tier ' + v.tier + ')');
  return v.tier;
}

async function viaDom() {
  const setVal = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  document.getElementById('compose-btn').click();
  const to = await waitFor(() => document.getElementById('cm-to'));
  if (!to) throw new Error('composer did not open');
  setVal(to, DRAFT.to);
  setVal(document.getElementById('cm-subject'), DRAFT.subject);
  setVal(document.getElementById('cm-body'), 'Created through the UI (DOM fallback).');
  document.getElementById('cm-save').click();
  const ok = await waitFor(() => { const t = document.getElementById('toast'); return t && !t.hidden && /Draft saved/.test(t.textContent) ? t : null; });
  if (!ok) throw new Error('DOM fallback: "Draft saved" confirmation not seen');
}

let created = false;
btn.addEventListener('click', async () => {
  btn.disabled = true;
  created = false;
  try {
    const tier = await viaNetwork();
    say('Draft created and verified via the API (tier ' + tier + ').');
    WidgetAI.status('completed', 'draft created via network replay (tier ' + tier + ')');
  } catch (e) {
    const why = String(e && e.message || e);
    if (created) { say('Error: ' + why); WidgetAI.status('failed', why); }
    else {
      say('Network path failed (' + why + ') — falling back to the UI…');
      try { await viaDom(); say('Draft created via the UI (DOM fallback).'); WidgetAI.status('completed', 'draft created via DOM fallback'); }
      catch (e2) { const m = String(e2 && e2.message || e2); say('Error: ' + m); WidgetAI.status('failed', why + '; ' + m); }
    }
  } finally { btn.disabled = false; }
});
`;

// Gmail-realistic (obfuscated) fixture widget — selectors mirror what the LLM
// produces for Gmail-shaped DOM: tr.zA.zE rows, aria-label affordances.
export const MOCK_WIDGET_CODE_G2 = `
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(120); }
  return null;
};
const clickEl = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const findAffordance = (re) => [...document.querySelectorAll('[role="button"], [role="link"], [tabindex], a, button, [aria-label]')]
  .find(e => re.test(e.getAttribute('aria-label') || '') || re.test(e.textContent || ''));

const toolbar = await waitFor(() => document.querySelector('[role="toolbar"]'));
const host = document.createElement('div');
host.id = 'wwa-g2-drafter';
toolbar.appendChild(host);
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = \`<style>
  button { font:13px arial; padding:6px 12px; border:1px solid #dadce0; border-radius:4px; background:#fff; cursor:pointer; }
  #st { font:12px arial; color:#5f6368; margin-left:8px; }
</style><button id="go">Draft Replies (2 unread)</button><span id="st"></span>\`;
const btn = root.getElementById('go');
const st = root.getElementById('st');
const say = (m) => { st.textContent = m; WidgetAI.log(m); };

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    // stable keys up front — unread rows shrink as we process
    const targets = [...document.querySelectorAll('tr.zA.zE')].slice(0, 2)
      .map(r => r.dataset.legacyMessageId || r.textContent.trim().slice(0, 40));
    if (!targets.length) { say('No unread emails.'); return; }
    let done = 0;
    for (const [i, key] of targets.entries()) {
      say('Opening email ' + (i + 1) + '/' + targets.length);
      const row = [...document.querySelectorAll('tr.zA')].find(r =>
        (r.dataset.legacyMessageId || r.textContent.trim().slice(0, 40)) === key);
      if (!row) { WidgetAI.log('row gone: ' + key, 'warn'); continue; }
      const listEl = document.querySelector('table[role="grid"]');
      clickEl(row);
      await waitFor(() => !listEl.isConnected || document.querySelector('.a3s'), 8000);
      const body = document.querySelector('.a3s')?.textContent?.trim() ?? '';
      const subject = document.querySelector('.hP')?.textContent?.trim() ?? '';
      const sender = document.querySelector('.gD')?.textContent?.trim() ?? '';
      say('Generating reply ' + (i + 1) + '...');
      const reply = await WidgetAI.inference({
        prompt: 'Write a concise, friendly reply to this email.',
        context: { sender, subject, body },
      });
      const replyBtn = await waitFor(() => findAffordance(/reply/i));
      clickEl(replyBtn);
      const ed = await waitFor(() => document.querySelector('[contenteditable="true"]'));
      ed.focus();
      ed.innerText = reply;
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: reply }));
      const saved = await waitFor(() => [...document.querySelectorAll('.vh')].some(e => !e.hidden && /draft/i.test(e.textContent)), 6000);
      say(saved ? 'Draft ' + (i + 1) + ' saved.' : 'Draft ' + (i + 1) + ' not confirmed.');
      if (saved) done++;
      const back = findAffordance(/back/i);
      if (back) clickEl(back);
      await waitFor(() => document.querySelector('table[role="grid"]'), 6000);
    }
    say('Completed: ' + done + ' draft(s) created.');
    WidgetAI.status(done === targets.length ? 'completed' : 'failed', done + '/' + targets.length + ' drafts');
  } catch (e) {
    say('Error: ' + (e?.message ?? e));
    WidgetAI.status('failed', String(e?.message ?? e));
  } finally { btn.disabled = false; }
});
`;
