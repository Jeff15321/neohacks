import type { InvokeRequestSpec, NetInvokeOverrides, NetInvokeResult, NetRequestRecord, NetVerifyEvidence } from '@app/contracts';
import { NetLog, buildDirectRequest, buildInvokeRequest, randomId, sameOrigin, type TierState } from '@app/core';
import { storage, tabs } from '../../platform/index.js';

/** storage.session keys owned by modules/net. */
const netKey = (tabId: number) => `wwa_net_${tabId}`;
/** Verification tiers per op template (all tabs/origins). */
const TIERS_KEY = 'wwa_net_tiers';

/**
 * Per-tab network observation state (ported from MVP sw.ts + netlog.ts), hydrated from storage.session so
 * service-worker restarts don't lose recent captures. Adds the webRequest integrity cross-check (doc §4 1b).
 */
export class NetService {
  readonly log = new NetLog();
  readonly probeAlive = new Map<number, number>();
  private hydrated = new Set<number>();
  private persistTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private tiersHydrated = false;

  async hydrate(tabId: number) {
    if (!this.tiersHydrated) {
      this.tiersHydrated = true;
      const t = await storage.session.get<Array<[string, TierState]>>(TIERS_KEY);
      if (Array.isArray(t)) this.log.hydrateTiers(t);
    }
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
    const result = await this.pageFetch(tabId, spec);
    // tier promotion (doc §4 item 4): only when the replay targeted the op's own template (no url/method override)
    if (overrides.url === undefined && overrides.method === undefined) {
      const before = this.log.tierOf(this.log.templateKeyOf(tabId, opId) ?? '').tier;
      if (this.log.noteReplay(tabId, opId, result) !== before) this.persistTiers();
    }
    return result;
  }

  reportVerified(tabId: number, opId: string, evidence: NetVerifyEvidence) {
    const r = this.log.reportVerified(tabId, opId, evidence);
    if (r.ok) this.persistTiers();
    return r;
  }

  private persistTiers() { void storage.session.set(TIERS_KEY, this.log.tierSnapshot()); }

  async direct(tabId: number, tabUrl: string, req: Parameters<typeof buildDirectRequest>[0]) {
    const spec = buildDirectRequest(req, tabUrl);
    if (!sameOrigin(spec.url, tabUrl)) throw new Error('requests restricted to the page origin');
    return this.pageFetch(tabId, spec);
  }
}
