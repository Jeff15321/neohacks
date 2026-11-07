import type { NetOpSummary, NetRequestRecord, NetTrigger } from '@app/shared';
import { LIMITS } from '@app/shared';
import { cap } from '../net/invoke.js';

const MAX_RECORDS = LIMITS.NET_MAX_RECORDS_PER_TAB;
const MAX_GESTURES = LIMITS.NET_MAX_GESTURES_PER_TAB;
const WINDOW_MS = LIMITS.NET_TRIGGER_WINDOW_MS;

const MUTATING = /^(POST|PUT|PATCH|DELETE)$/;

/** Whether a request is "interesting" for generation context: mutating calls first. */
export function isInteresting(r: NetRequestRecord): boolean {
  return MUTATING.test(r.method) || !!r.requestBody;
}

/**
 * Correlate a request to the most recent user gesture that preceded it within
 * the time window. Gestures and records share the browser clock (Date.now).
 */
export function correlate(record: NetRequestRecord, gestures: NetTrigger[]): NetTrigger | undefined {
  let best: NetTrigger | undefined;
  for (const g of gestures) {
    const dt = record.startTs - g.ts;
    if (dt >= 0 && dt <= WINDOW_MS && (!best || g.ts > best.ts)) best = g;
  }
  return best;
}

export function summarize(r: NetRequestRecord): NetOpSummary {
  let path = r.url;
  try { const u = new URL(r.url); path = u.pathname + u.search; } catch { /* keep raw url */ }
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    path,
    status: r.status,
    ok: r.ok,
    initiator: r.initiator,
    contentType: r.contentType,
    bodyKind: r.bodyKind,
    requestBodyTemplate: cap(r.requestBody, LIMITS.NET_BODY_SUMMARY_CHARS),
    responseBodySample: cap(r.responseBody, LIMITS.NET_RESPONSE_SAMPLE_CHARS),
    triggerText: r.trigger ? `${r.trigger.kind}${r.trigger.text ? ` "${r.trigger.text}"` : ''}` : undefined,
    replay: r.replay,
    ts: r.startTs,
  };
}

/**
 * Per-tab store of captured network records + user gestures.
 * In-memory (hydrated from chrome.storage.session by the caller); pure.
 */
export class NetLog {
  private records = new Map<number, NetRequestRecord[]>();
  private gestures = new Map<number, NetTrigger[]>();

  addGesture(tabId: number, g: NetTrigger): void {
    const list = this.gestures.get(tabId) ?? [];
    list.push(g);
    while (list.length > MAX_GESTURES) list.shift();
    this.gestures.set(tabId, list);
  }

  addRecord(tabId: number, r: NetRequestRecord): NetRequestRecord {
    const list = this.records.get(tabId) ?? [];
    r.tabId = tabId; // trust the sender, not the payload
    if (!r.trigger) r.trigger = correlate(r, this.gestures.get(tabId) ?? []);
    list.push(r);
    while (list.length > MAX_RECORDS) list.shift();
    this.records.set(tabId, list);
    return r;
  }

  recordById(tabId: number, id: string): NetRequestRecord | undefined {
    return this.records.get(tabId)?.find(r => r.id === id);
  }

  all(tabId: number): NetRequestRecord[] {
    return this.records.get(tabId) ?? [];
  }

  /** Compact op summaries, most recent first, mutating ops prioritized.
   *  `origin` scopes to requests issued by frames of the current page origin. */
  ops(tabId: number, limit = 40, origin?: string): NetOpSummary[] {
    let list = [...this.all(tabId)];
    if (origin) list = list.filter(r => { try { return new URL(r.frameUrl).origin === origin; } catch { return false; } });
    list.sort((a, b) => Number(isInteresting(b)) - Number(isInteresting(a)) || b.startTs - a.startTs);
    return list.slice(0, limit).map(summarize);
  }

  /** Hydrate from persisted session state. */
  hydrate(tabId: number, records: NetRequestRecord[]): void {
    this.records.set(tabId, records.slice(-MAX_RECORDS));
  }

  clearTab(tabId: number): void {
    this.records.delete(tabId);
    this.gestures.delete(tabId);
  }
}
