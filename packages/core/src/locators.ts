/**
 * §3 LocatorBundle construction + ranking (owner: Phase B), modelled on Chrome DevTools Recorder: several candidate
 * selectors per target, each with its match count at capture time. Pure: the DOM is abstracted as `ElementInfo` +
 * a `count(selector)` callback supplied by the content script.
 *
 * Every `selector` except kind `text` is a STANDARD CSS selector (generated code may only use standard CSS).
 * `text` candidates are encoded as `<tagOrRoleSelector> >> text="…"`, and must be matched by text comparison.
 */
import type { LocatorBundle, LocatorCandidate } from '@app/contracts';

export interface ElementInfo {
  tag: string;
  id?: string;
  dataAttrs?: Record<string, string>;
  role?: string;
  ariaLabel?: string;
  /** Accessible name (aria-label, else label/title/text). */
  accessibleName?: string;
  text?: string;
  /** Short CSS path computed by the content script (tag + stable classes + :nth-of-type, ≤4 levels). */
  cssPath?: string;
  landmarkPath?: string;
}

/** Minimal CSS.escape for identifiers (CSS.escape is unavailable in node). */
export function cssEscapeIdent(s: string): string {
  return s.replace(/^(\d)/, '\\3$1 ').replace(/([^\w-])/g, '\\$1');
}
const attrValue = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Ids like "ember123", ":r5:", "a1b2c3d4e5" are framework-generated and unstable across loads. */
export function looksGeneratedId(id: string): boolean {
  if (/^:/.test(id) || /^(ember|react|ext-gen|yui_|mui-|radix-)/i.test(id)) return true;
  const digits = (id.match(/\d/g) ?? []).length;
  return id.length >= 6 && digits / id.length > 0.3;
}

/** Utility/obfuscated class names are fine for CSS paths only when short and not hash-like. */
export function isStableClass(c: string): boolean {
  return /^[A-Za-z][\w-]{0,30}$/.test(c) && !/^(is-|has-|ng-|css-|sc-|jsx-)/.test(c) && !/\d{3,}/.test(c) && c !== 'active' && c !== 'selected' && c !== 'hover' && c !== 'focus';
}

const KIND_PRIORITY: Record<LocatorCandidate['kind'], number> = { id: 0, data: 1, 'aria-label': 2, 'role-name': 3, css: 4, text: 5 };

/** Unique (matches===1) first, then by kind priority, then fewer matches; zero-match candidates last. */
export function rankCandidates(c: LocatorCandidate[]): LocatorCandidate[] {
  const score = (x: LocatorCandidate) => (x.matches === 0 ? 1000 : x.matches === 1 ? 0 : 100 + Math.min(x.matches, 99)) + KIND_PRIORITY[x.kind] * 1.01;
  return [...c].sort((a, b) => score(a) - score(b));
}

export function buildLocatorBundle(el: ElementInfo, count: (selector: string, kind: LocatorCandidate['kind']) => number): LocatorBundle {
  const out: LocatorCandidate[] = [];
  const push = (kind: LocatorCandidate['kind'], selector: string) => {
    if (!selector || out.some(o => o.selector === selector)) return;
    let matches = 0;
    try { matches = count(selector, kind); } catch { return; } // invalid selector
    out.push({ kind, selector, matches });
  };
  const tag = el.tag.toLowerCase();
  if (el.id && !looksGeneratedId(el.id)) push('id', `#${cssEscapeIdent(el.id)}`);
  for (const [k, v] of Object.entries(el.dataAttrs ?? {}).slice(0, 3)) {
    if (!/^data-[\w-]+$/.test(k) || v.length > 80) continue;
    push('data', `${tag}[${k}="${attrValue(v)}"]`);
  }
  if (el.ariaLabel) push('aria-label', `[aria-label="${attrValue(el.ariaLabel.slice(0, 80))}"]`);
  if (el.role) push('role-name', el.ariaLabel ? `[role="${el.role}"][aria-label="${attrValue(el.ariaLabel.slice(0, 80))}"]` : `[role="${el.role}"]`);
  if (el.cssPath) push('css', el.cssPath);
  const text = el.text?.trim().replace(/\s+/g, ' ');
  if (text && text.length <= 60) push('text', `${el.role ? `[role="${el.role}"]` : tag} >> text="${attrValue(text)}"`);
  return {
    candidates: rankCandidates(out).slice(0, 6),
    tag,
    role: el.role,
    accessibleName: el.accessibleName?.slice(0, 120),
    landmarkPath: el.landmarkPath,
  };
}

/** Best selector for prompts/UI: the top-ranked unique CSS candidate, else the top candidate. */
export function bestSelector(b: LocatorBundle | undefined): string | undefined {
  if (!b?.candidates.length) return undefined;
  return (b.candidates.find(c => c.matches === 1 && c.kind !== 'text') ?? b.candidates[0]).selector;
}
