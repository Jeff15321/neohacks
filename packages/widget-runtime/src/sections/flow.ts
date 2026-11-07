/**
 * Prelude section — owner: Phase F (doc §5). WidgetAI.flow (grant "flow").
 *  Home part:  WidgetAI.flow.call(role, handler, input, {openUrl?, reuseTab=true, activate=true, timeoutMs?}) → result
 *              (FLOW_CALL starts a durable run in the SW coordinator; FLOW_WAIT long-polls it, so the home promise
 *              survives SW suspension). Rejects with the run's failure reason (tab closed, timeout, cancelled…).
 *  Sink part:  WidgetAI.flow.handle(handler, async (input, ctx) => ({ok, evidence:{url|id|text}}))
 *              ctx.checkpoint(state) (before navigating), ctx.resumeState, ctx.cancelled(), ctx.runId.
 *              The SW bakes FLOW_INVOCATION into this prelude (userScripts.execute), so the sink needs no inbound channel.
 */
export interface FlowInvocation { runId: string; handler: string; input: unknown; resumeState?: unknown; activate?: boolean; homeName?: string; n?: number }

export const flowSection = (inv?: FlowInvocation | null): string => `
const __FLOW_INV = ${JSON.stringify(inv ?? null)};
const __flowClone = (v, what) => {
  if (v === undefined) return null;
  try { const s = JSON.stringify(v); if (s && s.length > 64000) throw new Error('too large'); return s === undefined ? null : JSON.parse(s); }
  catch (e) { throw new Error('WidgetAI.flow: ' + what + ' must be JSON-serialisable (' + (e && e.message || e) + ')'); }
};
const __flowPill = (text) => {
  try {
    let host = document.getElementById('wwa-flow-pill');
    if (!host) {
      host = document.createElement('div'); host.id = 'wwa-flow-pill'; host.setAttribute('data-testid', 'wwa-flow-pill');
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#1a73e8;color:#fff;font:12px/1.3 system-ui,arial;padding:6px 12px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.25);pointer-events:none';
      document.documentElement.appendChild(host);
    }
    host.textContent = text;
  } catch (e) {}
};
const __flowPillOff = () => { try { const h = document.getElementById('wwa-flow-pill'); if (h) h.remove(); } catch (e) {} };
__api.flow = Object.freeze({
  /** Home part: run handler of part role on its site; resolves with the sink's verified result. */
  call: async (role, handler, input, opts = {}) => {
    __need('flow');
    if (typeof role !== 'string' || typeof handler !== 'string') throw new Error('WidgetAI.flow.call(role, handler, input, opts): role and handler must be strings');
    const o = opts || {};
    const send = { openUrl: typeof o.openUrl === 'string' ? o.openUrl : undefined, reuseTab: o.reuseTab !== false, activate: o.activate !== false,
      timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : undefined };
    const { runId } = await __request('FLOW_CALL', { role, handler, input: __flowClone(input, 'input'), opts: send });
    if (typeof o.onRun === 'function') { try { o.onRun(runId); } catch (e) {} }
    let transportErrors = 0;
    for (;;) {
      let w;
      try { w = await __request('FLOW_WAIT', { runId }, 60000); transportErrors = 0; }
      catch (e) {
        // SW restarted mid-wait: the run is durable (storage.session) → ask again
        if (++transportErrors < 20 && /^platform request timed out$|Receiving end does not exist|message port closed/i.test(String(e && e.message))) { await new Promise(r => setTimeout(r, 300)); continue; }
        throw e;
      }
      if (w.done) {
        if (w.success) return w.result;
        const err = new Error(w.reason || ('flow ' + w.status)); err.runId = runId; err.status = w.status; throw err;
      }
    }
  },
  /** Home part (or panel): cancel a run. The sink's next platform call rejects. */
  cancel: async (runId) => { __need('flow'); await __request('FLOW_CANCEL', { runId: String(runId) }); },
  /** Sink part: register a handler. Runs only when the coordinator invoked this part for that handler. */
  handle: (handler, fn) => {
    __need('flow');
    const inv = __FLOW_INV;
    if (!inv || inv.handler !== handler || typeof fn !== 'function') return false;
    const key = inv.runId + ':' + (inv.n || 0);
    if (globalThis.__wwaFlowHandled === key) return false;
    globalThis.__wwaFlowHandled = key;
    const runId = inv.runId;
    const ctx = Object.freeze({
      runId,
      resumeState: inv.resumeState === undefined ? null : inv.resumeState,
      checkpoint: async (state) => { await __request('FLOW_CHECKPOINT', { runId, state: __flowClone(state, 'checkpoint state') }); },
      cancelled: async () => { try { return !!(await __request('FLOW_STATUS', { runId })).cancelled; } catch (e) { return true; } },
    });
    if (inv.activate !== false) __flowPill('Widget AI: running "' + (inv.homeName || WIDGET_META.name) + '" (' + handler + ')…');
    Promise.resolve()
      .then(() => fn(__flowClone(inv.input, 'input'), ctx))
      .then((result) => __request('FLOW_RESULT', { runId, ok: true, result: __flowClone(result, 'result') }),
            (err) => __request('FLOW_RESULT', { runId, ok: false, error: String((err && err.message) || err).slice(0, 500) }))
      .catch(() => {})
      .finally(__flowPillOff);
    return true;
  },
  invocation: __FLOW_INV ? Object.freeze({ runId: __FLOW_INV.runId, handler: __FLOW_INV.handler }) : null,
});
`;
