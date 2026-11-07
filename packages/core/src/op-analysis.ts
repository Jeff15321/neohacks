/**
 * Deterministic op analysis (doc §4 items 3–4). Pure: no chrome.* / node / fastify imports.
 *
 * Input: RAW captured records of one tab (SW-local). Output: field NAMES and paths only — never raw values —
 * so analyses can travel with redacted summaries to the panel, the generator and widgets.
 *  - route templates     `/repos/:repo/:repo2/issues/:n` (variance across captures + id-shaped segments)
 *  - token fields        secret-named, high-entropy, or opaque values that differ across captures
 *  - dependency inference a value in request B that appeared in an earlier response A → `B.dependsOn A.path`
 *  - idempotency hints    mutating op + client-generated id fields
 *  - verification tiers   observed → replayed (2xx + similar response shape) → verified (widget read-back)
 */
import type { NetDependency, NetOpAnalysis, NetRequestRecord, NetTier } from '@app/contracts';
import { isSecretField, isSecretHeader, looksSecret } from './redact.js';

const MUTATING = /^(POST|PUT|PATCH|DELETE)$/i;
const MAX_LEAVES = 300;
const MAX_DEPTH = 6;

// ---------- route templates ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Placeholder for a segment that is id-shaped on its own (no second capture needed). */
export function segmentPlaceholder(seg: string): string | undefined {
  if (/^\d+$/.test(seg)) return ':n';
  if (UUID.test(seg)) return ':id';
  if (/^[0-9a-f]{12,}$/i.test(seg) && /\d/.test(seg)) return ':id';
  if (seg.length >= 16 && /\d/.test(seg) && /[a-z]/i.test(seg) && !/\./.test(seg)) return ':id';
  return undefined;
}

const VAR = '\u0000';
const isVar = (s: string) => s.startsWith(VAR) || s.startsWith(':');
const idLike = (s: string) => /\d/.test(s) || s.length >= 12;
const singular = (w: string) => w.replace(/[^a-z0-9]+/gi, '_').replace(/ies$/i, 'y').replace(/s$/i, '').toLowerCase() || 'p';

const pathSegments = (url: string): string[] => {
  try { return new URL(url).pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } }); }
  catch { return url.split('?')[0]!.split('/').filter(Boolean); }
};

/** Shape of a path: id-shaped segments replaced by their placeholder. */
const shapeOfPath = (segs: string[]) => segs.map(s => segmentPlaceholder(s) ?? s);

interface Cluster { method: string; origin: string; shape: string[]; ids: string[] }
const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

/** Can `shape` join `cluster`? Equal literals must outnumber the differing ones; a differing LAST segment must be id-like. */
function compatible(c: string[], s: string[]): number[] | null {
  if (c.length !== s.length) return null;
  const diff: number[] = [];
  let equalLiterals = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i]!, b = s[i]!;
    if (a === b) { if (!isVar(a)) equalLiterals++; continue; }
    if (a.startsWith(VAR) && !b.startsWith(':')) { continue; } // already-variable position
    if (isVar(a) || isVar(b)) return null; // :n vs literal → different routes
    diff.push(i);
  }
  if (!diff.length) return diff;
  if (equalLiterals === 0 || equalLiterals < diff.length) return null;
  const last = c.length - 1;
  if (diff.includes(last) && !(idLike(c[last]!) && idLike(s[last]!)) && !c[last]!.startsWith(VAR)) return null;
  if (diff.includes(0)) return null;
  return diff;
}

function renderTemplate(shape: string[]): string {
  const used = new Map<string, number>();
  const out: string[] = [];
  let prevLiteral = '';
  for (const seg of shape) {
    if (seg.startsWith(VAR)) {
      const base = singular(prevLiteral || 'p');
      const n = (used.get(base) ?? 0) + 1; used.set(base, n);
      out.push(':' + (n === 1 ? base : base + n));
    } else {
      out.push(seg);
      if (!seg.startsWith(':')) prevLiteral = seg;
    }
  }
  return '/' + out.join('/');
}

/** Route template per record id (`/api/messages/:message`, `/repos/:repo/:repo2/issues/:n`). */
export function routeTemplates(records: NetRequestRecord[]): Map<string, { template: string; templateKey: string }> {
  const clusters: Cluster[] = [];
  for (const r of records) {
    const method = r.method.toUpperCase();
    const origin = originOf(r.url);
    const shape = shapeOfPath(pathSegments(r.url));
    let joined = false;
    for (const c of clusters) {
      if (c.method !== method || c.origin !== origin) continue;
      const diff = compatible(c.shape, shape);
      if (!diff) continue;
      for (const i of diff) c.shape[i] = VAR + c.shape[i];
      c.ids.push(r.id); joined = true; break;
    }
    if (!joined) clusters.push({ method, origin, shape: [...shape], ids: [r.id] });
  }
  const out = new Map<string, { template: string; templateKey: string }>();
  for (const c of clusters) {
    const template = renderTemplate(c.shape);
    for (const id of c.ids) out.set(id, { template, templateKey: `${c.method} ${template}` });
  }
  return out;
}

