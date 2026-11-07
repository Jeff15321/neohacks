/// <reference lib="webworker" />
import type {
  PanelToSW, SWToPanel, UserScriptMsg, UserScriptReply,
  WidgetRecord, PageContext, GenerateWidgetRequest, GenerateWidgetResponse,
  InferenceResponse, WidgetStatus,
} from '@app/shared';
import { buildWidgetSource, buildCleanupSource } from '../runtime/widgetSource.js';
import { matchesAny } from './matchPattern.js';

declare const BACKEND_URL: string;
declare const EXTENSION_TOKEN: string;
const BACKEND = typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : 'http://127.0.0.1:8787';
const TOKEN = typeof EXTENSION_TOKEN !== 'undefined' ? EXTENSION_TOKEN : 'dev-token-change-me';

const sw = self as unknown as ServiceWorkerGlobalScope;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const widgets = new Map<string, WidgetRecord>();
const STORAGE_KEY = 'wwa_widgets';

async function loadWidgets() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const list = (res[STORAGE_KEY] ?? []) as WidgetRecord[];
  for (const w of list) widgets.set(w.id, w);
}

/** Re-register stored widgets so their UI re-injects on page load. */
async function persistToUserScripts() {
  if (typeof chrome.userScripts === 'undefined') return;
  const regs = [...widgets.values()].map(w => ({
    id: w.id,
    matches: w.matchPatterns,
    js: [{ code: buildWidgetSource(w) }],
    runAt: 'document_idle' as const,
    world: 'USER_SCRIPT' as const,
    worldId: w.id,
  }));
  try {
    await chrome.userScripts.unregister();
    if (regs.length) await chrome.userScripts.register(regs);
    for (const w of widgets.values()) {
      await chrome.userScripts.configureWorld({ worldId: w.id, messaging: true });
    }
  } catch (e) { console.warn('[wwa] userscript re-register failed:', e); }
}
chrome.runtime.onStartup?.addListener(() => void loadReady.then(persistToUserScripts));
chrome.runtime.onInstalled.addListener(() => void loadReady.then(persistToUserScripts));
async function persistWidgets() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...widgets.values()] });
}
const loadReady = loadWidgets();
void loadReady.then(persistToUserScripts);

function setStatus(w: WidgetRecord, status: WidgetStatus, log?: string) {
  w.status = status;
  if (status === 'failed' && log) w.lastError = log;
  broadcast({ type: 'WIDGET_STATUS', widgetId: w.id, status, log });
  void persistWidgets();
}

function broadcast(msg: SWToPanel) {
  chrome.runtime.sendMessage(msg).catch(() => {/* no listeners */});
}

// ---------------------------------------------------------------------------
// userScripts world config — messaging enabled, per-widget worldId isolation
// ---------------------------------------------------------------------------
function configureWorlds() {
  try {
    chrome.userScripts.configureWorld({ messaging: true });
  } catch (e) {
    console.warn('[wwa] userScripts unavailable (toggle off?):', e);
  }
}
configureWorlds();
chrome.runtime.onInstalled.addListener(configureWorlds);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function findTargetTab(matchPatterns?: string[]): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.url && !active.url.startsWith('chrome') && /^https?:/.test(active.url)) {
    if (!matchPatterns || matchesAny(matchPatterns, active.url)) return active;
  }
  const all = await chrome.tabs.query({});
  return all.find(t => t.url && /^https?:/.test(t.url) && (!matchPatterns || matchesAny(matchPatterns, t.url))) ?? null;
}

async function getPageContext(tabId: number, fallback: chrome.tabs.Tab): Promise<PageContext> {
  try {
    const ctx = await chrome.tabs.sendMessage(tabId, { type: 'WWA_GET_CONTEXT' });
    if (ctx && ctx.url) return ctx as PageContext;
  } catch { /* content script absent (chrome://, pdf, etc.) */ }
  const url = new URL(fallback.url ?? 'http://unknown/');
  return {
    url: fallback.url ?? '', origin: url.origin, title: fallback.title ?? '',
    landmarks: [], insertionCandidates: [], textSample: '', interactive: [],
  };
}

async function backendFetch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-extension-token': TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? `backend ${res.status}`);
  return json as T;
}

