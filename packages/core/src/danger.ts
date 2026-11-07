/**
 * Decision B runtime danger classifier (send/delete/publish/buy…). Pure: no chrome.* / node / fastify imports.
 * The prelude embeds `DANGER_TEXT_RE.source` / `DANGER_ROUTE_RE.source` so page-side and unit-tested logic agree.
 */
import type { DangerVerdict } from '@app/contracts';

/** Words that make a user-visible control consequential when clicked by a script. Whole-word, case-insensitive. */
export const DANGER_WORDS = [
  'send', 'delete', 'remove', 'publish', 'post', 'buy', 'pay', 'purchase', 'checkout', 'place order', 'submit',
  'transfer', 'archive', 'trash', 'unsubscribe', 'discard', 'erase', 'destroy', 'deploy', 'tweet', 'donate',
  'book now', 'cancel subscription', 'close account', 'empty trash', 'mark as spam', 'report spam',
] as const;

/** Benign phrases that contain a danger word but are drafting/navigation affordances. */
export const SAFE_PHRASES_RE = /\b(save (as )?draft|draft saved|discard changes to (the )?filter)\b/i;

export const DANGER_TEXT_RE = new RegExp(`\\b(${DANGER_WORDS.map(w => w.replace(/ /g, '\\s+')).join('|')})(s|es|ed|ing)?\\b`, 'i');

/** Route segments of send-like / destructive endpoints. */
export const DANGER_ROUTE_RE = /(^|[\/_\-.?=&])(send|delete|remove|destroy|publish|post(ing)?s?\/new|purchase|checkout|pay(ment)?s?|transfer|order|trash|unsubscribe|deploy)([\/_\-.?=&]|$)/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Classify a control by its visible text / aria-label / title / value. */
export function classifyDangerText(...labels: Array<string | null | undefined>): DangerVerdict {
  for (const raw of labels) {
    if (!raw) continue;
    const t = clean(raw);
    if (!t || SAFE_PHRASES_RE.test(t)) continue;
    // long text blocks (e.g. a whole email row) are not a control label → only consider short labels
    if (t.length > 60) continue;
    const m = t.match(DANGER_TEXT_RE);
    if (m) return { dangerous: true, matched: m[0], reason: `control "${t}" looks consequential ("${m[0]}")` };
  }
  return { dangerous: false };
}

/** Classify a network call made via WidgetAI.net: DELETE always; other mutating methods when the route is send-like. */
export function classifyNetRequest(method: string | undefined, url: string): DangerVerdict {
  const m = (method ?? 'GET').toUpperCase();
  if (m === 'DELETE') return { dangerous: true, matched: 'DELETE', reason: `DELETE ${clean(url)}` };
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { dangerous: false };
  let path = url;
  try { const u = new URL(url, 'http://x.invalid'); path = u.pathname + u.search; } catch { /* keep raw */ }
  const r = path.match(DANGER_ROUTE_RE);
  if (r) return { dangerous: true, matched: r[2], reason: `${m} to send-like route ${clean(path)}` };
  return { dangerous: false };
}
