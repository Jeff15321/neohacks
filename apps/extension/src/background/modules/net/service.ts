import type { InvokeRequestSpec, NetInvokeOverrides, NetInvokeResult, NetRequestRecord } from '@app/contracts';
import { NetLog, buildDirectRequest, buildInvokeRequest, randomId, sameOrigin } from '@app/core';
import { storage, tabs } from '../../platform/index.js';

/** storage.session keys owned by modules/net. */
const netKey = (tabId: number) => `wwa_net_${tabId}`;

/**
 * Per-tab network observation state (ported from MVP sw.ts + netlog.ts), hydrated from storage.session so
 * service-worker restarts don't lose recent captures. Adds the webRequest integrity cross-check (doc §4 1b).
 */
export class NetService {
  readonly log = new NetLog();
  readonly probeAlive = new Map<number, number>();
  private hydrated = new Set<number>();
  private persistTimers = new Map<number, ReturnType<typeof setTimeout>>();

  async hydrate(tabId: number) {
    if (this.hydrated.has(tabId)) return;
    this.hydrated.add(tabId);
    const records = await storage.session.get<NetRequestRecord[]>(netKey(tabId));
    if (Array.isArray(records)) this.log.hydrate(tabId, records);
  }

  schedulePersist(tabId: number) {
    if (this.persistTimers.has(tabId)) return;
    this.persistTimers.set(tabId, setTimeout(() => {
      this.persistTimers.delete(tabId);
      void storage.session.set(netKey(tabId), this.log.all(tabId));
    }, 800));
  }

  clearTab(tabId: number) {
    this.log.clearTab(tabId);
    this.probeAlive.delete(tabId);
    this.hydrated.delete(tabId);
    void storage.session.remove(netKey(tabId));
  }

  /** Relay a fetch-shaped request to the MAIN-world probe (top frame) via the content script. */
  async pageFetch(tabId: number, request: InvokeRequestSpec): Promise<NetInvokeResult> {
    let resp: { ok?: boolean; result?: NetInvokeResult; error?: string } | undefined;
    try {
      resp = await tabs.send(tabId, { type: 'WWA_NET_INVOKE', invokeId: randomId('i', 8), request }, 0);
    } catch (e) {
      throw new Error(`page bridge unavailable — reload the tab (${String((e as Error)?.message ?? e)})`);
    }
    if (!resp?.ok) throw new Error(resp?.error ?? 'netprobe invoke failed');
    return resp.result ?? { ok: false, error: 'empty netprobe response' };
  }

  /** Replay a captured op. Only webRequest-confirmed records are replayable; same-origin only. */
  async replay(tabId: number, tabUrl: string, opId: string, overrides: NetInvokeOverrides = {}) {
    await this.hydrate(tabId);
    const record = this.log.recordById(tabId, opId);
    if (!record) throw new Error(`captured operation ${opId} not found on this tab (tab may have navigated)`);
    if (!record.confirmed) throw new Error(`operation ${opId} is unconfirmed (no matching browser-level request was seen) — not replayable`);
    const spec = buildInvokeRequest(record, overrides);
    if (!sameOrigin(spec.url, tabUrl)) throw new Error('replay restricted to the page origin');
    return this.pageFetch(tabId, spec);
  }

  async direct(tabId: number, tabUrl: string, req: Parameters<typeof buildDirectRequest>[0]) {
    const spec = buildDirectRequest(req, tabUrl);
    if (!sameOrigin(spec.url, tabUrl)) throw new Error('requests restricted to the page origin');
    return this.pageFetch(tabId, spec);
  }
}
