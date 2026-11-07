import * as acorn from 'acorn';
import type { GeneratedWidget, WidgetGrant } from '@app/shared';

const GRANTS: WidgetGrant[] = ['inference', 'log', 'storage', 'network'];

export interface ParseResult { widget?: GeneratedWidget; error?: string; warnings: string[]; }

/** Extract the GeneratedWidget JSON from raw LLM output and validate it. */
export function parseGeneratedWidget(raw: string): ParseResult {
  const warnings: string[] = [];
  let text = raw.trim();
  // strip markdown fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { text = fence[1].trim(); warnings.push('output was fenced; stripped'); }
  // find first { ... last }
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) return { error: 'no JSON object in model output', warnings };
  let obj: any;
  try { obj = JSON.parse(text.slice(s, e + 1)); }
  catch (err) { return { error: `JSON.parse failed: ${String(err).slice(0, 200)}`, warnings }; }

  if (typeof obj.name !== 'string' || !obj.name) return { error: 'missing name', warnings };
  if (typeof obj.code !== 'string' || obj.code.length < 20) return { error: 'missing/too-short code', warnings };
  if (obj.code.length > 120_000) return { error: 'code exceeds 120k char limit', warnings };
  if (!Array.isArray(obj.matchPatterns) || obj.matchPatterns.length === 0) {
    obj.matchPatterns = ['*://*/*']; warnings.push('matchPatterns defaulted to *://*/*');
  }
  for (const m of obj.matchPatterns) {
    if (typeof m !== 'string' || !/^\*:\/\/|https?:\/\//.test(m)) return { error: `bad matchPattern: ${m}`, warnings };
  }
  const grants: WidgetGrant[] = Array.isArray(obj.grants)
    ? obj.grants.filter((g: string) => GRANTS.includes(g as WidgetGrant))
    : [];
  // hard-ban obviously dangerous constructs in generated code — all network
  // access must go through the grant-gated WidgetAI.net surface.
  const banned = [/\beval\s*\(/, /new\s+Function\s*\(/, /document\.cookie/, /XMLHttpRequest/, /\bfetch\s*\(/, /\bsendBeacon\s*\(/, /new\s+WebSocket/];
  for (const re of banned) {
    if (re.test(obj.code)) return { error: `generated code uses banned construct: ${re}`, warnings };
  }
  // reject non-standard CSS pseudo-selectors the model loves to hallucinate
  const pseudoRe = /:has-text\(|:contains\(|:visible\b|:text\(/;
  if (pseudoRe.test(obj.code)) {
    return { error: `code uses non-standard CSS selector pseudo (:has-text/:contains/:visible) — these are invalid in querySelector; match by iterating and checking textContent instead`, warnings };
  }
  // syntax check — catch broken JS before it reaches the browser
  try {
    acorn.parse(`(async () => { ${obj.code} })()`, { ecmaVersion: 'latest', allowReturnOutsideFunction: false });
  } catch (err) {
    return { error: `syntax check failed: ${String(err).slice(0, 300)}`, warnings };
  }

  return {
    warnings,
    widget: {
      name: String(obj.name).slice(0, 80),
      description: String(obj.description ?? '').slice(0, 300),
      matchPatterns: obj.matchPatterns,
      grants,
      code: obj.code,
      insertionHint: typeof obj.insertionHint === 'string' ? obj.insertionHint.slice(0, 200) : undefined,
    },
  };
}
