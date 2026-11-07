/**
 * Prelude section — owner: Phase C. Decision B self-healing runtime:
 *   WidgetAI.step(name, {goal, run, expect, branches?, multiOutcome?, region?, timeoutMs?})
 *   WidgetAI.run(goal, fn, {state?, timeoutMs?})   — one widget run (caps + timeline + final-failure narrative)
 *   WidgetAI.addBranch(step, {id, when, run})        — learned branches (added by "add this branch?" versions)
 *   WidgetAI.helpers                                  — the `h` helper library also given to branches
 *   danger guard: capture-phase interception of script-originated clicks/submits/Enter on consequential controls
 *   and WidgetAI.net DELETE / send-like routes → in-page Allow / Block.
 */
import { ASSIST_LIMITS } from '@app/contracts';
import { DANGER_ROUTE_RE, DANGER_TEXT_RE, SAFE_PHRASES_RE } from '@app/core/danger';
import { HELPERS_SRC } from './helpers.js';

export const stepSection = (): string => `
const __H = ${HELPERS_SRC};
const __DANGER_RE = new RegExp(${JSON.stringify(DANGER_TEXT_RE.source)}, 'i');
const __SAFE_RE = new RegExp(${JSON.stringify(SAFE_PHRASES_RE.source)}, 'i');
const __ROUTE_RE = new RegExp(${JSON.stringify(DANGER_ROUTE_RE.source)}, 'i');
const __AL = ${JSON.stringify({ STATE_CHARS: ASSIST_LIMITS.STATE_CHARS, DOM: ASSIST_LIMITS.DOM_SKELETON_CHARS, RUN_TIMEOUT_MS: ASSIST_LIMITS.RUN_TIMEOUT_MS })};
const __LEARNED = {};
const __actions = [];
let __run = null;
const __rid = () => 'r_' + Math.random().toString(36).slice(2, 10);
const __clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
/** Replace the run state's CONTENTS (identity kept, so callers holding the object always see the latest state). */
const __adopt = (r, v) => {
  if (!v || typeof v !== 'object' || v === r.state) return;
  const next = __clone(v);
  for (const k of Object.keys(r.state)) delete r.state[k];
  Object.assign(r.state, next);
};
const __clip = (s, n) => { s = typeof s === 'string' ? s : (s === undefined ? '' : JSON.stringify(s)); return s.length > n ? s.slice(0, n) + '…' : s; };
const __act = (a) => { __actions.push(__clip(a, 280)); if (__actions.length > 12) __actions.shift(); };

const __ev = (kind, step, detail, data) => {
  const r = __ensureRun();
  const event = { ts: Date.now(), kind };
  if (step) event.step = String(step);
  if (detail !== undefined && detail !== null) event.detail = __clip(String(detail), 600);
  if (data !== undefined) event.data = data;
  __send({ type: 'WIDGET_RUN_EVENT', runId: r.id, event });
  return r;
};
const __ensureRun = (goal) => {
  if (!__run) {
    __run = { id: __rid(), state: {}, failed: false, t0: Date.now() };
    const event = { ts: Date.now(), kind: 'run-start', detail: __clip(String(goal || WIDGET_META.name), 600) };
    __send({ type: 'WIDGET_RUN_EVENT', runId: __run.id, event });
  }
  return __run;
};

/** Compact DOM skeleton of a region (UNTRUSTED page content, for the agent). */
const __skeleton = (root) => {
  root = (typeof root === 'string' ? document.querySelector(root) : root) || document.body;
  const out = []; let len = 0;
  const KEEP_ATTR = ['id', 'role', 'aria-label', 'aria-expanded', 'aria-hidden', 'contenteditable', 'type', 'name', 'placeholder', 'href', 'data-legacy-message-id', 'hidden', 'tabindex'];
  const walk = (el, depth) => {
    if (len > __AL.DOM - 200 || depth > 25) return;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'svg', 'noscript', 'template', 'link', 'meta'].includes(tag)) return;
    if (el.id && el.id.indexOf('wwa-') === 0) return;
    const hidden = el.hidden || (el.getAttribute('aria-hidden') === 'true') || !__H.visible(el);
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\\s+/g, ' ').trim();
    const attrs = [];
    for (const a of KEEP_ATTR) { const v = el.getAttribute(a); if (v !== null) attrs.push(a + '="' + __clip(v, 60) + '"'); }
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    const interesting = attrs.length || own || ['button', 'a', 'input', 'textarea', 'select', 'table', 'tr', 'h1', 'h2', 'h3', 'dialog', 'form'].includes(tag);
    if (interesting) {
      const line = '  '.repeat(Math.min(depth, 12)) + '<' + tag + (cls ? '.' + cls : '') + (attrs.length ? ' ' + attrs.join(' ') : '') + (hidden ? ' [hidden]' : '') + '>' + (own ? ' ' + __clip(own, 80) : '');
      out.push(line); len += line.length + 1;
    }
    if (hidden && el.children.length > 20) return;
    for (const c of el.children) walk(c, interesting ? depth + 1 : depth);
  };
  try { walk(root, 0); } catch (e) { out.push('(skeleton error: ' + e.message + ')'); }
  // overlays (dialogs, modals, fixed high-z layers) outside the region often ARE the problem — always include them
  try {
    const seen = new Set();
    const cands = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]')];
    for (const el of document.body ? document.body.children : []) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && Number(cs.zIndex) >= 10) cands.push(el);
    }
    const extra = cands.filter(el => !root.contains(el) && !(el.id && el.id.indexOf('wwa-') === 0) && __H.visible(el) && !seen.has(el) && seen.add(el));
    if (extra.length) { out.push('--- overlays outside the region (may cover the page) ---'); len += 60; for (const el of extra.slice(0, 4)) walk(el, 0); }
  } catch (e) {}
  return out.join('\\n').slice(0, __AL.DOM);
};

// ---------- postconditions ----------
const __describe = (x) => {
  if (!x) return '(none)';
  if (typeof x === 'function') return 'custom check' + (x.name ? ' ' + x.name : '');
  const p = [];
  if (x.exists) p.push('element ' + x.exists + ' exists');
  if (x.gone) p.push('element ' + x.gone + ' is gone');
  if (x.count) p.push('at least ' + (x.count.min ?? 1) + ' × ' + x.count.selector);
  if (x.text) p.push('text of ' + x.text.selector + ' matches /' + x.text.match + '/');
  if (x.textChanged) p.push('text of ' + x.textChanged + ' changed');
  if (x.net) p.push('network ' + (x.net.method || 'any') + ' ' + (x.net.path || '') + ' returned 2xx');
  if (x.check) p.push(x.description || 'custom check');
  if (x.description && !x.check) p.push(x.description);
  return p.join(' AND ') || JSON.stringify(x);
};
const __textOf = (sel) => { const e = document.querySelector(sel); return e ? (e.textContent || '').trim() : null; };
const __snapshot = (x) => (x && typeof x === 'object' && x.textChanged) ? __textOf(x.textChanged) : null;
const __checkOnce = async (x, state, ctx) => {
  if (!x) return { ok: true, observed: 'no postcondition' };
  const fails = [];
  const fnCheck = typeof x === 'function' ? x : x.check;
  if (fnCheck) {
    let r; try { r = await fnCheck(__clone(state), __H); } catch (e) { r = 'check threw: ' + (e && e.message || e); }
    if (!(r === true || (r && r.ok === true))) fails.push(typeof r === 'string' ? r : (r && r.observed) || 'custom check returned ' + __clip(r, 120));
  }
  if (typeof x === 'object') {
    if (x.exists && !document.querySelector(x.exists)) fails.push('no element matches ' + x.exists);
    if (x.gone && document.querySelector(x.gone)) fails.push(x.gone + ' still present');
    if (x.count) { const n = document.querySelectorAll(x.count.selector).length; if (n < (x.count.min ?? 1)) fails.push(n + ' × ' + x.count.selector); }
    if (x.text) { const t = __textOf(x.text.selector); if (t === null) fails.push('no element ' + x.text.selector); else if (!new RegExp(x.text.match, 'i').test(t)) fails.push(x.text.selector + ' text is "' + __clip(t, 120) + '"'); }
    if (x.textChanged) { const t = __textOf(x.textChanged); if (t === null) fails.push('no element ' + x.textChanged); else if (t === ctx.before) fails.push(x.textChanged + ' text unchanged ("' + __clip(t, 80) + '")'); }
    if (x.net) {
      if (!__GRANTS.includes('network')) fails.push('net postcondition needs the "network" grant');
      else {
        const ops = (await __request('WIDGET_NET_OPS', {})).operations || [];
        const hit = ops.find(o => (o.ts || 0) >= ctx.t0 - 50 && (!x.net.method || String(o.method).toUpperCase() === String(x.net.method).toUpperCase())
          && (!x.net.path || String(o.path || o.url).indexOf(x.net.path) >= 0) && o.status >= 200 && o.status < 300);
        if (!hit) fails.push('no 2xx ' + (x.net.method || '') + ' ' + (x.net.path || '') + ' since the step started');
      }
    }
  }
  return fails.length ? { ok: false, observed: fails.join('; ') } : { ok: true, observed: __describe(x) };
};
const __waitExpect = async (x, ctx, timeoutMs) => {
  const t0 = Date.now(); let r;
  do { r = await __checkOnce(x, __run.state, ctx); if (r.ok) return r; await __H.sleep(150); } while (Date.now() - t0 < timeoutMs);
  return r;
};

class __StepFailed extends Error {
  constructor(step, reason, narrative) { super('step "' + step + '" failed: ' + reason); this.step = step; this.narrative = narrative; }
}

const __showReport = (title, text) => {
  try {
    let host = document.getElementById('wwa-run-report');
    if (!host) { host = document.createElement('div'); host.id = 'wwa-run-report'; host.setAttribute('data-testid', 'wwa-run-report'); document.documentElement.appendChild(host); }
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:520px;max-height:60vh;overflow:auto;background:#fff;border:2px solid #d93025;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.25);font:12px/1.45 system-ui,arial;color:#202124;padding:10px 12px;';
    host.textContent = '';
    const h = document.createElement('div'); h.style.cssText = 'font-weight:600;color:#d93025;margin-bottom:6px'; h.textContent = title;
    const pre = document.createElement('pre'); pre.style.cssText = 'white-space:pre-wrap;margin:0;font:11px/1.4 ui-monospace,monospace'; pre.textContent = text;
    const x = document.createElement('button'); x.textContent = 'Dismiss'; x.style.cssText = 'margin-top:8px'; x.addEventListener('click', () => host.remove());
    host.append(h, pre, x);
  } catch (e) {}
};

const __finish = async (status, step, detail) => {
  const r = __run; if (!r || r.ended) return null;
  r.ended = true; __run = null;
  const event = { ts: Date.now(), kind: status === 'completed' ? 'completed' : 'final-failure', detail: __clip(String(detail || ''), 600) };
  if (step) event.step = step;
  try { return (await __request('WIDGET_RUN_EVENT', { runId: r.id, event }, 15000)).narrative || null; } catch (e) { return null; }
};

__api.helpers = __H;
__api.addBranch = (step, b) => {
  if (!b || typeof b.run !== 'function' || !b.id) throw new Error('addBranch(step, {id, when, run}) requires id and run');
  (__LEARNED[step] = __LEARNED[step] || []).push({ id: String(b.id), when: String(b.when || ''), run: b.run, learned: true });
};

__api.step = async (name, spec) => {
  if (!spec || typeof spec.run !== 'function') throw new Error('WidgetAI.step(name, {run, expect}) requires run');
  const run = __ensureRun();
  // the caller's state object is the run state (mutations between steps are kept); spec.state overrides explicitly
  if (spec.state && typeof spec.state === 'object') __adopt(run, spec.state);
  const branches = [...(spec.branches || []), ...(__LEARNED[name] || [])].filter(b => b && b.id && typeof b.run === 'function');
  const info = branches.map(b => ({ id: String(b.id).slice(0, 80), when: String(b.when || '').slice(0, 300) }));
  const timeoutMs = spec.timeoutMs ?? 6000;
  const expected = __describe(spec.expect);
  __act('step ' + name);
  __ev('step-start', name, spec.goal);
  const ctx = { t0: Date.now(), before: __snapshot(spec.expect) };
  const exec = async (fn) => {
    try {
      const arg = __clone(run.state);
      const out = await fn(arg, __H);
      __adopt(run, out === undefined ? arg : out); // returning nothing keeps in-place mutations of the argument
      return null;
    } catch (e) { return String((e && e.message) || e).slice(0, 1000); }
  };
  let error = null, observed;
  if (!spec.multiOutcome) {
    error = await exec(spec.run);
    const r = await __waitExpect(spec.expect, ctx, error ? Math.min(1500, timeoutMs) : timeoutMs);
    if (r.ok) { __ev('step-ok', name, r.observed); return run.state; }
    observed = r.observed;
  } else {
    observed = 'multi-outcome step: pick the path that matches the current page (or "primary")';
  }
  const tried = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const dom = __skeleton(spec.region);
    if (!spec.multiOutcome || attempt > 1) __ev('expect-fail', name, null, { expected, observed, error: error || undefined, dom: __clip(dom, 1500), attempt });
    if (attempt > 1 || !spec.multiOutcome) {
      // re-check the postcondition before re-acting (avoid duplicate drafts)
      const re = await __checkOnce(spec.expect, run.state, ctx);
      if (re.ok) { __ev('recheck-ok', name, re.observed); __ev('step-ok', name, 'postcondition met on re-check'); return run.state; }
    }
    const stateJson = __clip(run.state, __AL.STATE_CHARS);
    const report = {
      runId: run.id, step: String(name).slice(0, 120), goal: __clip(String(spec.goal || name), 1000), expected: __clip(expected, 1000),
      observed: __clip(observed, 2000), attempt, multiOutcome: !!spec.multiOutcome, branches: info, tried: tried.slice(0, 10),
      lastActions: __actions.slice(-12), dom, url: location.href.slice(0, 2000),
      state: stateJson.length < __AL.STATE_CHARS ? run.state : { truncated: true },
    };
    if (error) report.error = __clip(error, 2000);
    let act;
    try { act = await __request('WIDGET_ASSIST', { report }, 420000); }
    catch (e) { act = { action: 'stop', source: 'cap', reason: 'assist unavailable: ' + (e && e.message || e) }; }
    if (act.action === 'stop') {
      run.failed = true;
      const narrative = await __finish('failed', name, act.reason);
      __showReport('Widget "' + WIDGET_META.name + '" stopped at step "' + name + '"', narrative || act.reason);
      throw new __StepFailed(name, act.reason, narrative);
    }
    let branchId = act.branchId || '?';
    tried.push(branchId);
    error = null;
    const ctx2 = { t0: Date.now(), before: ctx.before }; // textChanged keeps the pre-step baseline
    if (act.action === 'branch') {
      const b = branchId === 'primary' ? { run: spec.run } : branches.find(x => String(x.id) === branchId);
      __ev('branch-run', name, b && b.when, { branchId, source: branchId === 'primary' ? 'primary' : (b && b.learned ? 'learned' : 'pre-generated') });
      error = b ? await exec(b.run) : 'unknown branch ' + branchId;
    } else {
      const res = act.result || { ok: false, error: 'no result' };
      if (res.ok && res.state !== undefined) __adopt(run, res.state);
      if (!res.ok) error = res.error || 'branch failed';
    }
    const r2 = await __waitExpect(spec.expect, ctx2, error ? Math.min(1500, timeoutMs) : timeoutMs);
    __ev('branch-result', name, null, { branchId, ok: r2.ok, source: act.action === 'new' ? act.source : 'pre-generated', observed: r2.ok ? undefined : r2.observed, error: error || undefined });
    if (r2.ok) { __ev('step-ok', name, 'via branch ' + branchId); return run.state; }
    observed = r2.observed;
  }
  run.failed = true;
  const narrative = await __finish('failed', name, 'recovery loop exhausted');
  __showReport('Widget "' + WIDGET_META.name + '" stopped at step "' + name + '"', narrative || 'recovery loop exhausted');
  throw new __StepFailed(name, 'recovery loop exhausted', narrative);
};

__api.run = async (goal, fn, opts) => {
  opts = opts || {};
  if (__run && !__run.ended) await __finish('completed', null, 'superseded by a new run');
  __run = null;
  const r = __ensureRun(goal);
  if (opts.state !== undefined) __adopt(r, opts.state);
  const timeoutMs = Math.min(opts.timeoutMs || __AL.RUN_TIMEOUT_MS, __AL.RUN_TIMEOUT_MS);
  let timer;
  try {
    const out = await Promise.race([
      Promise.resolve().then(() => fn(r.state, __H)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('run timed out after ' + Math.round(timeoutMs / 1000) + ' s')), timeoutMs); }),
    ]);
    if (out !== undefined) __adopt(r, out);
    await __finish('completed', null, opts.summary ? opts.summary(r.state) : 'all steps passed');
    return { ok: true, state: r.state };
  } catch (e) {
    let narrative = e && e.narrative;
    if (!(e instanceof __StepFailed)) {
      narrative = await __finish('failed', null, String((e && e.message) || e));
      __showReport('Widget "' + WIDGET_META.name + '" failed', narrative || String((e && e.message) || e));
    }
    return { ok: false, state: r.state, error: String((e && e.message) || e), narrative: narrative || undefined };
  } finally { clearTimeout(timer); }
};

// WidgetAI.status ends an implicit run (steps called outside WidgetAI.run).
{
  const __origStatus = __api.status;
  __api.status = (status, detail) => {
    if (__run && !__run.ended && (status === 'completed' || status === 'failed') && !__run.failed) void __finish(status, null, detail);
    return __origStatus(status, detail);
  };
}

// ---------- danger guard ----------
const __dangerOf = (labels) => {
  for (const raw of labels) {
    if (!raw) continue;
    const t = String(raw).replace(/\\s+/g, ' ').trim().slice(0, 200);
    if (!t || t.length > 60 || __SAFE_RE.test(t)) continue;
    const m = t.match(__DANGER_RE);
    if (m) return { dangerous: true, matched: m[0], reason: 'control "' + t + '" looks consequential ("' + m[0] + '")' };
  }
  return { dangerous: false };
};
const __netDanger = (method, url) => {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'DELETE') return { dangerous: true, matched: 'DELETE', reason: 'DELETE ' + url };
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { dangerous: false };
  let p = String(url || ''); try { const u = new URL(p, location.href); p = u.pathname + u.search; } catch (e) {}
  const r = p.match(__ROUTE_RE);
  return r ? { dangerous: true, matched: r[2], reason: m + ' to send-like route ' + p } : { dangerous: false };
};
/** In-page Allow / Block confirm. Only TRUSTED (real user) clicks count — page scripts cannot press Allow. */
const __confirmDanger = (what, label, reason) => new Promise((resolve) => {
  const host = document.createElement('div');
  host.id = 'wwa-danger-' + Math.random().toString(36).slice(2, 7);
  host.setAttribute('data-testid', 'wwa-danger-confirm');
  host.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.b{background:#fff;border:2px solid #d93025;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);padding:12px 14px;font:13px/1.4 system-ui,arial;color:#202124;max-width:440px}.t{font-weight:600;color:#d93025;margin-bottom:4px}button{font:13px arial;padding:5px 12px;margin:8px 6px 0 0;border-radius:4px;border:1px solid #dadce0;cursor:pointer}#allow{background:#d93025;color:#fff;border-color:#d93025}</style>'
    + '<div class="b"><div class="t">Widget wants to ' + what + ' a consequential control</div><div id="m"></div><button id="block" data-testid="danger-block">Block</button><button id="allow" data-testid="danger-allow">Allow</button></div>';
  root.getElementById('m').textContent = '"' + WIDGET_META.name + '" → ' + label + ' — ' + reason;
  let done = false;
  const finish = (ok) => { if (done) return; done = true; host.remove(); resolve(ok); };
  root.getElementById('allow').addEventListener('click', (e) => { if (e.isTrusted) finish(true); });
  root.getElementById('block').addEventListener('click', (e) => { if (e.isTrusted) finish(false); });
  setTimeout(() => finish(false), 120000);
  document.documentElement.appendChild(host);
});

{
  const g = globalThis;
  // one listener per world; re-runs of the widget swap in the newest prelude's hooks
  g.__wwaGuardHooks = { ev: __ev, act: __act, dangerOf: __dangerOf, confirm: __confirmDanger };
  if (!g.__wwaGuardInstalled && typeof window !== 'undefined' && window.addEventListener) {
    g.__wwaGuardInstalled = true;
    const allowOnce = new WeakSet();
    const CONTROL = 'button,[role="button"],[role="link"],[role="menuitem"],a,input[type="submit"],input[type="button"],[aria-label]';
    let lastConfirm = null;
    const labelsOf = (el) => el ? [el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('title'), el.value, el.textContent] : [];
    const handler = (e) => {
      if (e.isTrusted) return;
      const H = g.__wwaGuardHooks;
      const path = e.composedPath ? e.composedPath() : [e.target];
      if (path.some(n => n && n.id && String(n.id).indexOf('wwa-') === 0)) return; // the widget's own UI
      const t0 = path[0] && path[0].nodeType === 1 ? path[0] : (e.target && e.target.nodeType === 1 ? e.target : null);
      if (!t0) return;
      let control, what;
      if (e.type === 'submit') { control = e.submitter || t0; what = 'submit'; }
      else if (e.type === 'keydown') { if (e.key !== 'Enter') return; control = t0; what = 'press Enter on'; }
      else { control = (t0.closest && t0.closest(CONTROL)) || t0; what = 'click'; }
      const lbl = (labelsOf(control).find(x => x && String(x).trim()) || control.tagName || '').toString().replace(/\\s+/g, ' ').trim().slice(0, 80);
      if (e.type === 'click' || e.type === 'keydown') H.act(what + ' ' + control.tagName.toLowerCase() + ' "' + lbl + '"');
      const labels = labelsOf(control);
      if (e.type === 'submit') { const f = e.target; if (f && f.getAttribute) labels.push(f.getAttribute('aria-label'), f.getAttribute('name')); }
      const v = H.dangerOf(labels);
      if (!v.dangerous) return;
      const key = e.type === 'submit' ? e.target : control;
      if (allowOnce.has(key)) { if (e.type === 'click' || e.type === 'submit' || e.type === 'keydown') allowOnce.delete(key); return; }
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
      if (!['click', 'submit', 'keydown'].includes(e.type)) return; // pointer/mouse down/up: blocked silently
      if (lastConfirm === key) return;
      lastConfirm = key;
      H.ev('danger-blocked', null, v.reason, { what: e.type === 'keydown' ? 'Enter' : e.type, label: lbl, reason: v.reason, matched: v.matched });
      void H.confirm(what, '"' + lbl + '"', v.reason).then((ok) => {
        lastConfirm = null;
        if (!ok) return;
        H.ev('danger-allowed', null, v.reason, { what: e.type, label: lbl });
        allowOnce.add(key);
        if (e.type === 'submit') { const f = e.target; try { f.requestSubmit(e.submitter || undefined); } catch (err) {} }
        else if (e.type === 'keydown') control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        else {
          for (const t of ['mousedown', 'mouseup']) { allowOnce.add(control); control.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, composed: true })); }
          allowOnce.add(control);
          control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        }
      });
    };
    for (const t of ['click', 'submit', 'keydown', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) window.addEventListener(t, handler, true);
  }
}

if (__api.net) {
  const __inv = __api.net.invoke, __req = __api.net.request;
  const guard = async (method, url, how) => {
    const v = __netDanger(method, url);
    if (!v.dangerous) return;
    __ev('danger-blocked', null, v.reason, { what: 'net', label: String(method || 'GET').toUpperCase() + ' ' + __clip(url, 120), reason: v.reason, pending: true });
    const ok = await __confirmDanger('send a request to', String(method || '').toUpperCase() + ' ' + __clip(url, 120), v.reason + ' (' + how + ')');
    if (!ok) throw new Error('blocked by danger guard: ' + v.reason);
    __ev('danger-allowed', null, v.reason, { what: 'net', label: String(method || '').toUpperCase() + ' ' + __clip(url, 120) });
  };
  __api.net.request = async (req) => { await guard((req && req.method) || 'GET', req && req.url, 'WidgetAI.net.request'); return __req(req); };
  __api.net.invoke = async (opId, overrides) => {
    let op = null;
    try { op = ((await __request('WIDGET_NET_OPS', {})).operations || []).find(o => o.id === opId) || null; } catch (e) {}
    const method = (overrides && overrides.method) || (op && op.method) || 'POST';
    const url = (overrides && overrides.url) || (op && (op.url || op.path)) || String(opId);
    await guard(method, url, 'WidgetAI.net.invoke');
    return __inv(opId, overrides);
  };
}
`;
