import type {
  NetInvokeOverrides, NetRequestRecord, NetDirectRequest,
} from '@app/shared';

/** Truncate a string for storage/serialization. */
export const cap = (s: string | undefined, n: number): string | undefined =>
  s === undefined ? undefined : (s.length > n ? s.slice(0, n) : s);

const TEXTUAL = /json|text|xml|html|javascript|ecmascript|x-www-form-urlencoded|graphql|csv|plain/i;

/** Whether a content-type is worth capturing as text (skips video/binary payloads). */
export function isTextualContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  return TEXTUAL.test(ct);
}

/** Normalize fetch `headers` (Headers | tuples | record) into a plain object. */
export function headersToRecord(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  try {
    if (h instanceof Headers) { h.forEach((v, k) => { out[k] = v; }); return out; }
  } catch { /* Headers may not exist in some worlds */ }
  if (Array.isArray(h)) {
    for (const pair of h) if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
    return out;
  }
  if (typeof h === 'object') {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k] = String(v);
  }
  return out;
}

export const pickHeader = (h: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === lower) return h[k];
  return undefined;
};

const FORBIDDEN = /^(cookie|content-length|host|origin|referer|user-agent|connection|keep-alive|te|trailer|transfer-encoding|upgrade|via|expect|proxy-|sec-)/i;

/** Headers the browser manages; setting them in fetch() is ignored or rejected — drop them on replay. */
export function stripForbiddenHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (!FORBIDDEN.test(k)) out[k] = v;
  return out;
}

function serializeOverrideBody(body: unknown): { body: string; contentType?: string } {
  if (typeof body === 'string') return { body };
  if (body === undefined || body === null) return { body: '' };
  return { body: JSON.stringify(body), contentType: 'application/json' };
}

function mergeJsonBody(captured: string | undefined, merge: Record<string, unknown>): string {
  let base: unknown = {};
  if (captured !== undefined) {
    try { base = JSON.parse(captured); } catch {
      throw new Error('mergeBody requires a JSON request body; use `body` to replace it');
    }
  }
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    throw new Error('mergeBody requires a JSON object request body; use `body` to replace it');
  }
  return JSON.stringify({ ...(base as Record<string, unknown>), ...merge });
}

export interface InvokeRequestSpec {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Build a fetch-shaped request spec from a captured record + widget overrides.
 * Pure — shared by the service worker (validation path) and unit tests.
 */
export function buildInvokeRequest(record: NetRequestRecord, overrides: NetInvokeOverrides = {}): InvokeRequestSpec {
  const method = String(overrides.method ?? record.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(record.requestHeaders ?? {}) };
  for (const [k, v] of Object.entries(overrides.headers ?? {})) {
    const existing = Object.keys(headers).find(h => h.toLowerCase() === k.toLowerCase());
    if (v === null) { if (existing) delete headers[existing]; delete headers[k]; }
    else headers[k] = v;
  }
  let body: string | undefined;
  if (overrides.body !== undefined) {
    const s = serializeOverrideBody(overrides.body);
    body = s.body;
    if (s.contentType && !pickHeader(headers, 'content-type')) headers['content-type'] = s.contentType;
  } else if (overrides.mergeBody !== undefined) {
    body = mergeJsonBody(record.requestBody, overrides.mergeBody);
    if (!pickHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
  } else {
    body = record.requestBody;
  }
  if (method === 'GET' || method === 'HEAD') body = undefined;
  return { url: overrides.url ?? record.url, method, headers: stripForbiddenHeaders(headers), body };
}

/** Build a fetch-shaped request spec for WidgetAI.net.request (no captured template). */
export function buildDirectRequest(req: NetDirectRequest, tabUrl: string): InvokeRequestSpec {
  const url = new URL(req.url, tabUrl).href; // resolves relative URLs against the page
  const method = String(req.method ?? (req.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (req.body !== undefined) {
    const s = serializeOverrideBody(req.body);
    body = s.body;
    if (s.contentType && !pickHeader(headers, 'content-type')) headers['content-type'] = s.contentType;
  }
  if (method === 'GET' || method === 'HEAD') body = undefined;
  return { url, method, headers: stripForbiddenHeaders(headers), body };
}

/** Replays must stay on the page's own origin — ambient cookies make cross-origin requests dangerous. */
export function sameOrigin(url: string, tabUrl: string): boolean {
  try { return new URL(url, tabUrl).origin === new URL(tabUrl).origin; } catch { return false; }
}
