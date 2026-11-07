import type { WidgetRecord } from '@app/shared';

/**
 * Builds the JavaScript source injected via chrome.userScripts.execute().
 * Structure:
 *   (async () => {
 *     <WidgetAI prelude — messaging bridge to the service worker>
 *     const WIDGET_META = {...}
 *     <generated widget code>
 *   })().catch(err => report failed)
 */
export function buildWidgetSource(w: WidgetRecord): string {
  const prelude = `const __WID = ${JSON.stringify(w.id)};
const __GRANTS = ${JSON.stringify(w.grants)};
const WIDGET_META = { id: __WID, name: ${JSON.stringify(w.name)}, version: ${JSON.stringify(w.version)} };
const __send = (msg) => { try { chrome.runtime.sendMessage({ widgetId: __WID, ...msg }); } catch (e) {} };
const __request = (type, payload) => new Promise((resolve, reject) => {
  const requestId = Math.random().toString(36).slice(2);
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('platform request timed out')); } }, 120000);
  chrome.runtime.sendMessage({ ...payload, type, widgetId: __WID, requestId }, (resp) => {
    if (settled) return; settled = true; clearTimeout(timer);
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!resp) return reject(new Error('empty platform response'));
    if (resp.ok === false) return reject(new Error(resp.error || 'platform error'));
    resolve(resp);
  });
});
const WidgetAI = {
  inference: ({ prompt, context, instruction }) => {
    if (!__GRANTS.includes('inference')) return Promise.reject(new Error('grant "inference" not declared in widget metadata'));
    if (typeof prompt !== 'string' || !prompt.trim()) return Promise.reject(new Error('inference prompt must be a non-empty string'));
    return __request('WIDGET_INFERENCE', { prompt, context, instruction }).then(r => r.text);
  },
  log: (message, level) => __send({ type: 'WIDGET_LOG', level: level || 'info', message: String(message) }),
  status: (status, detail) => __send({ type: 'WIDGET_STATUS', status, detail }),
  storage: {
    get: (key) => __GRANTS.includes('storage') ? __request('WIDGET_STORAGE', { op: 'get', key }).then(r => r.value) : Promise.reject(new Error('grant "storage" not declared')),
    set: (key, value) => __GRANTS.includes('storage') ? __request('WIDGET_STORAGE', { op: 'set', key, value }).then(() => undefined) : Promise.reject(new Error('grant "storage" not declared')),
    remove: (key) => __GRANTS.includes('storage') ? __request('WIDGET_STORAGE', { op: 'remove', key }).then(() => undefined) : Promise.reject(new Error('grant "storage" not declared')),
  },
};
`;
  return `(async () => {
${prelude}
${w.code}
})().catch((err) => {
  try { chrome.runtime.sendMessage({ type: 'WIDGET_STATUS', widgetId: ${JSON.stringify(w.id)}, status: 'failed', detail: String(err && err.message || err) }); } catch (e) {}
  console.error('[widget ${w.id}]', err);
});`;
}

/** Cleanup snippet: remove DOM the widget added (roots use wwa- prefix ids). */
export function buildCleanupSource(widgetId: string): string {
  return `(() => { const n = document.querySelectorAll('[id^="wwa-"]'); n.forEach(e => e.remove()); return { removed: n.length }; })()`;
}
