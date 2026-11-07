/**
 * Redaction applied before anything leaves the extension (doc §4 item 1c).
 * Raw values stay local (SW memory/storage.session) for page-context replay.
 */
export const REDACTED = '[REDACTED]';

const SECRET_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-[\w-]*token[\w-]*|[\w-]*csrf[\w-]*|[\w-]*xsrf[\w-]*|x-api-key|api-key)$/i;
const SECRET_FIELD = /pass|secret|token|otp|cvv|ssn|csrf|xsrf|api[-_]?key|auth/i;

/** Shannon entropy in bits/char. */
export function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/** Bearer-like, high-entropy opaque string (API keys, session tokens, JWTs). */
export function looksSecret(s: string): boolean {
  if (/^Bearer\s+\S{8,}/i.test(s)) return true;
  if (/^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}$/.test(s)) return true; // JWT
  if (s.length < 24 || /\s/.test(s)) return false;
  if (!/^[A-Za-z0-9_\-.=+/:]+$/.test(s)) return false;
  if (!/\d/.test(s) || !/[A-Za-z]/.test(s)) return false;
  return entropy(s) >= 3.6;
}

export function redactHeaders(h: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!h) return h;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = SECRET_HEADER.test(k) || looksSecret(v) ? REDACTED : v;
  return out;
}

function redactValue(key: string | undefined, v: unknown): unknown {
  if (key && SECRET_FIELD.test(key) && (typeof v === 'string' || typeof v === 'number')) return REDACTED;
  if (typeof v === 'string') return looksSecret(v) ? REDACTED : v;
  if (Array.isArray(v)) return v.map(x => redactValue(undefined, x));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = redactValue(k, x);
    return o;
  }
  return v;
}

/** Redact a request/response body string: JSON (deep), urlencoded, or free text (token-shaped substrings). */
export function redactBody(body: string | undefined): string | undefined {
  if (body === undefined || body === '') return body;
  const t = body.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(redactValue(undefined, JSON.parse(t))); } catch { /* not JSON, fall through */ }
  }
  if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(t)) {
    try {
      const p = new URLSearchParams(t);
      for (const [k, v] of [...p.entries()]) if (SECRET_FIELD.test(k) || looksSecret(v)) p.set(k, REDACTED);
      return p.toString().replace(/%5BREDACTED%5D/g, REDACTED);
    } catch { /* fall through */ }
  }
  return body
    .replace(/Bearer\s+[A-Za-z0-9_\-.=+/]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(/[A-Za-z0-9_\-.=+/]{24,}/g, m => (looksSecret(m) ? REDACTED : m));
}