/** Single-URL template (id-shaped segments only; no cross-capture variance). */
export const routeTemplate = (url: string) => renderTemplate(shapeOfPath(pathSegments(url)));

// ---------- fields ----------

type Leaf = string | number | boolean | null;

function flatten(v: unknown, prefix: string, out: Map<string, Leaf>, depth = 0) {
  if (out.size >= MAX_LEAVES) return;
  if (v === null || typeof v !== 'object') { if (prefix) out.set(prefix, v as Leaf); return; }
  if (depth >= MAX_DEPTH) return;
  if (Array.isArray(v)) { v.slice(0, 20).forEach((x, i) => flatten(x, `${prefix}[${i}]`, out, depth + 1)); return; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out, depth + 1);
}

function parseBody(body: string | undefined): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  if (!body) return out;
  const t = body.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { flatten(JSON.parse(t), '', out); return out; } catch { /* not JSON */ }
  }
  if (/^[\w.%\-[\]]+=[^&]*(&[\w.%\-[\]]+=[^&]*)*$/.test(t)) {
    try { for (const [k, v] of new URLSearchParams(t)) out.set(k, v); } catch { /* ignore */ }
  }
  return out;
}

const SKIP_HEADER = /^(content-type|accept|accept-language|cache-control|pragma)$/i;

/** Request fields: `query.k`, `header.k`, `body.a.b[0]`. Raw values (SW-local only). */
export function requestFields(r: NetRequestRecord): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  try { for (const [k, v] of new URL(r.url).searchParams) out.set(`query.${k}`, v); } catch { /* relative */ }
  for (const [k, v] of Object.entries(r.requestHeaders ?? {})) if (!SKIP_HEADER.test(k)) out.set(`header.${k.toLowerCase()}`, v);
  for (const [k, v] of parseBody(r.requestBody)) out.set(`body.${k}`, v);
  return out;
}

/** Response fields: JSON paths (`token`, `data.items[0].id`) + `header:k`. */
export function responseFields(r: NetRequestRecord): Map<string, Leaf> {
  const out = parseBody(r.responseBody);
  for (const [k, v] of Object.entries(r.responseHeaders ?? {})) out.set(`header:${k.toLowerCase()}`, v);
  return out;
}

const lastKey = (field: string) => field.replace(/\[\d+\]/g, '').split('.').pop() ?? field;
const isOpaque = (v: Leaf): v is string => typeof v === 'string' && v.length >= 8 && !/\s/.test(v) && !v.includes('@') && /\d/.test(v) && /[a-z]/i.test(v);
const secretNamed = (field: string) => field.startsWith('header.') ? isSecretHeader(field.slice(7)) : isSecretField(lastKey(field));

const CLIENT_ID = /^(client_?(mutation_?)?id|request_?id|idempotency[_-]?key|nonce|dedupe?(_?(key|id))?|uuid|tx_?id|client_?token|local_?id|temp_?id)$/i;

// ---------- analysis ----------

