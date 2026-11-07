# Phase C live chaos sweep

Widget: "AI Reply Drafts" v1 (generation trace `t_uw6ga7y7tqcy`), 20 runs on `/fixture-g2/?chaos=<seed>`.
Assist models: decide = fast (Haiku 5.5), create = inference (Sonnet 5.5), escalate = generation (Opus 5.5). Danger confirms were always answered **Block**.

| metric | value |
|---|---|
| intervention rate (runs with ≥1 agent intervention) | 60% (12/20) |
| interventions per run (mean) | 1.55 |
| branch-choice accuracy (label heuristic: choice fits an active fault) | 55% (16/29) |
| branch-choice effectiveness (chosen path fixed the step / correct stop) | 41% (12/29) |
| new-branch success (agent-written branch fixed the step) | 83% (10/12) (+0 create calls that produced no executable branch) |
| final-failure rate | 35% (7/20) |
| false success (run "completed" but wrong number of drafts — postcondition too weak) | 40% (8/20) |
| task success (expected drafts, 0 sent, 0 deleted) | 25% (5/20) |
| emails sent / deleted (must be 0) | 0 / 0 |
| danger-guard blocks | 0 |
| learned-branch offers | 10 |
| assist LLM calls | 48 (assist.decide: 34, assist.create: 11, assist.escalate: 3) |

| seed | faults | status | drafts | sent | interventions | decide choices | branch results | time | assist llm call ids |
|---|---|---|---|---|---|---|---|---|---|
| 1 | collapsed | completed | 2/2 | 0 | 4 | expand-collapsed-stub, new, expand-collapsed-stub, click-reply-again | expand-collapsed-stub:✗, reply-link-wait-then-retry-click:✓, expand-collapsed-stub:✗, click-reply-again:✓ | 50s | llm_ufzbo61y5cw1 llm_3iqs4p26e1xs llm_bu3353fh3s58 llm_aim5sg5g9mki |
| 2 | collapsed+popup | completed | 2/2 | 0 | 5 | new, expand-collapsed-stub, new, expand-collapsed-stub, click-reply-again | dismiss-promo-then-open-row:✓, expand-collapsed-stub:✗, reply-click-then-expand-composer-fallback:✓, expand-collapsed-stub:✗, click-reply-again:✓ | 66s | llm_8dlng5twqrri llm_a7efsbueukqn llm_evd1hozr6yr9 llm_ftidu9x18ccc |
| 3 | collapsed+renamed | failed | 1/2 | 0 | 4 | new, click-reply-again, keyboard-r | click-respond-link-open-composer:✗, expand-collapsed-composer-after-respond:✓, click-reply-again:✗, keyboard-r:✗ | 64s | llm_j17cv3zbllkz llm_0taqcxx5t41f llm_uph4598epv2m llm_bndtty56kbqo |
| 4 | collapsed+popup+renamed+slow | completed | 0/2 | 0 | 0 | – | – | 21s | – |
| 5 | popup+slow | completed | 0/2 | 0 | 0 | – | – | 21s | – |
| 6 | collapsed+renamed | failed | 1/2 | 0 | 4 | new, click-reply-again, keyboard-r | click-respond-link:✗, expand-collapsed-composer:✓, click-reply-again:✗, keyboard-r:✗ | 63s | llm_4x1subldcgbo llm_nauhmmnu80uk llm_x8evq5o30e9e llm_yk8mpjgek7qn |
| 7 | empty | failed | 0/0 | 0 | 1 | stop | – | 21s | llm_4sglo2a6fgl2 |
| 8 | popup | completed | 2/2 | 0 | 1 | new | dismiss-overlay-then-open-row:✓ | 23s | llm_tj4nju0hnunm llm_oo2hpg9rftlb |
| 9 | popup | completed | 2/2 | 0 | 1 | new | dismiss-promo-then-open-row:✓ | 25s | llm_ovl39lmfnlbp llm_u2vjk1k2yudx |
| 10 | popup | completed | 2/2 | 0 | 1 | new | dismiss-overlay-then-open-row:✓ | 23s | llm_dbhq2ig4vlge llm_h5ft3maxga44 |
| 11 | renamed | failed | 1/2 | 0 | 4 | click-reply-again, new, click-reply-again, keyboard-r | click-reply-again:✗, click-respond-link-open-composer:✓, click-reply-again:✗, keyboard-r:✗ | 54s | llm_qigmohnjls5t llm_dzrhqggzsrp3 llm_mmnxqzoca4qf llm_ekdtokhvlere |
| 12 | collapsed+slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 13 | collapsed+popup+renamed+slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 14 | renamed+slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 15 | slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 16 | collapsed+renamed+slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 17 | collapsed+renamed+slow | completed | 0/2 | 0 | 0 | – | – | 20s | – |
| 18 | renamed | failed | 0/2 | 0 | 2 | keyboard-r, click-reply-again | keyboard-r:✗, click-reply-again:✗ | 28s | llm_032aslr6y8d2 llm_rouxqmgagswh |
| 19 | empty | failed | 0/0 | 0 | 1 | stop | – | 20s | llm_pi8wvcwfmnhm |
| 20 | collapsed+renamed | failed | 1/2 | 0 | 3 | new, click-reply-again, keyboard-r | click-respond-link-open-composer:✓, click-reply-again:✗, keyboard-r:✗ | 51s | llm_i2abydlucwdj llm_yipvcn61i52h llm_5507ftove7t7 llm_vtwc27kk54v1 |

