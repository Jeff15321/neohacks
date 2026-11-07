// NetMail — every UI action issues a REAL fetch to /fixture-api/* so the
// extension can observe, correlate, and replay the underlying operations.
(function () {
  'use strict';
  const app = document.getElementById('app');
  const toast = document.getElementById('toast');
  const dcount = document.getElementById('dcount');
  let toastT = null;
  const flash = (t) => { toast.textContent = t; toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => toast.hidden = true, 3000); };
  const api = (p, opts) => fetch(p, opts).then(r => r.json());
  const j = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  function refreshCount() {
    api('/fixture-api/drafts').then(d => { dcount.textContent = String(d.drafts.length); });
  }

  function inbox() {
    document.title = 'NetMail — Inbox';
    app.innerHTML = '<em>loading…</em>';
    api('/fixture-api/messages').then(({ messages }) => {
      app.innerHTML = '<table class="list" role="grid" aria-label="Inbox"><tbody></tbody></table>';
      const tb = app.querySelector('tbody');
      for (const m of messages) {
        const tr = document.createElement('tr');
        tr.className = 'zA' + (m.unread ? ' zE' : '');
        tr.dataset.msgId = m.id;
        tr.innerHTML = '<td class="who"></td><td class="sub"></td><td class="dt"></td>';
        tr.querySelector('.who').textContent = m.from;
        tr.querySelector('.sub').textContent = m.subject;
        tr.querySelector('.dt').textContent = m.date;
        tr.addEventListener('click', () => open(m.id));
        tb.appendChild(tr);
      }
    }).catch(e => { app.innerHTML = '<div class="err">failed: ' + e + '</div>'; });
  }

  function open(id) {
    fetch('/fixture-api/messages/' + id + '/read', { method: 'POST' })
      .then(() => api('/fixture-api/messages/' + id))
      .then(({ message: m }) => {
        document.title = 'NetMail — ' + m.subject;
        app.innerHTML = `<div class="adn">
          <div class="ajy" role="button" aria-label="Back to Inbox" tabindex="0" style="cursor:pointer;margin-bottom:10px">&larr;</div>
          <h2 class="hP"></h2>
          <div><span class="gD"></span> <span class="go"></span></div>
          <div class="a3s"></div>
        </div>`;
        const v = app.querySelector('.adn');
        v.querySelector('.hP').textContent = m.subject;
        v.querySelector('.gD').textContent = m.fromName;
        v.querySelector('.go').textContent = '<' + m.from + '>';
        v.querySelector('.a3s').textContent = m.body;
        v.querySelector('.ajy').addEventListener('click', inbox);
      });
  }

  function compose() {
    document.title = 'NetMail — Compose';
    app.innerHTML = `<form class="cmp">
      <input id="cm-to" placeholder="To" aria-label="To">
      <input id="cm-subject" placeholder="Subject" aria-label="Subject">
      <textarea id="cm-body" placeholder="Message" aria-label="Message Body"></textarea>
      <div>
        <button type="button" class="T-I" id="cm-save" aria-label="Save draft">Save draft</button>
        <button type="button" class="T-I" id="cm-send" aria-label="Send">Send</button>
      </div>
    </form>`;
    const fields = () => ({
      to: document.getElementById('cm-to').value,
      subject: document.getElementById('cm-subject').value,
      body: document.getElementById('cm-body').value,
    });
    document.getElementById('cm-save').addEventListener('click', () => {
      api('/fixture-api/drafts', j(fields())).then(r => {
        if (r.ok) { flash('Draft saved'); refreshCount(); }
        else flash('Save failed');
      });
    });
    document.getElementById('cm-send').addEventListener('click', () => {
      api('/fixture-api/send', j(fields())).then(r => {
        if (r.ok) flash('Sent'); else flash('Send failed');
      });
    });
  }

  function drafts() {
    document.title = 'NetMail — Drafts';
    api('/fixture-api/drafts').then(({ drafts }) => {
      app.innerHTML = '<div class="adn"><div class="ajy" role="button" aria-label="Back to Inbox" tabindex="0" style="cursor:pointer">&larr;</div><h2 class="hP">Drafts</h2><div class="dl"></div></div>';
      const l = app.querySelector('.dl');
      if (!drafts.length) l.innerHTML = '<em>No drafts.</em>';
      for (const d of drafts) {
        const el = document.createElement('div');
        el.className = 'draft-item';
        el.innerHTML = '<strong class="ds"></strong> <span class="dt"></span><div class="db" style="white-space:pre-wrap"></div>';
        el.querySelector('.ds').textContent = d.subject + ' → ' + d.to;
        el.querySelector('.dt').textContent = '#' + d.id;
        el.querySelector('.db').textContent = d.body;
        l.appendChild(el);
      }
      app.querySelector('.ajy').addEventListener('click', inbox);
    });
  }

  document.getElementById('inbox-btn').addEventListener('click', inbox);
  document.getElementById('drafts-btn').addEventListener('click', drafts);
  document.getElementById('compose-btn').addEventListener('click', compose);
  refreshCount();
  inbox();
})();
