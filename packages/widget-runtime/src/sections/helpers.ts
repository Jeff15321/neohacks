/**
 * Helper library `h` handed to every step/branch as `(state, h)` — the SAME source is used inside the widget prelude
 * and inside agent-written branches executed by the SW in the widget's worldId (so learned branches behave identically).
 * Owner: Phase C. Expression source (evaluates to the helper object).
 */
export const HELPERS_SRC = `(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const visible = (el) => !!el && el.isConnected !== false && !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length));
  const waitFor = async (fn, timeout = 6000, every = 120) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; await sleep(every); }
    return null;
  };
  const label = (el) => !el ? '' : String((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || el.value || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const CONTROL = 'button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="option"],a,input[type="button"],input[type="submit"],[tabindex],[aria-label]';
  const toRe = (re) => typeof re === 'string' ? new RegExp(re, 'i') : re;
  const findByText = (re, root) => {
    re = toRe(re);
    const c = [...(root || document).querySelectorAll(CONTROL)].filter(e => !(e.closest && e.closest('[id^="wwa-"]')) && visible(e)
      && (re.test(e.getAttribute('aria-label') || '') || re.test((e.textContent || '').trim())));
    c.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return c[0] || null;
  };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const click = (el) => {
    if (!el) throw new Error('click: element not found');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return true;
  };
  const typeText = (el, text) => {
    if (!el) throw new Error('typeText: element not found');
    el.focus();
    if (el.isContentEditable) el.innerText = text; else el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  };
  const text = (sel, root) => (((root || document).querySelector(sel) || {}).textContent || '').trim();
  return Object.freeze({ sleep, waitFor, visible, label, findByText, $, $$, click, typeText, text });
})()`;

/**
 * Source executed by the SW via userScripts.execute in the widget's worldId for an agent-written branch.
 * State is explicit JSON in → JSON out (never shared globals). Always resolves to {ok, state?, error?}
 * (spike: userScripts.execute swallows rejections as `result: null`).
 */
export function buildBranchSource(code: string, state: unknown): string {
  return `(async () => {
  const h = ${HELPERS_SRC};
  const __in = ${JSON.stringify(state === undefined ? {} : state)};
  try {
    const out = await (async (state, h) => {
${code}
    })(__in, h);
    return { ok: true, state: out === undefined ? __in : JSON.parse(JSON.stringify(out)) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 1000) };
  }
})()`;
}
