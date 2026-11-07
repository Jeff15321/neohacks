// FixtureMail — a Gmail-shaped SPA for testing generated widgets.
// Instrumented for tests: window.__drafts, window.__sent.
(function () {
  'use strict';
  window.__drafts = [];   // {msgId, body, ts}
  window.__sent = [];     // {msgId, body, ts} — widget must NEVER add to this

  const MESSAGES = [
    { id: 'm1', sender: 'Priya Nair <priya@example.com>', subject: 'Q4 launch checklist',
      body: 'Hi,\n\nCan you review the Q4 launch checklist by Friday? Items 3 and 7 still need owners, and marketing wants the timeline confirmed before the all-hands.\n\nThanks,\nPriya',
      date: 'Nov 6', unread: true },
    { id: 'm2', sender: 'Devon Cole <devon@example.com>', subject: 'Dinner Saturday?',
      body: 'Hey!\n\nA few of us are doing dinner Saturday at 7 at the usual spot. You in? Let me know by Thursday so I can book the table.\n\n— Devon',
      date: 'Nov 6', unread: true },
    { id: 'm3', sender: 'newsletter@corp.example.com', subject: 'Weekly digest #482',
      body: 'Your weekly digest: 3 new docs, 1 pending approval, uptime 99.98%.',
      date: 'Nov 4', unread: false },
  ];

  const app = document.getElementById('app');
  const draftCount = document.getElementById('draft-count');
  const bump = () => { draftCount.textContent = String(window.__drafts.length); };

  function showInbox() {
    document.title = 'Fixture Mail — Inbox';
    app.innerHTML = '<div class="msg-list" role="list"></div>';
    const list = app.querySelector('.msg-list');
    for (const m of MESSAGES) {
      const row = document.createElement('div');
      row.className = 'msg-row' + (m.unread ? ' unread' : '');
      row.setAttribute('role', 'listitem');
      row.dataset.msgId = m.id;
      row.innerHTML = `<span class="r-sender"></span><span class="r-subject"></span><span class="r-snippet"></span><span class="r-date"></span>`;
      row.querySelector('.r-sender').textContent = m.sender;
      row.querySelector('.r-subject').textContent = m.subject;
      row.querySelector('.r-snippet').textContent = m.body.slice(0, 80);
      row.querySelector('.r-date').textContent = m.date;
      row.addEventListener('click', () => { m.unread = false; showMessage(m); });
      list.appendChild(row);
    }
  }

  function showMessage(m) {
    document.title = 'Fixture Mail — ' + m.subject;
    app.innerHTML = `<div class="msg-view">
      <button class="back-btn" aria-label="Back to inbox">&larr; Back</button>
      <h2 class="msg-subject"></h2>
      <div class="msg-sender"></div>
      <div class="msg-body" aria-label="Message body"></div>
      <div class="reply-area"></div>
      <button class="reply-btn" aria-label="Reply">Reply</button>
    </div>`;
    const view = app.querySelector('.msg-view');
    view.querySelector('.msg-subject').textContent = m.subject;
    view.querySelector('.msg-sender').textContent = m.sender;
    view.querySelector('.msg-body').textContent = m.body;
    view.querySelector('.back-btn').addEventListener('click', showInbox);
    view.querySelector('.reply-btn').addEventListener('click', () => {
      const area = view.querySelector('.reply-area');
      area.innerHTML = `<div class="reply-composer" contenteditable="true" aria-label="Reply composer"></div>
        <button class="send-btn">Send</button><span class="draft-saved" hidden>Draft saved</span>`;
      const composer = area.querySelector('.reply-composer');
      const savedEl = area.querySelector('.draft-saved');
      let timer = null;
      // Gmail-like: draft persists via debounced autosave on input events.
      composer.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const body = composer.innerText.trim();
          if (!body) return;
          const existing = window.__drafts.findIndex(d => d.msgId === m.id);
          const rec = { msgId: m.id, subject: m.subject, body, ts: Date.now() };
          if (existing >= 0) window.__drafts[existing] = rec; else window.__drafts.push(rec);
          savedEl.hidden = false; bump();
        }, 400);
      });
      area.querySelector('.send-btn').addEventListener('click', () => {
        window.__sent.push({ msgId: m.id, body: composer.innerText, ts: Date.now() });
        area.innerHTML = '<em>Message sent.</em>';
      });
      composer.focus();
    });
  }

  function showDrafts() {
    app.innerHTML = '<div class="msg-view"><button class="back-btn">&larr; Back</button><h2>Drafts</h2><div class="draft-list"></div></div>';
    const list = app.querySelector('.draft-list');
    for (const d of window.__drafts) {
      const el = document.createElement('div');
      el.className = 'draft-item';
      el.innerHTML = `<strong class="d-subject"></strong><div class="d-body" style="white-space:pre-wrap"></div>`;
      el.querySelector('.d-subject').textContent = 'Re: ' + d.subject;
      el.querySelector('.d-body').textContent = d.body;
      list.appendChild(el);
    }
    app.querySelector('.back-btn').addEventListener('click', showInbox);
  }

  document.getElementById('inbox-link').addEventListener('click', showInbox);
  document.getElementById('drafts-link').addEventListener('click', showDrafts);
  showInbox();
})();