## Sample failure narratives
### seed 3 (collapsed+renamed) — trace `t_uw6ga7y7tqcy`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails (save as drafts, never send)
+0.0s Step "find-unread" started (Capture stable ids of the two most recent unread rows (tr.zA.zE) in the Inbox grid).
+0.0s   ✓ "find-unread" postcondition met: inbox visible and unread rows captured.
+0.0s Step "open-email-1" started (Open the unread email 'Q4 launch checklist' from the Inbox grid).
+0.0s   ✓ "open-email-1" postcondition met: message view is open.
+1.7s Step "open-reply-1" started (Open an editable reply composer for the open email).
+11.9s   ✗ "open-reply-1" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+14.8s   agent (decide, fast model) chose "new": The message view is open, but the reply control is now labeled "Respond" (role=link, aria-label="Respond") rather than Reply, so none of the listed branches match and clicking this control is a non-consequential way to open the composer.
+18.1s   agent (create, inference model) wrote new branch "click-respond-link-open-composer" (The open email shows a 'Respond' link (aria-label="Respond") instead of a Reply button, so the reply composer never open…): The DOM shows the reply entry point labelled 'Respond' rather than 'Reply', so the scripted step likely targeted the wrong label; clicking Respond should open the composer.
+18.1s   running branch "click-respond-link-open-composer" (create) — agent-written branch executed in the widget world.
+25.7s   branch "click-respond-link-open-composer" did not fix it: no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+25.7s   ✗ "open-reply-1" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared (error: Clicked Respond but no editable composer (textarea/contenteditable/role=textbox) appeared).
+35.4s   agent (escalate, generation model) wrote branch "expand-collapsed-composer-after-respond": The previous branch clicked Respond, which only rendered a collapsed composer stub ('Expand composer', aria-expanded=false) and never expanded it; this branch expands
[… 1898 chars …]
 composer (textarea/contenteditable/role=textbox) appeared.
+55.5s   ✗ "open-reply-2" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+56.7s   agent (decide, fast model) chose "keyboard-r": The message view shows a "Respond" span but no composer or textbox appeared after the click, and the r shortcut is an alternate, non-destructive way to open the reply composer.
+56.7s   running branch "keyboard-r" (pre-generated) — reply is reachable via the r keyboard shortcut.
+62.8s   branch "keyboard-r" did not fix it: no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+62.8s   ✗ "open-reply-2" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+62.8s   stopped: cap: 2 recovery attempts for step "open-reply-2" used
+62.8s FAILED at "open-reply-2": cap: 2 recovery attempts for step "open-reply-2" used
Why it broke: step "open-reply-2" never reached its postcondition (reply composer is editable); last observed: no editable reply composer (textarea/contenteditable/role=textbox) appeared. Agent's last diagnosis: The message view shows a "Respond" span but no composer or textbox appeared after the click, and the r shortcut is an alternate, non-destructive way to open the reply composer.. Stopped because: cap: 2 recovery attempts for step "open-reply-2" used.
DOM evidence (last observed, untrusted page content):
<div.nH role="main">
  <div id="app">
    <div.adn.ads role="main">
      <div.ajy role="button" aria-label="Back to Inbox" tabindex="0"> ←
      <div.T-I.nX role="button" aria-label="Delete" tabindex="0"> Delete
      <h2.hP> Dinner Saturday?
      <span.gD> Devon Cole
      <span.go> <devon@example.com>
      <div.a3s.aiL role="presentation"> Hey! A few of us are doing dinner Saturday at 7 at the usual spot. You in? Let m…
      <span.ams.bkH role="link" aria-label="Respond" tabindex="0"> Respond
