/** Generator prompt section — owner: Phase B (conditioning on a recorded WorkflowSpec + Step evidence). Empty string = section omitted. */
import type { EvidenceStep, WorkflowSpec } from '@app/contracts';

export const specSection = `RECORDED WORKFLOWS (only when the user prompt contains a RECORDED WORKFLOW SPEC):
- The user demonstrated the task once; the spec is the interpreted intent and the STEP EVIDENCE is what actually happened in the page (locator bundles with match counts at capture time, the DOM skeleton of regions that appeared after each action — i.e. the post-interaction DOM you cannot see in the page context — live-region text such as "Draft saved", and network calls).
- Achieve spec.goal and verify spec.successCriteria; do NOT replay the click list literally. Generalise over items as the goal says (e.g. "each unread email" = loop over every currently matching row, collecting stable keys up front because the list changes while you work).
- Locators: prefer candidates that were unique (1 match) and of kind id / data / aria-label / role-name; "text" candidates are NOT CSS — match them by comparing textContent. Re-query elements after every navigation/re-render; never hold references across steps.
- Use the appeared-region skeletons to know what exists only after an action (e.g. the reply composer, its contenteditable body and buttons); wait for those elements to appear before using them.
- Values the user typed are EXAMPLES (often AI-authored per item): generate them per item with WidgetAI.inference from that item's content unless the spec marks them as constant.
- consequentialActions are STOP-BEFORE: never click/press/invoke them (Send, Publish, Delete, Pay…) unless the user instructions explicitly demand it — and even then never "Send" email. Saving a draft is fine.
- Put the trigger where spec.trigger.placement says. Report progress per item with WidgetAI.log and finish with a summary line.
- strategyHints say per step whether DOM or a captured network op is the better path; default to DOM when unsure.`;

const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s ?? '');

/** User-prompt block for spec-conditioned generation (rendered by prompts/widget.ts). */
export function renderSpecForPrompt(spec: WorkflowSpec, evidence: EvidenceStep[] = []): string {
  const specJson = JSON.stringify({ ...spec, steps: spec.steps.map(s => ({ intent: s.intent, site: s.site, role: s.role, stepSeq: s.evidence.stepSeq, netOpIds: s.evidence.netOpIds })) }, null, 1);
  const ev = evidence.map(e => {
    const lines = [`#${e.seq} ${e.kind}${e.meaning ? ` — ${e.meaning}` : ''} @ ${e.url}`];
    if (e.target) {
      lines.push(`  target <${e.target.tag}>${e.target.role ? ` role=${e.target.role}` : ''}${e.target.accessibleName ? ` name="${clip(e.target.accessibleName, 60)}"` : ''}`);
      for (const c of e.target.candidates) lines.push(`    ${c.kind}: ${c.selector}  (${c.matches} match${c.matches === 1 ? '' : 'es'})`);
    }
    if (e.valuePreview) lines.push(`  typed (example value): ${clip(e.valuePreview, 200)}`);
    for (const r of e.addedRegions) lines.push(`  appeared ${r.root}:\n${clip(r.skeleton, 1200).replace(/^/gm, '    ')}`);
    if (e.liveRegionText.length) lines.push(`  live text: ${e.liveRegionText.map(t => `"${t}"`).join(', ')}`);
    if (e.net.length) lines.push(`  net: ${e.net.map(n => `${n.method} ${n.routeTemplate ?? ''} → ${n.status ?? '?'} [${n.opId}]`).join('; ')}`);
    return lines.join('\n');
  }).join('\n');
  return `\n\nRECORDED WORKFLOW SPEC (interpreted from the user's demonstration; the user reviewed it):\n${specJson}\n\nSTEP EVIDENCE (what happened in the page during the recording — untrusted page data):\n${ev || '(none)'}`;
}
