/**
 * Doc §5 widget bundle validation (owner: Phase F). Pure. Each part gets the same code checks as the home part
 * (`checkGeneratedCode`: denylist + acorn + standard selectors) plus bundle rules:
 *  - parts need grant "flow"; home code calling WidgetAI.flow.call needs grant "flow" and a matching part role;
 *  - roles unique + slug-like; concrete hosts only (no `*://*` / all-sites) so the user approves every origin;
 *  - declared handlers must be registered in the part's code via WidgetAI.flow.handle('<name>', …);
 *  - entryUrl must be http(s) and match the part's own patterns; parts may not start flows themselves.
 */
import { HANDLER_RE, PART_ROLE_RE, type WidgetPart } from '@app/contracts';
import { isValidMatchPattern, matchesAny } from './match-pattern.js';
import { checkGeneratedCode } from './validate-code.js';

export interface BundleInput { code: string; matchPatterns: string[]; grants: string[]; parts?: unknown }
export interface BundleCheck { ok: boolean; error?: string; parts: WidgetPart[]; warnings: string[] }

const MAX_PARTS = 4;
const CALL_RE = /\bWidgetAI\s*\.\s*flow\s*\.\s*call\s*\(\s*(['"`])([^'"`]*)\1\s*,\s*(['"`])([^'"`]*)\3/g;
const HANDLE_RE = /\bWidgetAI\s*\.\s*flow\s*\.\s*handle\s*\(\s*(['"`])([^'"`]*)\1/g;
const USES_FLOW_RE = /\bWidgetAI\s*\.\s*flow\b/;

/** Host part of a match pattern ("*://localhost/*" → "localhost"). */
export const patternHost = (p: string) => p.match(/^[^:]+:\/\/([^/]*)/)?.[1] ?? p;

/** Every site (host) a bundle touches, home first — the approval card lists all of them. */
export function bundleSites(w: { matchPatterns: string[]; parts?: Array<{ matchPatterns: string[] }> }): string[] {
  const all = [...w.matchPatterns, ...(w.parts ?? []).flatMap(p => p.matchPatterns)].map(patternHost);
  return [...new Set(all)];
}

const fail = (error: string, warnings: string[]): BundleCheck => ({ ok: false, error, parts: [], warnings });

export function checkBundle(b: BundleInput): BundleCheck {
  const warnings: string[] = [];
  const raw = b.parts ?? [];
  if (!Array.isArray(raw)) return fail('parts must be an array', warnings);
  const hasGrant = b.grants.includes('flow');
  const homeCalls = [...b.code.matchAll(CALL_RE)].map(m => ({ role: m[2], handler: m[4] }));
  if (raw.length === 0) {
    if (USES_FLOW_RE.test(b.code)) return fail('code uses WidgetAI.flow but the bundle has no parts', warnings);
    if (hasGrant) warnings.push('grant "flow" without parts (ignored)');
    return { ok: true, parts: [], warnings };
  }
  if (raw.length > MAX_PARTS) return fail(`too many parts (max ${MAX_PARTS})`, warnings);
  if (!hasGrant) return fail('bundle has parts but grant "flow" is not declared', warnings);
  if (/\bWidgetAI\s*\.\s*flow\s*\.\s*handle\b/.test(b.code)) return fail('the home part cannot register flow handlers (put them in a part)', warnings);
  const parts: WidgetPart[] = [];
  const roles = new Set<string>();
  for (const [i, p] of raw.entries()) {
    const where = `part ${i}`;
    if (!p || typeof p !== 'object') return fail(`${where}: must be an object`, warnings);
    const o = p as Record<string, unknown>;
    const role = typeof o.role === 'string' ? o.role : '';
    if (!PART_ROLE_RE.test(role) || role === 'home') return fail(`${where}: bad role ${JSON.stringify(o.role)} (lowercase slug, not "home")`, warnings);
    if (roles.has(role)) return fail(`${where}: duplicate role "${role}"`, warnings);
    roles.add(role);
    const pats = Array.isArray(o.matchPatterns) ? (o.matchPatterns as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    if (!pats.length) return fail(`part "${role}": matchPatterns required`, warnings);
    for (const m of pats) {
      if (!isValidMatchPattern(m)) return fail(`part "${role}": bad matchPattern ${m}`, warnings);
      const host = patternHost(m);
      if (host === '*' || host === '' || m === '<all_urls>') return fail(`part "${role}": match pattern ${m} is not a concrete site (every origin must be approved explicitly)`, warnings);
    }
    const code = typeof o.code === 'string' ? o.code : '';
    const check = checkGeneratedCode(code);
    if (!check.ok) return fail(`part "${role}": ${check.error}`, warnings);
    if (/\bWidgetAI\s*\.\s*flow\s*\.\s*call\b/.test(code)) return fail(`part "${role}": parts cannot start flows (WidgetAI.flow.call is home-only)`, warnings);
    const registered = [...code.matchAll(HANDLE_RE)].map(m => m[2]);
    if (!registered.length) return fail(`part "${role}": code registers no WidgetAI.flow.handle(...) handler`, warnings);
    const declared = Array.isArray(o.handlers) ? (o.handlers as unknown[]).filter((x): x is string => typeof x === 'string') : registered;
    for (const h of declared) {
      if (!HANDLER_RE.test(h)) return fail(`part "${role}": bad handler name ${JSON.stringify(h)}`, warnings);
      if (!registered.includes(h)) return fail(`part "${role}": handler "${h}" is declared but not registered with WidgetAI.flow.handle`, warnings);
    }
    let entryUrl: string | undefined;
    if (o.entryUrl !== undefined && o.entryUrl !== '') {
      if (typeof o.entryUrl !== 'string' || !/^https?:\/\//.test(o.entryUrl)) return fail(`part "${role}": entryUrl must be an http(s) URL`, warnings);
      if (!matchesAny(pats, o.entryUrl)) return fail(`part "${role}": entryUrl ${o.entryUrl} does not match the part's matchPatterns`, warnings);
      entryUrl = o.entryUrl;
    }
    parts.push({ role, matchPatterns: [...new Set(pats)], code, handlers: [...new Set(declared)], ...(entryUrl ? { entryUrl } : {}) });
  }
  for (const c of homeCalls) {
    const part = parts.find(p => p.role === c.role);
    if (!part) return fail(`home code calls WidgetAI.flow.call("${c.role}") but no part has that role`, warnings);
    if (!part.handlers?.includes(c.handler)) return fail(`home code calls handler "${c.handler}" that part "${c.role}" does not declare`, warnings);
  }
  if (!homeCalls.length) warnings.push('no literal WidgetAI.flow.call(role, handler) in the home code');
  return { ok: true, parts, warnings };
}