/** Analyse all records of a tab. Pure and deterministic; outputs contain field names/paths only. */
export function analyzeOps(records: NetRequestRecord[]): Map<string, NetOpAnalysis> {
  const templates = routeTemplates(records);
  const reqFields = new Map(records.map(r => [r.id, requestFields(r)] as const));
  const respFields = new Map(records.map(r => [r.id, responseFields(r)] as const));
  const groupKey = (r: NetRequestRecord) => `${originOf(r.url)} ${templates.get(r.id)!.templateKey}`;
  const byKey = new Map<string, NetRequestRecord[]>();
  for (const r of records) {
    const k = groupKey(r);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }

  // token / param fields per template
  const fieldClass = new Map<string, { tokens: string[]; params: string[] }>();
  for (const [key, group] of byKey) {
    const values = new Map<string, Leaf[]>();
    for (const r of group) for (const [f, v] of reqFields.get(r.id)!) values.set(f, [...(values.get(f) ?? []), v]);
    const tokens: string[] = [], params: string[] = [];
    for (const [f, vs] of values) {
      const differs = new Set(vs.map(v => JSON.stringify(v))).size > 1;
      if (secretNamed(f) || vs.some(v => typeof v === 'string' && looksSecret(v))) tokens.push(f);
      else if (differs && vs.every(isOpaque)) tokens.push(f);
      else if (differs) params.push(f);
    }
    fieldClass.set(key, { tokens: tokens.sort(), params: params.sort() });
  }

  const sorted = [...records].sort((a, b) => a.startTs - b.startTs);
  const out = new Map<string, NetOpAnalysis>();
  for (const r of records) {
    const { template, templateKey } = templates.get(r.id)!;
    const cls = fieldClass.get(groupKey(r))!;
    const mutating = MUTATING.test(r.method);
    const fields = reqFields.get(r.id)!;

    // dependency inference: request value (token-like or opaque) seen in an EARLIER response
    const dependsOn: NetDependency[] = [];
    for (const [f, v] of fields) {
      if (typeof v !== 'string' || v.length < 6 || /\s/.test(v)) continue;
      if (!cls.tokens.includes(f) && !isOpaque(v)) continue;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const a = sorted[i]!;
        if (a.id === r.id || a.startTs > r.startTs) continue;
        let hit: string | undefined;
        for (const [p, x] of respFields.get(a.id)!) {
          if (x === v || (typeof x === 'string' && p.startsWith('header:') && x.endsWith(' ' + v))) { hit = p; break; }
        }
        if (hit) { dependsOn.push({ field: f, opId: a.id, fromTemplate: templates.get(a.id)!.templateKey, path: hit }); break; }
      }
    }

    const clientIdFields = mutating
      ? [...fields].filter(([f, v]) => (f.startsWith('body.') || f === 'header.idempotency-key' || f === 'header.x-request-id') &&
          (CLIENT_ID.test(lastKey(f)) || (typeof v === 'string' && UUID.test(v)))).map(([f]) => f)
        .filter(f => !dependsOn.some(d => d.field === f)).sort()
      : [];
    const idempotencyHint = !mutating ? undefined : clientIdFields.length
      ? `client-generated id field(s) ${clientIdFields.join(', ')}: send a FRESH value per replay (a reused id may be deduplicated or rejected)`
      : 'not idempotent: each replay may create a new resource — never retry blindly; read back before re-sending';

    out.set(r.id, {
      template, templateKey, captures: byKey.get(groupKey(r))!.length, mutating,
      tokenFields: cls.tokens, paramFields: cls.params, dependsOn, clientIdFields, idempotencyHint,
    });
  }
  return out;
}

// ---------- verification tiers ----------

export const TIER_RANK: Record<NetTier, number> = { observed: 0, replayed: 1, verified: 2 };
export const maxTier = (a: NetTier, b: NetTier): NetTier => (TIER_RANK[b] > TIER_RANK[a] ? b : a);

/** Top-level + second-level key set of a JSON body; null when not JSON. */
export function responseShape(body: string | undefined): Set<string> | null {
  if (!body) return null;
  let v: unknown;
  try { v = JSON.parse(body); } catch { return null; }
  const keys = new Set<string>();
  const visit = (x: unknown, prefix: string, depth: number) => {
    if (Array.isArray(x)) { keys.add(prefix + '[]'); if (x.length) visit(x[0], prefix + '[]', depth); return; }
    if (!x || typeof x !== 'object' || depth > 1) return;
    for (const [k, y] of Object.entries(x as Record<string, unknown>)) { keys.add(prefix + k); visit(y, prefix + k + '.', depth + 1); }
  };
  visit(v, '', 0);
  return keys;
}

/** Replay response "similar" to the original: same JSON-ness and key-set Jaccard ≥ 0.5. */
export function shapeSimilar(original: string | undefined, replay: string | undefined): boolean {
  const a = responseShape(original), b = responseShape(replay);
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (!a.size && !b.size) return true;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  return inter / (a.size + b.size - inter) >= 0.5;
}

/** Tier after a platform-observed replay: `replayed` only for 2xx with a similar response shape. Never demotes. */
export function tierAfterReplay(current: NetTier, result: { status?: number; bodyText?: string }, originalResponseBody: string | undefined): NetTier {
  const ok2xx = result.status !== undefined && result.status >= 200 && result.status < 300;
  return ok2xx && shapeSimilar(originalResponseBody, result.bodyText) ? maxTier(current, 'replayed') : current;
}

/** `reportVerified` is accepted only after the platform itself saw a successful replay of the template. */
export function canVerify(current: NetTier): { ok: true } | { ok: false; reason: string } {
  return TIER_RANK[current] >= TIER_RANK.replayed
    ? { ok: true }
    : { ok: false, reason: 'op template has no successful replay in this session (tier observed) — invoke it first and check the response' };
}
