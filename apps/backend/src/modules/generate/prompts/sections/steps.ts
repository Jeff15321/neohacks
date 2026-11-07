/** Generator prompt section — owner: Phase C (WidgetAI.step / expect postconditions / 2-3 branches per fragile step). */
export const stepsSection = `=== SELF-HEALING STEPS (WidgetAI.run / WidgetAI.step) — REQUIRED for any multi-step page automation ===
Write page automation as a sequence of checked steps. The platform runs your script first and only calls a recovery
agent when a step's postcondition fails, so every step MUST declare what success looks like.

  const res = await WidgetAI.run(goal, async (state) => { ...steps...; return state; })
      -> { ok, state, error?, narrative? }. One run per user action (e.g. inside the button click handler).
         On failure the platform already showed the user a narrative of what broke; you should call
         WidgetAI.status('failed', res.narrative || res.error), else WidgetAI.status('completed', summary).
  state = await WidgetAI.step(name, {
      goal: 'one sentence: what this step achieves',        // shown to the recovery agent
      run: async (state, h) => { ...; return state },         // the scripted path; return the updated JSON state
      expect: { ...postcondition... },                         // REQUIRED
      branches: [ { id: 'kebab-id', when: 'page condition this handles', run: async (state, h) => state }, ... ],
      multiOutcome: false,  // true only when the page legitimately has several outcomes the agent must pick between
      region: 'css selector of the relevant region (optional, focuses the DOM evidence the agent sees)',
      timeoutMs: 6000,      // how long the postcondition may take to become true
  })
  - state is plain JSON passed explicitly from step to step (never rely on closures for data the recovery agent
    needs; agent-written branches only receive (state, h)). Keep it small (ids, extracted text).
    Between steps, MUTATE the object returned by the last step (state.x = …); do not replace it with a new object
    (or pass it explicitly: WidgetAI.step(name, { state, run, expect })). Steps return the new run state.
  - expect kinds (all listed must hold; polled until timeoutMs):
      { exists: 'selector' } · { gone: 'selector' } · { count: { selector, min } } · { text: { selector, match: 'regex' } }
      { textChanged: 'selector' } · { net: { method: 'POST', path: '/drafts' } } (2xx since the step began; needs "network")
      { check: (state, h) => true | 'what was observed instead', description: 'human text' }
  - h = WidgetAI.helpers: h.$(sel), h.$$(sel), h.findByText(re, root?), h.click(el), h.typeText(el, text),
    h.waitFor(fn, ms), h.sleep(ms), h.visible(el), h.text(sel), h.label(el). Use them in run/branches.
  - Aim for 2-3 branches for every FRAGILE step (anything that clicks UI that may be renamed, collapsed, delayed,
    or covered: popups/interstitials, collapsed composers/sections, "show more" toggles, lazy lists, alternative
    labels). Accuracy first: bloat is acceptable. Each branch must make the SAME postcondition true.
  - Steps must be idempotent: if the postcondition is already true, do not act again (no duplicate drafts).
  - Postconditions must POSITIVELY confirm success. Never accept "nothing found" as success just because elements
    are missing (the page may still be loading); accept an empty result only when the page shows an explicit empty
    state (e.g. an "inbox is empty" message) — otherwise fail so the platform can wait/recover.
  - Give per-item steps a stable name plus index (e.g. 'open-reply-1', 'open-reply-2'): branches the agent learns for
    one item are re-used for the others.
  - Never put sending/deleting/publishing/paying into a step or branch; a runtime danger guard blocks script
    clicks on such controls and asks the user to Allow/Block.
  - Non-DOM work (WidgetAI.inference calls, building UI) happens between steps, not inside expect checks.`;
