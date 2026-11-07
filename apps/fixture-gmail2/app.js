// HardMail — Gmail-realistic DOM: tr.zA.zE rows, span.gD sender, div.a3s body,
// aria-label reply/back affordances, obfuscated classes.
(function () {
  'use strict';
  window.__drafts = []; window.__sent = [];
  const M = [
    { id:'m1', name:'Priya Nair', email:'priya@example.com', subject:'Q4 launch checklist',
      body:'Hi,\n\nCan you review the Q4 launch checklist by Friday? Items 3 and 7 still need owners, and marketing wants the timeline confirmed before the all-hands.\n\nThanks,\nPriya', date:'Nov 6', unread:true },
    { id:'m2', name:'Devon Cole', email:'devon@example.com', subject:'Dinner Saturday?',
      body:'Hey!\n\nA few of us are doing dinner Saturday at 7 at the usual spot. You in? Let me know by Thursday so I can book the table.\n\n— Devon', date:'Nov 6', unread:true },
    { id:'m3', name:'Alerts', email:'newsletter@corp.example.com', subject:'Weekly digest #482',
      body:'Your weekly digest: 3 new docs, 1 pending approval, uptime 99.98%.', date:'Nov 4', unread:false },
  ];
  const app = document.getElementById('app');
  const toast = document.getElementById('toast');
  const dcount = document.getElementById('dcount');
  const bump = () => { dcount.textContent = String(window.__drafts.length); };
  let toastT = null;
  const flash = (t) => { toast.textContent = t; toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => toast.hidden = true, 2500); };

  function inbox() {
    document.title = 'HardMail — Inbox';
    app.innerHTML = '<table class="F" role="grid" aria-label="Inbox"><tbody></tbody></table>';
    const tb = app.querySelector('tbody');
    for (const m of M) {
      const tr = document.createElement('tr');
      tr.className = 'zA' + (m.unread ? ' zE' : '');
      tr.setAttribute('role','row');
      tr.dataset.legacyMessageId = m.id;
      tr.innerHTML = '<td class="yX xY" role="gridcell"><span class="yW"><span class="bA4"></span></span></td><td class="y2" role="gridcell"><span class="bog"></span><span class="y2 s"></span></td><td class="xY" role="gridcell"></td>';
      tr.querySelector('.bA4').textContent = m.name;
      tr.querySelector('.bog').textContent = m.subject;
      tr.querySelector('.y2.s').textContent = ' — ' + m.body.slice(0, 60);
      tr.querySelector('.xY').textContent = m.date;
      tr.addEventListener('click', () => { m.unread = false; open(m); });
      tb.appendChild(tr);
    }
  }

  function open(m) {
    document.title = 'HardMail — ' + m.subject;
    app.innerHTML = `<div class="adn ads" role="main">
      <div class="ajy" role="button" aria-label="Back to Inbox" tabindex="0" style="cursor:pointer;margin-bottom:10px">&larr;</div>
      <h2 class="hP"></h2>
      <div><span class="gD" email=""></span> <span class="go"></span></div>
      <div class="a3s aiL" role="presentation"></div>
      <div class="aoI"></div>
      <span class="ams bkH" role="link" tabindex="0" aria-label="Reply">Reply</span>
    </div>`;
    const v = app.querySelector('.adn');
    v.querySelector('.hP').textContent = m.subject;
    const sd = v.querySelector('.gD'); sd.textContent = m.name; sd.setAttribute('email', m.email);
    v.querySelector('.go').textContent = '<' + m.email + '>';
    v.querySelector('.a3s').textContent = m.body;
    const back = () => inbox();
    v.querySelector('.ajy').addEventListener('click', back);
    v.querySelector('.ajy').addEventListener('keydown', e => { if (e.key==='Enter') back(); });
    const reply = v.querySelector('.ams');
    const openComposer = () => {
      const area = v.querySelector('.aoI');
      area.innerHTML = `<div class="Am aiL aO9" contenteditable="true" role="textbox" aria-label="Message Body" aria-multiline="true" tabindex="0"></div>
        <div class="J-J5-Ji"><div class="T-I J-J5-Ji T-I-KE" role="button" aria-label="Send" tabindex="0">Send</div></div>`;
      const ed = area.querySelector('.Am');
      let t = null;
      ed.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const body = ed.innerText.trim();
          if (!body) return;
          const i = window.__drafts.findIndex(d => d.msgId === m.id);
          const rec = { msgId: m.id, subject: m.subject, body, ts: Date.now() };
          if (i >= 0) window.__drafts[i] = rec; else window.__drafts.push(rec);
          flash('Draft saved'); bump();
        }, 500);
      });
      area.querySelector('[aria-label="Send"]').addEventListener('click', () => {
        window.__sent.push({ msgId: m.id, body: ed.innerText, ts: Date.now() });
        area.innerHTML = '<em>Sent.</em>';
      });
      ed.focus();
    };
    reply.addEventListener('click', openComposer);
    reply.addEventListener('keydown', e => { if (e.key==='Enter') openComposer(); });
  }

  function drafts() {
    app.innerHTML = '<div class="adn"><div class="ajy" role="button" aria-label="Back to Inbox" tabindex="0" style="cursor:pointer">&larr;</div><h2 class="hP">Drafts</h2><div class="dl"></div></div>';
    const l = app.querySelector('.dl');
    for (const d of window.__drafts) {
      const el = document.createElement('div');
      el.className = 'aap';
      el.innerHTML = '<strong class="ds"></strong><div class="db" style="white-space:pre-wrap"></div>';
      el.querySelector('.ds').textContent = 'Re: ' + d.subject;
      el.querySelector('.db').textContent = d.body;
      l.appendChild(el);
    }
    app.querySelector('.ajy').addEventListener('click', inbox);
  }
  document.getElementById('drafts-nav').addEventListener('click', drafts);
  inbox();
})();