// ---------------------------------------------------------------------------
// Panel message handling
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((raw: PanelToSW | SWToPanel, sender, sendResponse) => {
  // Ignore our own broadcasts looping back.
  if ((raw as SWToPanel).type && ['GENERATION_PROGRESS','WIDGET_GENERATED','WIDGET_STATUS','WIDGET_LIST','PAGE_CONTEXT','ERROR'].includes(raw.type)) return;
  const msg = raw as PanelToSW;
  void (async () => {
    await loadReady;
    try {
      switch (msg.type) {
        case 'GENERATE_WIDGET': {
          const tab = await findTargetTab();
          if (!tab?.id) throw new Error('no eligible web page tab found');
          broadcast({ type: 'GENERATION_PROGRESS', stage: 'context', detail: 'extracting page context' });
          const pageContext = await getPageContext(tab.id, tab);
          broadcast({ type: 'GENERATION_PROGRESS', stage: 'llm', detail: 'generating widget code' });
          const req: GenerateWidgetRequest = { request: msg.request, pageContext };
          const res = await backendFetch<GenerateWidgetResponse>('/api/generate-widget', req);
          if (!res.ok || !res.widget) throw new Error(res.error ?? 'generation failed');
          const w: WidgetRecord = {
            ...res.widget,
            id: `w_${Math.random().toString(36).slice(2, 10)}`,
            version: 1, createdAt: Date.now(),
            origin: pageContext.origin, status: 'ready',
            originalRequest: msg.request,
          };
          widgets.set(w.id, w);
          await persistWidgets();
          void persistToUserScripts();
          broadcast({ type: 'WIDGET_GENERATED', widget: w });
          if (res.warnings?.length) broadcast({ type: 'WIDGET_STATUS', widgetId: w.id, status: 'ready', log: 'warnings: ' + res.warnings.join('; ') });
          sendResponse({ ok: true, widget: w });
          break;
        }
        case 'RUN_WIDGET': {
          const w = widgets.get(msg.widgetId);
          if (!w) throw new Error('widget not found');
          const tab = await findTargetTab(w.matchPatterns);
          if (!tab?.id) throw new Error(`no tab matches ${w.matchPatterns.join(', ')}`);
          setStatus(w, 'running', 'injecting widget');
          await chrome.userScripts.configureWorld({ worldId: w.id, messaging: true });
          const results = await chrome.userScripts.execute({
            target: { tabId: tab.id },
            js: [{ code: buildWidgetSource(w) }],
            world: 'USER_SCRIPT',
            worldId: w.id,
            injectImmediately: true,
          });
          const r0 = results?.[0];
          if (r0?.error) { setStatus(w, 'failed', r0.error); sendResponse({ ok: false, error: r0.error }); }
          else sendResponse({ ok: true });
          break;
        }
        case 'REPAIR_WIDGET': {
          const w = widgets.get(msg.widgetId);
          if (!w) throw new Error('widget not found');
          const tab = await findTargetTab(w.matchPatterns);
          if (!tab?.id) throw new Error(`no tab matches ${w.matchPatterns.join(', ')}`);
          broadcast({ type: 'GENERATION_PROGRESS', stage: 'context', detail: 're-extracting context' });
          const pageContext = await getPageContext(tab.id, tab);
          broadcast({ type: 'GENERATION_PROGRESS', stage: 'llm', detail: 'repairing widget code' });
          const res = await backendFetch<GenerateWidgetResponse>('/api/generate-widget', {
            request: w.originalRequest ?? w.description,
            pageContext,
            prior: { code: w.code, error: w.lastError ?? 'widget failed at runtime' },
          } satisfies GenerateWidgetRequest);
          if (!res.ok || !res.widget) throw new Error(res.error ?? 'repair generation failed');
          const nw: WidgetRecord = {
            ...res.widget, id: w.id, version: w.version + 1,
            createdAt: w.createdAt, origin: w.origin, status: 'ready',
            originalRequest: w.originalRequest,
          };
          widgets.set(nw.id, nw);
          await persistWidgets();
          void persistToUserScripts();
          broadcast({ type: 'WIDGET_GENERATED', widget: nw });
          sendResponse({ ok: true, widget: nw });
          break;
        }
        case 'REMOVE_WIDGET': {
          const w = widgets.get(msg.widgetId);
          widgets.delete(msg.widgetId);
          await persistWidgets();
          void persistToUserScripts();
          try { await chrome.userScripts.unregister({ ids: [msg.widgetId] }); } catch {}
          if (w) {
            const tab = await findTargetTab(w.matchPatterns);
            if (tab?.id) {
              try {
                await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: buildCleanupSource(msg.widgetId) }], world: 'USER_SCRIPT', worldId: msg.widgetId, injectImmediately: true });
              } catch {}
            }
          }
          sendResponse({ ok: true });
          break;
        }
        case 'LIST_WIDGETS':
          sendResponse({ ok: true, widgets: [...widgets.values()] });
          break;
        case 'GET_PAGE_CONTEXT': {
          const tab = await findTargetTab();
          if (!tab?.id) throw new Error('no eligible tab');
          sendResponse({ ok: true, context: await getPageContext(tab.id, tab) });
          break;
        }
        case 'GET_HEALTH': {
          const info = {
            userScripts: typeof chrome.userScripts !== 'undefined',
            backend: await fetch(`${BACKEND}/health`).then(r => r.ok ? 'ok' : 'unauthorized').catch(() => 'down'),
            backendUrl: BACKEND,
            widgets: widgets.size,
          };
          sendResponse({ ok: true, health: info });
          break;
        }
        case 'PANEL_READY':
          sendResponse({ ok: true, widgets: [...widgets.values()] });
          break;
      }
    } catch (e: any) {
      broadcast({ type: 'ERROR', message: String(e?.message ?? e) });
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

// ---------------------------------------------------------------------------
// Generated-widget message handling (untrusted-ish context: validate origin)
// ---------------------------------------------------------------------------
chrome.runtime.onUserScriptMessage.addListener((raw: UserScriptMsg, sender, sendResponse) => {
  const msg = raw as UserScriptMsg;
  void (async () => {
    await loadReady;
    const w = widgets.get(msg.widgetId);
    const tabUrl = sender.tab?.url ?? sender.url ?? '';
    if (!w) { sendResponse({ ok: false, error: 'unknown widget' } satisfies UserScriptReply); return; }
    if (w.matchPatterns.length && !matchesAny(w.matchPatterns, tabUrl)) {
      sendResponse({ ok: false, error: `origin not allowed for widget (tab=${tabUrl})` } satisfies UserScriptReply); return;
    }
    try {
      switch (msg.type) {
        case 'WIDGET_INFERENCE': {
          if (!w.grants.includes('inference')) { sendResponse({ ok: false, error: 'inference not granted' }); return; }
          const res = await backendFetch<InferenceResponse>('/api/inference', {
            prompt: msg.prompt, context: msg.context, instruction: msg.instruction, widgetId: msg.widgetId,
          });
          sendResponse(res.ok ? { ok: true, text: res.text } : { ok: false, error: res.error ?? 'inference failed' } satisfies UserScriptReply);
          break;
        }
        case 'WIDGET_STORAGE': {
          if (!w.grants.includes('storage')) { sendResponse({ ok: false, error: 'storage not granted' }); return; }
          const nsKey = `wwa_store_${w.id}_${msg.key}`;
          if (msg.op === 'get') {
            const r = await chrome.storage.local.get(nsKey);
            sendResponse({ ok: true, value: r[nsKey] });
          } else if (msg.op === 'set') {
            await chrome.storage.local.set({ [nsKey]: msg.value });
            sendResponse({ ok: true });
          } else {
            await chrome.storage.local.remove(nsKey);
            sendResponse({ ok: true });
          }
          break;
        }
        case 'WIDGET_LOG':
          broadcast({ type: 'WIDGET_STATUS', widgetId: w.id, status: w.status, log: `[${msg.level}] ${msg.message}` });
          sendResponse({ ok: true });
          break;
        case 'WIDGET_STATUS':
          if (msg.status === 'running' || msg.status === 'completed' || msg.status === 'failed') {
            setStatus(w, msg.status as WidgetStatus, msg.detail);
          }
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e: any) {
      sendResponse({ ok: false, error: String(e?.message ?? e) } satisfies UserScriptReply);
    }
  })();
  return true;
});

// Side panel on action click.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

export {};
