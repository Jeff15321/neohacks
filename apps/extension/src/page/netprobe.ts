/**
 * MAIN-world network probe — manifest content script (world:"MAIN", run_at:"document_start", all_frames)
 * injected before page JS runs (ported from MVP net/probe.ts).
 *
 * Wraps window.fetch / XMLHttpRequest / navigator.sendBeacon to observe API traffic (request AND response
 * bodies — chrome.webRequest cannot see bodies) and executes page-context replays with the page's original
 * fetch (ambient cookies, page CORS).
 *
 * Security (doc §4 item 1): records are posted to THIS frame's window only (never window.top, so iframe
 * bodies can't leak to a cross-origin top page) and relayed by this frame's isolated content script. The page
 * can still forge records — the SW marks them provenance:'page' and only replays webRequest-confirmed ops.
 * Imports must stay tiny (runs on every page): no zod/acorn.
 */
import type { NetBodyKind, NetRequestRecord } from '@app/contracts';
import { LIMITS } from '@app/contracts/limits';
import { cap, headersToRecord, pickHeader, isTextualContentType } from '@app/core/net/invoke';

const STORE = LIMITS.NET_BODY_STORE_CHARS;
const RESULT_CAP = LIMITS.NET_INVOKE_RESULT_CHARS;

let rid = 0;
const nextId = () => `r${Date.now().toString(36)}_${(rid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** >0 while a replayed request is in flight — records produced are flagged replay:true. */
let replayDepth = 0;

const target = location.origin === 'null' ? '*' : location.origin;
const post = (data: object) => { try { window.postMessage({ source: 'wwa-net', ...data }, target); } catch { /* detached */ } };
const emit = (record: NetRequestRecord) => post({ kind: 'record', record });

async function bodyToString(body: unknown): Promise<{ text?: string; kind: NetBodyKind }> {
  try {
    if (body === undefined || body === null) return { kind: 'none' };
    if (typeof body === 'string') return { text: cap(body, STORE), kind: guessKind(body) };
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { text: cap(body.toString(), STORE), kind: 'urlencoded' };
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const entries: Record<string, string> = {};
      body.forEach((v, k) => { entries[k] = typeof v === 'string' ? v : `[File ${v.name || '?'} ${v.size}b]`; });
      return { text: cap(JSON.stringify(entries), STORE), kind: 'form' };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      if (body.size > 256_000) return { kind: 'binary' };
      const t = await body.text().catch(() => undefined);
      return t === undefined ? { kind: 'binary' } : { text: cap(t, STORE), kind: /json/i.test(body.type) ? 'json' : 'text' };
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { kind: 'binary' };
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return { kind: 'stream' };
    if (typeof Document !== 'undefined' && body instanceof Document) {
      try { return { text: cap(new XMLSerializer().serializeToString(body), STORE), kind: 'text' }; } catch { /* fallthrough */ }
    }
    return { text: cap(String(body), STORE), kind: 'text' };
  } catch {
    return { kind: 'none' };
  }
}

const guessKind = (s: string): NetBodyKind => {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) { try { JSON.parse(t); return 'json'; } catch { /* fall */ } }
  return 'text';
};

function baseRecord(initiator: NetRequestRecord['initiator']): NetRequestRecord {
  return { id: nextId(), tabId: -1, frameUrl: location.href, url: '', method: 'GET', initiator, startTs: Date.now(), replay: replayDepth > 0 || undefined };
}

// --- fetch ---
let patched = true;
let origFetch: typeof fetch | undefined;
try {
  origFetch = window.fetch.bind(window);
  const of = origFetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const rec = baseRecord('fetch');
    let bodyP: Promise<unknown> = Promise.resolve();
    try {
      const req = input instanceof Request ? input : undefined;
      rec.url = new URL(typeof input === 'string' ? input : req?.url ?? String(input), location.href).href;
      rec.method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();
      rec.requestHeaders = headersToRecord(init?.headers ?? req?.headers);
      rec.contentType = pickHeader(rec.requestHeaders, 'content-type');
      const src = init && 'body' in init ? init.body : (req ? req.clone().text() : undefined);
      bodyP = Promise.resolve(src).then(bodyToString).then(b => { rec.bodyKind = b.kind; rec.requestBody = b.text; });
    } catch { /* still record the call */ }
    let result: Promise<Response>;
    try {
      result = of(input, init);
    } catch (e) {
      rec.error = String((e as Error)?.message ?? e);
      void bodyP.finally(() => emit(rec));
      throw e;
    }
    result.then(async (resp) => {
      try {
        rec.status = resp.status; rec.statusText = resp.statusText; rec.ok = resp.ok;
        rec.durationMs = Date.now() - rec.startTs;
        rec.responseHeaders = headersToRecord(resp.headers);
        const ct = resp.headers.get('content-type');
        const len = Number(resp.headers.get('content-length') ?? 0);
        if (isTextualContentType(ct) && len < 4_000_000) rec.responseBody = cap(await resp.clone().text(), STORE);
      } catch { /* response unreadable — emit what we have */ }
      try { await bodyP; } catch { /* ignore */ }
      emit(rec);
    }, async (err) => {
      rec.ok = false; rec.error = String(err?.message ?? err); rec.durationMs = Date.now() - rec.startTs;
      try { await bodyP; } catch { /* ignore */ }
      emit(rec);
    });
    return result;
  };
} catch (e) { patched = false; console.warn('[wwa-netprobe] fetch patch failed', e); }

// --- XMLHttpRequest ---
interface XhrMeta extends NetRequestRecord { headers: Record<string, string>; }
try {
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  const origSet = proto.setRequestHeader;
  const metas = new WeakMap<XMLHttpRequest, XhrMeta>();

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const m = baseRecord('xhr') as XhrMeta;
    m.method = String(method).toUpperCase();
    try { m.url = new URL(String(url), location.href).href; } catch { m.url = String(url); }
    m.headers = {};
    metas.set(this, m);
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const m = metas.get(this);
    if (m) m.headers[name] = value;
    return origSet.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = metas.get(this);
    if (m) {
      m.startTs = Date.now();
      m.requestHeaders = m.headers;
      m.contentType = pickHeader(m.headers, 'content-type');
      void bodyToString(body).then(b => { m.bodyKind = b.kind; m.requestBody = b.text; });
      this.addEventListener('loadend', () => {
        try {
          m.status = this.status; m.statusText = this.statusText; m.ok = this.status >= 200 && this.status < 400;
          m.durationMs = Date.now() - m.startTs;
          m.responseHeaders = headersToRecord((this.getAllResponseHeaders() || '').split(/\r?\n/).filter(Boolean).map(l => l.split(/:\s*/, 2)));
          if (!this.responseType || this.responseType === 'text') m.responseBody = cap(this.responseText, STORE);
          else if (this.responseType === 'json') { try { m.responseBody = cap(JSON.stringify(this.response), STORE); } catch { /* fall */ } }
        } catch { /* emit what we have */ }
        const { headers: _h, ...rec } = m;
        emit(rec);
      }, { once: true });
    }
    return origSend.call(this, body as XMLHttpRequestBodyInit | null | undefined);
  };
} catch (e) { patched = false; console.warn('[wwa-netprobe] xhr patch failed', e); }

// --- navigator.sendBeacon (request only, no response) ---
try {
  const origBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
    const rec = baseRecord('beacon');
    try { rec.url = new URL(String(url), location.href).href; } catch { rec.url = String(url); }
    rec.method = 'POST';
    const ret = origBeacon(url, data);
    void bodyToString(data).then(b => { rec.bodyKind = b.kind; rec.requestBody = b.text; rec.ok = ret; rec.durationMs = Date.now() - rec.startTs; emit(rec); });
    return ret;
  };
} catch { /* beacon unpatched is non-fatal */ }

// --- Replay: page-context fetch via the ORIGINAL fetch reference (falls back to window.fetch if the patch failed) ---
async function doInvoke(invokeId: string, request: { url: string; method: string; headers?: Record<string, string>; body?: string }) {
  replayDepth++;
  const t0 = Date.now();
  try {
    const f = origFetch ?? window.fetch.bind(window);
    const resp = await f(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      credentials: 'include',
    });
    const ct = resp.headers.get('content-type');
    const bodyText = isTextualContentType(ct) ? cap(await resp.text(), RESULT_CAP) : `[non-text response: ${ct ?? 'unknown content-type'}]`;
    post({ kind: 'result', invokeId, result: { ok: resp.ok, status: resp.status, statusText: resp.statusText, headers: headersToRecord(resp.headers), bodyText, durationMs: Date.now() - t0 } });
  } catch (e) {
    post({ kind: 'result', invokeId, result: { ok: false, error: String((e as Error)?.message ?? e), durationMs: Date.now() - t0 } });
  } finally {
    replayDepth--;
  }
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const d = ev.data as { source?: string; kind?: string; invokeId?: string; request?: { url: string; method: string; headers?: Record<string, string>; body?: string } } | null;
  if (!d || typeof d !== 'object' || d.source !== 'wwa-ext') return;
  // Replays run in the TOP frame only — consistent origin + cookie context.
  if (d.kind === 'invoke' && window === window.top && d.invokeId && d.request) void doInvoke(d.invokeId, d.request);
  else if (d.kind === 'ping') post({ kind: 'pong', frameUrl: location.href });
});

post({ kind: 'hello', frameUrl: location.href, patched });
export {};
