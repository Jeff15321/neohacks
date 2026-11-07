// HardMail — Gmail-realistic DOM: tr.zA.zE rows, span.gD sender, div.a3s body,
// aria-label reply/back affordances, obfuscated classes.
(function () {
  'use strict';
  window.__drafts = []; window.__sent = []; window.__deleted = [];
  // ---- chaos mode (?chaos=<seed> or ?chaos=popup,renamed,…). No param → behaviour identical to the plain fixture. ----
  const CHAOS_FAULTS = ['collapsed', 'popup', 'renamed', 'slow'];
  const chaosParam = new URLSearchParams(location.search).get('chaos');
  const CH = (() => {
    const c = { on: chaosParam !== null, seed: chaosParam, faults: [] };
    if (!c.on) return c;
    if (/^\d+$/.test(chaosParam)) {
      let a = Number(chaosParam) >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      if (rnd() < 0.1) c.faults = ['empty'];
      else {
        c.faults = CHAOS_FAULTS.filter(() => rnd() < 0.4);
        if (!c.faults.length) c.faults = [CHAOS_FAULTS[Math.floor(rnd() * CHAOS_FAULTS.length)]];
      }
    } else c.faults = chaosParam.split(',').map(x => x.trim()).filter(Boolean);
    return c;
  })();
  const chaos = (f) => CH.faults.includes(f);
  window.__chaos = CH;
  let popupOpen = false;
  let popupShown = false;
  function showPopup() {
    if (popupShown) return; popupShown = true; popupOpen = true;
    const bd = document.createElement('div');
    bd.className = 'Kj-JD-Jh';
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center';
    bd.innerHTML = '<div class="Kj-JD" role="dialog" aria-modal="true" aria-label="Try the new HardMail" style="background:#fff;padding:20px 24px;border-radius:8px;max-width:360px">'
      + '<h3 style="margin:0 0 8px">Try the new HardMail!</h3><p style="margin:0 0 14px">Smart compose, a fresh look and more. Switch now?</p>'
      + '<div class="T-I" role="button" tabindex="0" aria-label="Not now">Not now</div> <div class="T-I" role="button" tabindex="0" aria-label="Try it">Try it</div></div>';
    const close = () => { popupOpen = false; bd.remove(); };
    bd.querySelectorAll('[role="button"]').forEach(b => b.addEventListener('click', close));
    document.body.appendChild(bd);
  }
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

  let firstLoad = true;
  function inbox() {
    document.title = 'HardMail — Inbox';
    if (chaos('slow') && firstLoad) {
      firstLoad = false;
      app.innerHTML = '<div class="vX" role="status">Loading…</div>';
      setTimeout(inbox, 1800);
      return;
    }
    firstLoad = false;
    if (chaos('empty')) {
      app.innerHTML = '<div class="TC" role="status">Your inbox is empty. No new mail!</div>';
      return;
    }
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
      tr.addEventListener('click', () => {
        if (chaos('popup') && !popupShown) { showPopup(); return; } // interstitial swallows the first open
        if (popupOpen) return;
        m.unread = false; open(m);
      });
      tb.appendChild(tr);
    }
  }

  function open(m) {
    if (chaos('slow') && !m.__loaded) {
      m.__loaded = true;
      app.innerHTML = '<div class="vX" role="status">Loading conversation…</div>';
      setTimeout(() => open(m), 1200);
      return;
    }
    document.title = 'HardMail — ' + m.subject;
    const replyLabel = chaos('renamed') ? 'Respond' : 'Reply';
    app.innerHTML = `<div class="adn ads" role="main">
      <div class="ajy" role="button" aria-label="Back to Inbox" tabindex="0" style="cursor:pointer;margin-bottom:10px">&larr;</div>
      <h2 class="hP"></h2>
      <div><span class="gD" email=""></span> <span class="go"></span></div>
      <div class="a3s aiL" role="presentation"></div>
      <div class="aoI"></div>
      <span class="ams bkH" role="link" tabindex="0" aria-label="${replyLabel}">${replyLabel}</span>
    </div>`;
    if (CH.on) {
      const del = document.createElement('div');
      del.className = 'T-I nX'; del.setAttribute('role', 'button'); del.setAttribute('tabindex', '0'); del.setAttribute('aria-label', 'Delete');
      del.textContent = 'Delete'; del.style.cssText = 'display:inline-block;margin-left:8px';
      del.addEventListener('click', () => { window.__deleted.push({ msgId: m.id, ts: Date.now() }); const i = M.indexOf(m); if (i >= 0) M.splice(i, 1); inbox(); });
      app.querySelector('.ajy').after(del);
    }
    const v = app.querySelector('.adn');
    v.querySelector('.hP').textContent = m.subject;
    const sd = v.querySelector('.gD'); sd.textContent = m.name; sd.setAttribute('email', m.email);
    v.querySelector('.go').textContent = '<' + m.email + '>';
    v.querySelector('.a3s').textContent = m.body;
    const back = () => inbox();
    v.querySelector('.ajy').addEventListener('click', back);
    v.querySelector('.ajy').addEventListener('keydown', e => { if (e.key==='Enter') back(); });
    const reply = v.querySelector('.ams');
    let collapsedOnce = false;
    const openComposer = () => {
      if (popupOpen) return;
      const area = v.querySelector('.aoI');
      if (chaos('collapsed') && !collapsedOnce) {
        collapsedOnce = true;
        area.innerHTML = '<div class="aoP" role="button" tabindex="0" aria-expanded="false" aria-label="Expand composer" style="border:1px dashed #bbb;padding:6px;margin-top:8px;cursor:pointer">Composer collapsed — click to expand</div>';
        const bar = area.querySelector('.aoP');
        bar.addEventListener('click', openComposer);
        bar.addEventListener('keydown', e => { if (e.key === 'Enter') openComposer(); });
        return;
      }
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
