/** Minimal chrome match-pattern -> RegExp (covers *://, http(s)://, host wildcards). */
export function matchPatternToRegExp(pattern: string): RegExp | null {
  const m = pattern.match(/^(\*|http|https|file|ftp|urn):\/\/([^/]*)(\/.*)$/);
  if (!m) return null;
  const [, scheme, host, path] = m;
  const schemeRe = scheme === '*' ? 'https?' : scheme;
  const hostRe = host === '*' ? '[^/]+'
    : host.startsWith('*.') ? `([^/]+\\.)?${escapeRe(host.slice(2))}`
    : escapeRe(host);
  const pathRe = escapeRe(path).replace(/\\\*/g, '.*');
  // Chrome match patterns ignore ports: allow an optional :port after host.
  return new RegExp(`^${schemeRe}:\\/\\/${hostRe}(:\\d+)?${pathRe}$`);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchesAny(patterns: string[], url: string): boolean {
  return patterns.some(p => matchPatternToRegExp(p)?.test(url));
}

/** Valid generator-supplied match pattern (scheme://host/path). */
export const isValidMatchPattern = (p: string) => matchPatternToRegExp(p) !== null;
