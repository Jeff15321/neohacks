import type { GeneratedWidget, WidgetGrant } from '@app/contracts';
import { DATA_LIMITS, WidgetGrant as GrantSchema } from '@app/contracts';
import { checkBundle, checkGeneratedCode, isValidMatchPattern } from '@app/core';

const GRANTS = new Set<string>(GrantSchema.options);

export interface ParseResult { widget?: GeneratedWidget; error?: string; warnings: string[]; }

/**
 * Extract + validate the generator's widget JSON (ported from MVP generation/parse.ts).
 * Structured outputs make the JSON well-formed; this still enforces the safety rules.
 */
export function parseGeneratedWidget(raw: string): ParseResult {
  const warnings: string[] = [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && !text.startsWith('{')) { text = fence[1].trim(); warnings.push('output was fenced; stripped'); }
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) return { error: 'no JSON object in model output', warnings };
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(text.slice(s, e + 1)); }
  catch (err) { return { error: `JSON.parse failed: ${String(err).slice(0, 200)}`, warnings }; }

  if (typeof obj.name !== 'string' || !obj.name) return { error: 'missing name', warnings };
  const code = typeof obj.code === 'string' ? obj.code : '';
  let matchPatterns = Array.isArray(obj.matchPatterns) ? (obj.matchPatterns as unknown[]).filter((m): m is string => typeof m === 'string') : [];
  if (matchPatterns.length === 0) { matchPatterns = ['*://*/*']; warnings.push('matchPatterns defaulted to *://*/*'); }
  for (const m of matchPatterns) if (!isValidMatchPattern(m)) return { error: `bad matchPattern: ${m}`, warnings };
  const grants = (Array.isArray(obj.grants) ? obj.grants : []).filter((g): g is WidgetGrant => typeof g === 'string' && GRANTS.has(g));
  const check = checkGeneratedCode(code);
  if (!check.ok) return { error: check.error, warnings };
  if (Array.isArray(obj.warnings)) warnings.push(...obj.warnings.filter((w): w is string => typeof w === 'string').map(w => w.slice(0, 300)));
  const strs = (v: unknown, n: number, len: number) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map(x => x.slice(0, len)) : undefined;
  const data = checkDataUse(obj.collections, grants, code);
  if (data.error) return { error: data.error, warnings };
  warnings.push(...data.warnings);
  const bundle = checkBundle({ code, matchPatterns, grants, parts: obj.parts }); // Phase F: bundle parts (doc §5)
  if (!bundle.ok) return { error: bundle.error, warnings };
  warnings.push(...bundle.warnings);

  return {
    warnings,
    widget: {
      name: obj.name.slice(0, 80),
      description: String(obj.description ?? '').slice(0, 300),
      matchPatterns,
      grants: [...new Set(grants)],
      code,
      insertionHint: typeof obj.insertionHint === 'string' ? obj.insertionHint.slice(0, 200) : undefined,
      plan: strs(obj.plan, 12, 300),
      changeSummary: typeof obj.changeSummary === 'string' && obj.changeSummary ? obj.changeSummary.slice(0, 400) : undefined,
      consequentialActions: strs(obj.consequentialActions, 10, 200),
      ...(data.collections.length ? { collections: data.collections } : {}),
      ...(bundle.parts.length ? { parts: bundle.parts } : {}),
    },
  };
}

/**
 * WidgetAI.db (Phase A): `collections` must be valid names; the "data" grant requires ≥1 declared collection;
 * code that calls WidgetAI.db needs the grant; literal collection names used in code must be declared.
 */
function checkDataUse(raw: unknown, grants: WidgetGrant[], code: string): { collections: string[]; error?: string; warnings: string[] } {
  const warnings: string[] = [];
  if (raw !== undefined && !Array.isArray(raw)) return { collections: [], error: 'collections must be an array of strings', warnings };
  const list = (raw as unknown[] | undefined) ?? [];
  for (const c of list) {
    if (typeof c !== 'string' || !DATA_LIMITS.COLLECTION_RE.test(c)) return { collections: [], error: `bad collection name ${JSON.stringify(c)} (must match ^[a-z0-9_-]{1,64}$)`, warnings };
  }
  const collections = [...new Set(list as string[])];
  if (collections.length > DATA_LIMITS.MAX_DECLARED_COLLECTIONS) return { collections: [], error: `too many collections (max ${DATA_LIMITS.MAX_DECLARED_COLLECTIONS})`, warnings };
  const hasGrant = grants.includes('data');
  const usesDb = /\bWidgetAI\s*\.\s*db\b/.test(code);
  if (usesDb && !hasGrant) return { collections: [], error: 'code uses WidgetAI.db but grant "data" is not declared', warnings };
  if (hasGrant && collections.length === 0) return { collections: [], error: 'grant "data" requires declaring the collections the widget reads/writes in "collections"', warnings };
  if (!hasGrant && collections.length) { warnings.push('collections ignored: grant "data" not declared'); return { collections: [], warnings }; }
  for (const m of code.matchAll(/\bWidgetAI\s*\.\s*db\s*\.\s*(?:list|get|add|update|remove)\s*\(\s*(['"`])([^'"`]*)\1/g)) {
    if (!collections.includes(m[2])) return { collections: [], error: `code uses collection "${m[2]}" that is not declared in "collections" (${collections.join(', ')})`, warnings };
  }
  return { collections, warnings };
}
