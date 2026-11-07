import type { Bus, Ctx } from '../../bus.js';
import { tabs, webRequest } from '../../platform/index.js';
import { NetService } from './service.js';

const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

export function registerNet(bus: Bus) {
  const svc = new NetService();
  const enabled = () => bus.use('settings.get')().net;
  const needTab = (ctx: Ctx) => { if (ctx.tabId == null || !ctx.tabUrl) throw new Error('no sender tab'); return ctx.tabId; };

  tabs.onRemoved(tabId => svc.clearTab(tabId));
  webRequest.onCompleted((tabId, w) => { if (svc.log.addWebRequest(tabId, w)) svc.schedulePersist(tabId); });

  bus.provide('net.opsForTab', async (tabId, origin, limit = 12) => {
    if (!enabled()) return [];
    await svc.hydrate(tabId);
    return svc.log.ops(tabId, limit, origin);
  });

  // content script → SW (probe telemetry). sender.tab is authoritative, never the payload.
  bus.onPage('WWA_NET_RECORD', async (m, ctx) => {
    const tabId = needTab(ctx);
    if (!enabled()) return;
    await svc.hydrate(tabId);
    svc.log.addRecord(tabId, { ...m.record, frameId: ctx.frameId });
    svc.schedulePersist(tabId);
  });
  bus.onPage('WWA_GESTURE', (m, ctx) => { svc.log.addGesture(needTab(ctx), m.gesture); });
  bus.onPage('WWA_NET_HELLO', (_m, ctx) => { svc.probeAlive.set(needTab(ctx), Date.now()); });

  // panel → SW (Inspector)
  bus.on('GET_NET_OPS', async () => {
    const tab = await tabs.findTarget();
    if (!tab?.id || !tab.url) throw new Error('no eligible tab');
    await svc.hydrate(tab.id);
    const origin = originOf(tab.url);
    return {
      tabId: tab.id, ops: svc.log.ops(tab.id, 60, origin), probeAlive: svc.probeAlive.has(tab.id), enabled: enabled(),
      browserOnly: svc.log.browserOnly(tab.id, origin),
    };
  });
  bus.on('GET_NET_RECORDS', async () => {
    const tab = await tabs.findTarget();
    if (!tab?.id || !tab.url) throw new Error('no eligible tab');
    await svc.hydrate(tab.id);
    return { tabId: tab.id, records: svc.log.all(tab.id) };
  });
  bus.on('NET_REPLAY', async (m) => {
    const tab = await tabs.findTarget();
    if (!tab?.id || !tab.url) throw new Error('no eligible tab');
    return { result: await svc.replay(tab.id, tab.url, m.opId, m.overrides) };
  });

  // generated widget → SW (grant "network" enforced by the bus)
  bus.onUserScript('WIDGET_NET_OPS', async (_m, ctx) => {
    const tabId = needTab(ctx);
    await svc.hydrate(tabId);
    return { operations: enabled() ? svc.log.ops(tabId, 40, originOf(ctx.tabUrl)) : [] };
  }, 'network');
  bus.onUserScript('WIDGET_NET_INVOKE', async (m, ctx) => ({ result: await svc.replay(needTab(ctx), ctx.tabUrl, m.opId, m.overrides) }), 'network');
  bus.onUserScript('WIDGET_NET_REQUEST', async (m, ctx) => ({ result: await svc.direct(needTab(ctx), ctx.tabUrl, m.request) }), 'network');
  bus.onUserScript('WIDGET_NET_REPORT_VERIFIED', async (m, ctx) => {
    const tabId = needTab(ctx);
    await svc.hydrate(tabId);
    // never throws: widgets branch on {verified:false} (e.g. to their DOM fallback)
    const r = svc.reportVerified(tabId, m.opId, m.evidence);
    return { verified: r.ok, tier: r.tier, error: r.error };
  }, 'network');
  return svc;
}
