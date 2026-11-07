import type { NetOpSummary, NetRequestRecord, NetTrigger, WebRequestSeen } from '@app/contracts';
import { LIMITS } from '@app/contracts';
import { cap } from './invoke.js';
import { redactBody } from '../redact.js';

const MAX_RECORDS = LIMITS.NET_MAX_RECORDS_PER_TAB;
const MAX_GESTURES = LIMITS.NET_MAX_GESTURES_PER_TAB;
const MAX_WR = LIMITS.NET_MAX_WEBREQUESTS_PER_TAB;
const WINDOW_MS = LIMITS.NET_TRIGGER_WINDOW_MS;
const CONFIRM_MS = LIMITS.NET_CONFIRM_WINDOW_MS;

const MUTATING = /^(POST|PUT|PATCH|DELETE)$/;

/** Whether a request is "interesting" for generation context: mutating calls first. */
export function isInteresting(r: NetRequestRecord): boolean {
  return MUTATING.test(r.method) || !!r.requestBody;
}

/** Correlate a request to the most recent user gesture that preceded it within the time window. */
export function correlate(record: NetRequestRecord, gestures: NetTrigger[]): NetTrigger | undefined {
  let best: NetTrigger | undefined;
  for (const g of gestures) {
    const dt = record.startTs - g.ts;
    if (dt >= 0 && dt <= WINDOW_MS && (!best || g.ts > best.ts)) best = g;
  }
  return best;
}

const normUrl = (u: string) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };

/**
 * Integrity cross-check (doc §4 item 1b): a page-provenance probe record is `confirmed` only when
 * chrome.webRequest (unforgeable by the page) saw the same url+method within ±CONFIRM_MS of the
 * request's lifetime.
 */
export function matchesWebRequest(r: NetRequestRecord, w: WebRequestSeen): boolean {
  if (w.method.toUpperCase() !== r.method.toUpperCase() || normUrl(w.url) !== normUrl(r.url)) return false;
  const start = r.startTs - CONFIRM_MS;
  const end = r.startTs + (r.durationMs ?? 0) + CONFIRM_MS;
  return w.ts >= start && w.ts <= end;
}

/** Compact op view. `redact` (default true) strips secrets — use it for everything that leaves the SW. */
export function summarize(r: NetRequestRecord, redact = true): NetOpSummary {
  let path = r.url;
  try { const u = new URL(r.url); path = u.pathname + u.search; } catch { /* keep raw url */ }
  const req = cap(r.requestBody, LIMITS.NET_BODY_SUMMARY_CHARS);
  const resp = cap(r.responseBody, LIMITS.NET_RESPONSE_SAMPLE_CHARS);
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
    requestBodyTemplate: redact ? redactBody(req) : req,
    responseBodySample: redact ? redactBody(resp) : resp,
    triggerText: r.trigger ? `${r.trigger.kind}${r.trigger.text ? ` "${r.trigger.text}"` : ''}` : undefined,
    replay: r.replay,
    confirmed: r.confirmed,
    ts: r.startTs,
  };
}

/** Per-tab store of captured network records, user gestures and webRequest completions. Pure. */
export class NetLog {
  private records = new Map<number, NetRequestRecord[]>();
  private gestures = new Map<number, NetTrigger[]>();
  private webRequests = new Map<number, WebRequestSeen[]>();

  addGesture(tabId: number, g: NetTrigger): void {
    const list = this.gestures.get(tabId) ?? [];
    list.push(g);
    while (list.length > MAX_GESTURES) list.shift();
    this.gestures.set(tabId, list);
  }

  addRecord(tabId: number, r: NetRequestRecord): NetRequestRecord {
    const list = this.records.get(tabId) ?? [];
    r.tabId = tabId; // trust the sender, not the payload
    r.provenance = 'page';
    r.confirmed = (this.webRequests.get(tabId) ?? []).some(w => matchesWebRequest(r, w));
    if (!r.trigger) r.trigger = correlate(r, this.gestures.get(tabId) ?? []);
    list.push(r);
    while (list.length > MAX_RECORDS) list.shift();
    this.records.set(tabId, list);
    return r;
  }

  /** Record a chrome.webRequest completion; confirms any pending matching probe records. Returns #confirmed. */
  addWebRequest(tabId: number, w: WebRequestSeen): number {
    const list = this.webRequests.get(tabId) ?? [];
    list.push(w);
    while (list.length > MAX_WR) list.shift();
    this.webRequests.set(tabId, list);
    let n = 0;
    for (const r of this.records.get(tabId) ?? []) {
      if (!r.confirmed && matchesWebRequest(r, w)) { r.confirmed = true; n++; }
    }
    return n;
  }

  recordById(tabId: number, id: string): NetRequestRecord | undefined {
    return this.records.get(tabId)?.find(r => r.id === id);
  }

  all(tabId: number): NetRequestRecord[] {
    return this.records.get(tabId) ?? [];
  }

  /** Redacted op summaries, most recent first, mutating ops prioritized.
   *  `origin` scopes to requests issued by frames of the current page origin. */
  ops(tabId: number, limit = 40, origin?: string): NetOpSummary[] {
    let list = [...this.all(tabId)];
    if (origin) list = list.filter(r => { try { return new URL(r.frameUrl).origin === origin; } catch { return false; } });
    list.sort((a, b) => Number(isInteresting(b)) - Number(isInteresting(a)) || b.startTs - a.startTs);
    return list.slice(0, limit).map(r => summarize(r));
  }

  hydrate(tabId: number, records: NetRequestRecord[]): void {
    this.records.set(tabId, records.slice(-MAX_RECORDS));
  }

  clearTab(tabId: number): void {
    this.records.delete(tabId);
    this.gestures.delete(tabId);
    this.webRequests.delete(tabId);
  }
}
