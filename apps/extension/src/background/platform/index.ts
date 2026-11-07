/**
 * Thin wrappers over chrome.* — the ONLY place in the background that touches chrome APIs, so modules can be
 * tested with fakes. Add wrappers here (alarms, commands, action badge…) instead of calling chrome.* in modules.
 */
import type { SWToContent, WebRequestSeen } from '@app/contracts';
import { matchesAny } from '@app/core';

declare const BACKEND_URL: string;
declare const EXTENSION_TOKEN: string;
export const BACKEND = typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : 'http://127.0.0.1:8787';
const TOKEN = typeof EXTENSION_TOKEN !== 'undefined' ? EXTENSION_TOKEN : 'dev-token-change-me';

export const runtime = {
  id: () => chrome.runtime.id,
  isExtensionPage: (s: chrome.runtime.MessageSender) => s.id === chrome.runtime.id && !!s.url?.startsWith(chrome.runtime.getURL('')),
  onMessage: (fn: (raw: unknown, sender: chrome.runtime.MessageSender, respond: (r: unknown) => void) => boolean | void) =>
    chrome.runtime.onMessage.addListener(fn),
  onUserScriptMessage: (fn: (raw: unknown, sender: chrome.runtime.MessageSender, respond: (r: unknown) => void) => boolean | void) =>
    (chrome.runtime as any).onUserScriptMessage?.addListener(fn),
  broadcast: (msg: unknown) => { chrome.runtime.sendMessage(msg).catch(() => { /* no panel open */ }); },
  onStartup: (fn: () => void) => { chrome.runtime.onStartup?.addListener(fn); chrome.runtime.onInstalled.addListener(fn); },
};

export const tabs = {
  /** Active http(s) tab (optionally matching patterns), else any matching tab. */
  async findTarget(matchPatterns?: string[]): Promise<chrome.tabs.Tab | null> {
    const ok = (t?: chrome.tabs.Tab) => !!t?.url && /^https?:/.test(t.url) && (!matchPatterns || matchesAny(matchPatterns, t.url));
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (ok(active)) return active;
    const all = await chrome.tabs.query({});
    return all.find(t => ok(t)) ?? null;
  },
  get: (tabId: number) => chrome.tabs.get(tabId),
  /** Send to the tab's content script; defaults to the top frame. */
  send: <R = unknown>(tabId: number, msg: SWToContent, frameId = 0): Promise<R> => chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<R>,
  onRemoved: (fn: (tabId: number) => void) => chrome.tabs.onRemoved.addListener(fn),
};

export const userScripts = {
  available: () => typeof chrome.userScripts !== 'undefined',
  configureWorld: async (worldId?: string) => {
    try { await chrome.userScripts.configureWorld(worldId ? { worldId, messaging: true } : { messaging: true }); }
    catch (e) { console.warn('[wwa] userScripts unavailable (Allow User Scripts toggle off?):', e); }
  },
  execute: (tabId: number, code: string, worldId: string) =>
    chrome.userScripts.execute({ target: { tabId }, js: [{ code }], world: 'USER_SCRIPT', worldId, injectImmediately: true }),
  /** Replace ALL registrations with `regs`. */
  async replaceAll(regs: Array<{ id: string; matches: string[]; code: string }>) {
    await chrome.userScripts.unregister();
    if (regs.length) {
      await chrome.userScripts.register(regs.map(r => ({ id: r.id, matches: r.matches, js: [{ code: r.code }], runAt: 'document_idle' as const, world: 'USER_SCRIPT' as const, worldId: r.id })));
    }
  },
};

export const storage = {
  local: {
    get: async <T>(key: string): Promise<T | undefined> => (await chrome.storage.local.get(key))[key] as T | undefined,
    set: (key: string, value: unknown) => chrome.storage.local.set({ [key]: value }),
    remove: (key: string) => chrome.storage.local.remove(key),
  },
  session: {
    get: async <T>(key: string): Promise<T | undefined> => { try { return (await chrome.storage.session.get(key))[key] as T | undefined; } catch { return undefined; } },
    set: (key: string, value: unknown) => chrome.storage.session.set({ [key]: value }).catch(() => {}),
    remove: (key: string) => chrome.storage.session.remove(key).catch(() => {}),
  },
};

export const webRequest = {
  /** Observe-only completions (MV3), unforgeable by pages: the integrity cross-check for probe records. */
  onCompleted(fn: (tabId: number, w: WebRequestSeen) => void) {
    if (!chrome.webRequest?.onCompleted) return;
    chrome.webRequest.onCompleted.addListener(
      (d) => { if (d.tabId >= 0) fn(d.tabId, { url: d.url, method: d.method, ts: d.timeStamp, statusCode: d.statusCode }); },
      { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'ping', 'other'] },
    );
  },
};

/** Stable per-install id, sent as `x-user-id` (hackathon-grade identity). */
let installIdP: Promise<string> | null = null;
export const installId = () => (installIdP ??= (async () => {
  const k = 'wwa_install_id';
  const v = await storage.local.get<string>(k);
  if (v) return v;
  const id = crypto.randomUUID();
  await storage.local.set(k, id);
  return id;
})());

export const backend = {
  url: BACKEND,
  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, traceId?: string): Promise<T> {
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: {
        'content-type': 'application/json', 'x-extension-token': TOKEN, 'x-user-id': await installId(),
        ...(traceId ? { 'x-trace-id': traceId } : {}),
      },
      body: method === 'GET' || method === 'DELETE' || body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok && !(res.status === 422 && 'ok' in json)) throw new Error(json?.error ?? `backend ${res.status}`);
    return json as T;
  },
  post: <T>(path: string, body: unknown, traceId?: string) => backend.request<T>('POST', path, body, traceId),
  get: <T>(path: string, traceId?: string) => backend.request<T>('GET', path, undefined, traceId),
  health: async (): Promise<{ status: 'ok' | 'down' | 'unauthorized'; provider?: string }> => {
    try {
      const r = await fetch(`${BACKEND}/health`);
      if (!r.ok) return { status: 'unauthorized' };
      return { status: 'ok', provider: (await r.json())?.provider };
    } catch { return { status: 'down' }; }
  },
};
