/** Generator prompt section — owner: Phase F (bundle parts + WidgetAI.flow, doc §5). Frozen text (cached). */
export const flowSection = `=== CROSS-SITE FLOWS: bundle "parts" + WidgetAI.flow (grant "flow") ===
Use this ONLY when the task must act on a SECOND website (e.g. "create a Jira ticket from this GitHub issue"). Otherwise
return "parts": [] and never mention WidgetAI.flow.
A bundle = the HOME part (top-level "code" + "matchPatterns": the site the user starts on) + "parts": one entry per other
site: { role, matchPatterns, code, entryUrl, handlers }.
  - role: lowercase slug, e.g. "jira-sink". handlers: the handler names the part registers, e.g. ["createTicket"].
  - matchPatterns: CONCRETE hosts of that site only (e.g. "*://*.atlassian.net/*"); never "*://*/*". The user approves
    every origin the bundle touches, so keep each list minimal. Home patterns must not include the part's sites.
  - entryUrl: the page to open on that site when no tab is already open there (must match the part's matchPatterns);
    use the URL seen in the recording/evidence. "" only when the user will always have the tab open.
  - Each part's code is validated exactly like the home code (same banned constructs, same selector rules, same
    danger guard at runtime).
Home part API:
  const result = await WidgetAI.flow.call(role, handler, input, { openUrl?, reuseTab: true, activate: true });
    - input: a small JSON object with everything the sink needs (read it from the home page first).
    - Rejects with a reason when the target tab is closed, the run times out, is cancelled, or the sink fails —
      catch it and show the reason in the widget UI. Leave activate:true (background tabs are throttled).
    - Use literal role/handler strings; they must exist in "parts".
Sink part API (in the part's code, top level):
  WidgetAI.flow.handle('createTicket', async (input, ctx) => { ...; return { ok: true, evidence: { url, id, text } }; });
    - ctx.resumeState: the last checkpoint (null on the first injection). ctx.checkpoint(state) BEFORE any action that
      navigates or reloads the page (form submit, link click, location change): the page script dies, the platform
      re-injects the part after the load with ctx.resumeState = state. Branch on resumeState first so a resumed run
      never repeats a create/submit.
    - await ctx.cancelled() before the consequential action; stop (throw) if true.
    - SUCCESS MUST BE READ BACK: return ok:true only after you saw the created item on the target site (its page,
      key/id, or the list showing it), with evidence.url (link the home shows) and evidence.id/text. Otherwise return
      { ok: false, evidence, error } — the home promise then rejects.
    - Only one handler call per invocation; never call WidgetAI.flow.call from a part.
Grants: add "flow" (plus whatever else the home/part code uses — grants are shared by all parts).
Safety: creating a ticket/issue/note on the user's own tracker is allowed; anything that sends, publishes, deletes,
pays or notifies OTHER people still goes through the danger guard and must be listed in "consequentialActions" — also
list the cross-site create ("Creates a ticket in <site>") there so the approval card shows it.
The home widget must show the evidence.url as a link after success.`;
