import type { GeneratedWidget, WidgetGrant } from '@app/contracts';
import { WidgetGrant as GrantSchema } from '@app/contracts';
import { checkGeneratedCode, isValidMatchPattern } from '@app/core';

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
    },
  };
}
