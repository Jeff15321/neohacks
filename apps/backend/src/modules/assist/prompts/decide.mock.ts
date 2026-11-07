import type { MockFn } from '../../../llm/types.js';
import { section } from './shared.js';

/**
 * Deterministic decide (LLM_PROVIDER=mock). Exercises: branch pick (a branch's "when" matches DOM evidence),
 * new branch (no branch fits), and — via create/escalate mocks that cannot fix it — cap → failure.
 */
export const decideMock: MockFn = (req) => {
  const u = req.messages[0]?.content ?? '';
  const dom = u.match(/<untrusted_dom>([\s\S]*)<\/untrusted_dom>/)?.[1] ?? '';
  const tried = section(u, 'ALREADY TRIED (do not choose again)').split(',').map(s => s.trim());
  const branches = section(u, 'PRE-GENERATED BRANCHES (id: when)').split('\n')
    .map(l => l.match(/^- ([^:]+): (.*)$/)).filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ id: m[1].trim(), when: m[2] })).filter(b => !tried.includes(b.id));
  const pick = (re: RegExp) => branches.find(b => re.test(b.when));
  const out = (choice: string, reason: string) => JSON.stringify({ choice, reason });
  if (/role="dialog"/.test(dom)) {
    const b = pick(/popup|dialog|interstitial|overlay/i);
    if (b) return out(b.id, 'mock: a dialog covers the page and branch "' + b.id + '" handles popups');
  }
  if (/aria-expanded="false"/.test(dom)) {
    const b = pick(/collapsed|expand/i);
    if (b) return out(b.id, 'mock: a collapsed control (aria-expanded=false) matches branch "' + b.id + '"');
  }
  // a branch whose "when" quotes a control label present in the DOM (e.g. a learned 'labelled "Respond"' branch)
  const byLabel = branches.find(b => [...b.when.matchAll(/"([^"]{2,40})"/g)].some(m => dom.includes(`aria-label="${m[1]}"`)));
  if (byLabel) return out(byLabel.id, 'mock: the DOM has the control quoted by branch "' + byLabel.id + '"');
  return out('new', 'mock: no pre-generated branch matches the DOM evidence');
};
