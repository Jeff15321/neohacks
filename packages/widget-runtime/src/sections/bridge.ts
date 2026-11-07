/**
 * Messaging bridge (ported from MVP widgetSource.ts): user script → SW over
 * chrome.runtime.sendMessage (USER_SCRIPT world with messaging:true → onUserScriptMessage).
 * Defines: __WID, __GRANTS, __TRACE, WIDGET_META, __send, __request, __need, __api.
 */
export const bridgeSection = (o: { id: string; name: string; version: number; grants: string[]; traceId: string }) => `
const __WID = ${JSON.stringify(o.id)};
const __GRANTS = ${JSON.stringify(o.grants)};
const __TRACE = ${JSON.stringify(o.traceId)};
const WIDGET_META = { id: __WID, name: ${JSON.stringify(o.name)}, version: ${JSON.stringify(o.version)}, traceId: __TRACE };
const __send = (msg) => { try { chrome.runtime.sendMessage({ ...msg, widgetId: __WID, traceId: __TRACE }); } catch (e) {} };
const __request = (type, payload, timeoutMs = 120000) => new Promise((resolve, reject) => {
  const requestId = Math.random().toString(36).slice(2);
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('platform request timed out')); } }, timeoutMs);
  chrome.runtime.sendMessage({ ...payload, type, widgetId: __WID, requestId, traceId: __TRACE }, (resp) => {
    if (settled) return; settled = true; clearTimeout(timer);
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!resp) return reject(new Error('empty platform response'));
    if (resp.ok === false) return reject(new Error(resp.error || 'platform error'));
    resolve(resp);
  });
});
const __need = (grant) => { if (!__GRANTS.includes(grant)) throw new Error('grant "' + grant + '" not declared in widget metadata'); };
const __api = {};
`;
