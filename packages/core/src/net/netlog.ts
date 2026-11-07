import type { NetInvokeResult, NetOpSummary, NetRequestRecord, NetTier, NetTrigger, NetVerifyEvidence, WebRequestSeen } from '@app/contracts';
import { LIMITS } from '@app/contracts';
import { cap } from './invoke.js';
import { redactBody } from '../redact.js';
import { analyzeOps, canVerify, maxTier, routeTemplates, tierAfterReplay } from '../op-analysis.js';

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

/**
 * Correlate a request to a user gesture (doc §4 item 2). Primary: the record's `stepId` (stamped by the Step
 * recorder while the step was open) → the latest gesture of that step. Fallback: the most recent gesture that
 * preceded it within the time window.
 */
export function correlate(record: NetRequestRecord, gestures: NetTrigger[]): NetTrigger | undefined {
  if (record.stepId) {
    let byStep: NetTrigger | undefined;
    for (const g of gestures) if (g.stepId === record.stepId && g.ts <= record.startTs + CONFIRM_MS && (!byStep || g.ts > byStep.ts)) byStep = g;
    if (byStep) return byStep;
  }
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
    stepId: r.stepId ?? r.trigger?.stepId,
    attribution: r.trigger ? (r.stepId || r.trigger.stepId ? 'step' : 'window') : undefined,
  };
}

/** Template-level verification state (doc §4 item 4). Keyed by `${origin} ${METHOD} ${template}`. */
export interface TierState { tier: NetTier; evidence?: string; ts: number }

const originOfUrl = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
const WR_TYPES = /^(xmlhttprequest|ping)$/;

/** Per-tab store of captured network records, user gestures and webRequest completions. Pure. */
export class NetLog {
  private records = new Map<number, NetRequestRecord[]>();
  private gestures = new Map<number, NetTrigger[]>();
  private webRequests = new Map<number, WebRequestSeen[]>();
  /** Verification tiers per op template, across tabs (an API's tier is a property of the site, not the tab). */
  private tiers = new Map<string, TierState>();

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
    // the page cannot choose the attribution: drop any payload trigger, always correlate SW-side
    r.trigger = correlate(r, this.gestures.get(tabId) ?? []);
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

  /** Redacted op summaries (+ op analysis + template tier), most recent first, mutating ops prioritized.
   *  `origin` scopes to requests issued by frames of the current page origin. */
  ops(tabId: number, limit = 40, origin?: string): NetOpSummary[] {
    let list = [...this.all(tabId)];
    if (origin) list = list.filter(r => { try { return new URL(r.frameUrl).origin === origin; } catch { return false; } });
    const analyses = analyzeOps(list);
    list.sort((a, b) => Number(isInteresting(b)) - Number(isInteresting(a)) || b.startTs - a.startTs);
    return list.slice(0, limit).map(r => {
      const s = summarize(r);
      const analysis = analyses.get(r.id);
      if (analysis) {
        const t = this.tiers.get(`${originOfUrl(r.url)} ${analysis.templateKey}`);
        Object.assign(s, { analysis, tier: t?.tier ?? 'observed', tierEvidence: t?.evidence });
      }
      return s;
    });
  }

  /** Template key (`${origin} ${METHOD} ${template}`) of a captured record, using all captures on its tab. */
  templateKeyOf(tabId: number, opId: string): string | undefined {
    const r = this.recordById(tabId, opId);
    if (!r) return undefined;
    const t = routeTemplates(this.all(tabId)).get(opId);
    return t ? `${originOfUrl(r.url)} ${t.templateKey}` : undefined;
  }

  tierOf(key: string): TierState { return this.tiers.get(key) ?? { tier: 'observed', ts: 0 }; }

  /** A platform-observed replay of `opId` finished: promote its template to `replayed` on 2xx + similar shape. */
  noteReplay(tabId: number, opId: string, result: NetInvokeResult): NetTier {
    const key = this.templateKeyOf(tabId, opId);
    const r = this.recordById(tabId, opId);
    if (!key || !r) return 'observed';
    const cur = this.tierOf(key);
    const next = tierAfterReplay(cur.tier, result, r.responseBody);
    if (next !== cur.tier) this.tiers.set(key, { tier: next, evidence: `replay → HTTP ${result.status}`, ts: Date.now() });
    return next;
  }

  /** Widget run read back its success criterion (WidgetAI.net.reportVerified). Requires a prior successful replay. */
  reportVerified(tabId: number, opId: string, evidence: NetVerifyEvidence): { ok: boolean; tier: NetTier; error?: string } {
    const r = this.recordById(tabId, opId);
    if (!r) return { ok: false, tier: 'observed', error: `captured operation ${opId} not found on this tab` };
    if (!r.confirmed) return { ok: false, tier: 'observed', error: `operation ${opId} is unconfirmed — cannot be verified` };
    const key = this.templateKeyOf(tabId, opId)!;
    const cur = this.tierOf(key);
    const gate = canVerify(cur.tier);
    if (!gate.ok) return { ok: false, tier: cur.tier, error: gate.reason };
    const tier = maxTier(cur.tier, 'verified');
    this.tiers.set(key, { tier, evidence: cap(evidence.readBack, 200), ts: Date.now() });
    return { ok: true, tier };
  }

  tierSnapshot(): Array<[string, TierState]> { return [...this.tiers]; }
  hydrateTiers(entries: Array<[string, TierState]>): void {
    for (const [k, v] of entries) { const cur = this.tiers.get(k); if (!cur || cur.ts < v.ts) this.tiers.set(k, v); }
  }

  /**
   * webRequest-only completions (no probe record within the confirm window) — e.g. worker requests or requests
   * issued before document_start. Shown as "browser-seen, no body"; never replayable.
   */
  browserOnly(tabId: number, origin?: string, limit = 15, now = Date.now()): NetOpSummary[] {
    const recs = this.all(tabId);
    const out: NetOpSummary[] = [];
    for (const w of [...(this.webRequests.get(tabId) ?? [])].reverse()) {
      if (out.length >= limit) break;
      if (w.type && !WR_TYPES.test(w.type)) continue;
      if (now - w.ts < CONFIRM_MS + 1000) continue; // the probe record may still be on its way
      if (origin && originOfUrl(w.url) !== origin) continue;
      if (recs.some(r => matchesWebRequest(r, w))) continue;
      let path = w.url;
      try { const u = new URL(w.url); path = u.pathname + u.search; } catch { /* keep */ }
      out.push({ id: `wr_${Math.round(w.ts)}_${out.length}`, method: w.method, url: w.url, path, status: w.statusCode,
        ok: w.statusCode !== undefined ? w.statusCode < 400 : undefined, initiator: w.type === 'ping' ? 'beacon' : 'fetch',
        ts: w.ts, browserOnly: true });
    }
    return out;
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