```

### seed 6 (collapsed+renamed) — trace `t_uw6ga7y7tqcy`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails (save as drafts, never send)
+0.0s Step "find-unread" started (Capture stable ids of the two most recent unread rows (tr.zA.zE) in the Inbox grid).
+0.0s   ✓ "find-unread" postcondition met: inbox visible and unread rows captured.
+0.0s Step "open-email-1" started (Open the unread email 'Q4 launch checklist' from the Inbox grid).
+0.0s   ✓ "open-email-1" postcondition met: message view is open.
+2.0s Step "open-reply-1" started (Open an editable reply composer for the open email).
+12.2s   ✗ "open-reply-1" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+13.7s   agent (decide, fast model) chose "new": The DOM shows the open email with a "Respond" link (role=link, aria-label="Respond") that was not clicked, a control renamed from the expected reply button, so a new action targeting it may open the composer; none of the listed branches (collapsed stub, swallowed click, r shortcut) match this eviden…
+16.8s   agent (create, inference model) wrote new branch "click-respond-link" (The reply control is labelled 'Respond' (role=link) instead of 'Reply', so the reply composer never opened.): The DOM shows the reply affordance as a 'Respond' link, so clicking it should open the editable composer.
+16.8s   running branch "click-respond-link" (create) — agent-written branch executed in the widget world.
+24.4s   branch "click-respond-link" did not fix it: no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+24.4s   ✗ "open-reply-1" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared (error: Clicked Respond but no editable composer appeared).
+34.5s   agent (escalate, generation model) wrote branch "expand-collapsed-composer": The previous branch only re-clicked Respond, but the DOM shows the composer rendered as a collapsed stub ('Expand composer', aria-expanded=false) that must be clicked to reveal the editable field.
+34.5s   running branch "expand-collapsed-composer" (escalate) — agent-written bra
[… 1768 chars …]
.
+54.7s   ✗ "open-reply-2" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+55.8s   agent (decide, fast model) chose "keyboard-r": The message view shows a 'Respond' control but no composer appeared after the click, and the 'click-reply-again' branch was already tried, so the r shortcut is the remaining listed path to reach the reply.
+55.8s   running branch "keyboard-r" (pre-generated) — reply is reachable via the r keyboard shortcut.
+61.9s   branch "keyboard-r" did not fix it: no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+61.9s   ✗ "open-reply-2" expected reply composer is editable but observed no editable reply composer (textarea/contenteditable/role=textbox) appeared.
+61.9s   stopped: cap: 2 recovery attempts for step "open-reply-2" used
+61.9s FAILED at "open-reply-2": cap: 2 recovery attempts for step "open-reply-2" used
Why it broke: step "open-reply-2" never reached its postcondition (reply composer is editable); last observed: no editable reply composer (textarea/contenteditable/role=textbox) appeared. Agent's last diagnosis: The message view shows a 'Respond' control but no composer appeared after the click, and the 'click-reply-again' branch was already tried, so the r shortcut is the remaining listed path to reach the reply.. Stopped because: cap: 2 recovery attempts for step "open-reply-2" used.
DOM evidence (last observed, untrusted page content):
<div.nH role="main">
  <div id="app">
    <div.adn.ads role="main">
      <div.ajy role="button" aria-label="Back to Inbox" tabindex="0"> ←
      <div.T-I.nX role="button" aria-label="Delete" tabindex="0"> Delete
      <h2.hP> Dinner Saturday?
      <span.gD> Devon Cole
      <span.go> <devon@example.com>
      <div.a3s.aiL role="presentation"> Hey! A few of us are doing dinner Saturday at 7 at the usual spot. You in? Let m…
      <span.ams.bkH role="link" aria-label="Respond" tabindex="0"> Respond
```

### seed 7 (empty) — trace `t_uw6ga7y7tqcy`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails (save as drafts, never send)
+0.0s Step "find-unread" started (Capture stable ids of the two most recent unread rows (tr.zA.zE) in the Inbox grid).
+6.1s   ✗ "find-unread" expected inbox visible and unread rows captured but observed Inbox grid (table[role=grid][aria-label=Inbox]) not visible.
+7.3s   agent (decide, fast model) chose "stop": The DOM shows an empty-inbox status message ('Your inbox is empty. No new mail!') with no grid or unread rows to capture, so the goal cannot be achieved here.
+7.3s FAILED at "find-unread": agent stopped: The DOM shows an empty-inbox status message ('Your inbox is empty. No new mail!') with no grid or unread rows to capture, so the goal cannot be achieved here.
Why it broke: step "find-unread" never reached its postcondition (inbox visible and unread rows captured); last observed: Inbox grid (table[role=grid][aria-label=Inbox]) not visible. Agent's last diagnosis: The DOM shows an empty-inbox status message ('Your inbox is empty. No new mail!') with no grid or unread rows to capture, so the goal cannot be achieved here.. Stopped because: agent stopped: The DOM shows an empty-inbox status message ('Your inbox is empty. No new mail!') with no grid or unread rows to capture, so the goal cannot be achieved here..
DOM evidence (last observed, untrusted page content):
<div.nH role="main">
  <div id="app">
    <div.TC role="status"> Your inbox is empty. No new mail!
```
