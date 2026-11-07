import * as acorn from 'acorn';

/**
 * Static checks for ANY generated JS (widget bodies, runtime branches, bundle parts).
 * All network access must go through the grant-gated WidgetAI.net surface.
 */
export const BANNED_CONSTRUCTS: RegExp[] = [
  /\beval\s*\(/, /new\s+Function\s*\(/, /document\.cookie/, /XMLHttpRequest/, /\bfetch\s*\(/,
  /\bsendBeacon\s*\(/, /new\s+WebSocket/, /\bchrome\s*\.\s*(runtime|storage|tabs|scripting|userScripts)\b/,
];

/** Non-standard CSS pseudos models hallucinate (invalid in querySelector). */
export const NON_STANDARD_PSEUDO = /:has-text\(|:contains\(|:visible\b|:text\(/;

export type CodeCheck = { ok: true } | { ok: false; error: string };

/** `wrapAsync`: code is the body of an async function (default). */
export function checkGeneratedCode(code: string, opts: { maxChars?: number } = {}): CodeCheck {
  if (typeof code !== 'string' || code.trim().length < 20) return { ok: false, error: 'missing/too-short code' };
  if (code.length > (opts.maxChars ?? 120_000)) return { ok: false, error: `code exceeds ${opts.maxChars ?? 120_000} char limit` };
  for (const re of BANNED_CONSTRUCTS) {
    if (re.test(code)) return { ok: false, error: `generated code uses banned construct: ${re}` };
  }
  if (NON_STANDARD_PSEUDO.test(code)) {
    return { ok: false, error: 'code uses non-standard CSS selector pseudo (:has-text/:contains/:visible) — these are invalid in querySelector; match by iterating and checking textContent instead' };
  }
  try {
    acorn.parse(`(async () => { ${code}\n})()`, { ecmaVersion: 'latest' });
  } catch (err) {
    return { ok: false, error: `syntax check failed: ${String(err).slice(0, 300)}` };
  }
  return { ok: true };
}
