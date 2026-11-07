import type { NetOpSummary } from '@app/contracts';

/**
 * Generator prompt section — owner: Phase E (doc §4 items 3–5): op analysis fields, verification tiers,
 * `reportVerified`, and the network-vs-DOM strategy rule.
 */
export const networkSection = `=== NETWORK OP ANALYSIS, VERIFICATION TIERS, STRATEGY (grant "network") ===
Each op from WidgetAI.net.operations() (and in OBSERVED NETWORK OPERATIONS) may also carry:
  { stepId?, attribution: 'step'|'window', tier: 'observed'|'replayed'|'verified', browserOnly?,
    analysis: { template, templateKey, captures, mutating, tokenFields[], paramFields[],
                dependsOn: [{ field, opId, fromTemplate, path }], clientIdFields[], idempotencyHint? } }
- template: route template ("/repos/:repo/:repo2/issues/:n"). Match ops at runtime by method + template/path.
- tokenFields ("body.csrf", "header.x-csrf-token", "query.page_token"): dynamic values (csrf, session, request
  ids). Shown as "[REDACTED]" — never invent or hardcode them; mergeBody keeps the captured raw values.
- dependsOn: the field's value came from an EARLIER response (op opId / template fromTemplate, at JSON path
  "path"; "header:<name>" = a response header). Tokens may be single-use or rotate, so a verbatim replay can
  fail (403/419). Re-fetch the dependency FIRST: invoke the dependency op (find it at runtime by fromTemplate,
  or by opId) — only if it is a GET — parse its result.bodyText (RAW, unredacted) as JSON, read the value at
  "path", and pass it in the replay: "body.<k>" → mergeBody { <k>: value }; "header.<h>" → headers { <h>: value };
  "query.<q>" → rebuild the url.
- clientIdFields / idempotencyHint (mutating ops): send a FRESH client id per replay; never retry a mutation
  blindly — read back first.
- tier: observed (captured by the page probe and browser-confirmed) → replayed (the platform saw a replay return
  2xx with a response shaped like the original) → verified (a widget run read back its success criterion).
- WidgetAI.net.reportVerified(opId, evidence) -> Promise<{ verified, tier, error? }> (grant "network")
  - Call it ONCE after your read-back confirms the op had its intended effect, with the id of the op you
    invoked and evidence { readBack: "GET /api/drafts contains 'X'" }. It is refused (verified:false)
    unless the platform saw that op template replay successfully — it never throws for a refusal.
- browserOnly ops were seen by the browser only (worker / early requests): no bodies, NOT replayable.

STRATEGY RULE (choose per sub-task, state the choice in "plan"):
- NETWORK when the op is confirmed:true, its template and parameters are understood (JSON / GraphQL /
  urlencoded body, few tokenFields, every token field either preserved by mergeBody or resolvable via dependsOn),
  AND the success criterion can be read back (a GET op/endpoint or the DOM shows the result).
- DOM when payloads are opaque or positional (batched arrays like Gmail's, binary/protobuf, many unexplained
  token fields), the op is unconfirmed/browserOnly, or no op was captured for the action.
- HYBRID: DOM for reading/confirming state, network for the mutation (or vice versa).
- Network-first code MUST keep a DOM fallback: if the dependency re-fetch, the invoke (res.ok false / 4xx /
  5xx) or the read-back fails, log why and perform the same task via the DOM (without duplicating work that
  the read-back shows already succeeded). Only call reportVerified after a successful read-back; never report
  success on a failed response.
- Mutating ops are exercised only inside the user-approved widget run; never invoke send/delete/publish/pay
  endpoints even if captured.`;

/** One-line rendering of an op's analysis + tier for the generator user prompt (field names only — no raw values). */
export function renderNetOpAnalysis(o: NetOpSummary): string {
  const bits: string[] = [];
  if (o.tier) bits.push(`tier ${o.tier}`);
  if (o.stepId) bits.push(`step ${o.stepId}`);
  const a = o.analysis;
  if (a) {
    bits.push(`template ${a.templateKey}${a.captures > 1 ? ` (${a.captures} captures)` : ''}`);
    if (a.tokenFields.length) bits.push(`tokenFields ${a.tokenFields.slice(0, 8).join(',')}`);
    if (a.paramFields.length) bits.push(`paramFields ${a.paramFields.slice(0, 8).join(',')}`);
    for (const d of a.dependsOn.slice(0, 4)) bits.push(`dependsOn ${d.field} ← ${d.fromTemplate} [${d.opId}] .${d.path}`);
    if (a.clientIdFields.length) bits.push(`clientIdFields ${a.clientIdFields.join(',')}`);
  }
  return bits.length ? `· ${bits.join(' · ')}` : '';
}
