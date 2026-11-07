# Phase C live chaos sweep

Widget: "AI Reply Drafts" v1 (generation trace `t_pqbx5qhr6bmq`), 20 runs on `/fixture-g2/?chaos=<seed>`.
Assist models: decide = fast (Haiku 5.5), create = inference (Sonnet 5.5), escalate = generation (Opus 5.5). Danger confirms were always answered **Block**.

| metric | value |
|---|---|
| intervention rate (runs with ≥1 agent intervention) | 95% (19/20) |
| interventions per run (mean) | 1.90 |
| branch-choice accuracy (label heuristic: choice fits an active fault) | 70% (21/30) |
| branch-choice effectiveness (chosen path fixed the step / correct stop) | 40% (12/30) |
| new-branch success (agent-written branch fixed the step) | 19% (4/21) (+0 create calls that produced no executable branch) |
| final-failure rate | 65% (13/20) |
| false success (run "completed" but wrong number of drafts — postcondition too weak) | 0% (0/20) |
| task success (expected drafts, 0 sent, 0 deleted) | 35% (7/20) |
| emails sent / deleted (must be 0) | 0 / 0 |
| danger-guard blocks | 0 |
| learned-branch offers | 4 |
| assist LLM calls | 51 (assist.decide: 30, assist.create: 13, assist.escalate: 8) |

| seed | faults | status | drafts | sent | interventions | decide choices | branch results | time | assist llm call ids |
|---|---|---|---|---|---|---|---|---|---|
| 1 | collapsed | completed | 2/2 | 0 | 2 | expand-collapsed-editor, expand-collapsed-editor | expand-collapsed-editor:✓, expand-collapsed-editor:✓ | 44s | llm_kr9bcvfbpt92 llm_bk7rwe3lwhl4 |
| 2 | collapsed+popup | completed | 2/2 | 0 | 4 | click-subject-cell, new, expand-collapsed-editor, expand-collapsed-editor | click-subject-cell:✗, dismiss-promo-dialog-then-open-row:✓, expand-collapsed-editor:✓, expand-collapsed-editor:✓ | 73s | llm_ol4z36f1v968 llm_c801au3znnhz llm_jum96tk9hoj3 llm_urb1k5l0992t |
| 3 | collapsed+renamed | failed | 0/2 | 0 | 2 | new | open-reply-via-respond-link:✗, verify-target-then-reopen-from-inbox:✗ | 50s | llm_ai83o1gki438 llm_vnl6kvce83a9 llm_9t4a3sbp6ff9 |
| 4 | collapsed+popup+renamed+slow | failed | 0/2 | 0 | 2 | click-subject-cell, stop | click-subject-cell:✗ | 21s | llm_qvf180kmezo7 llm_p71jsmnifjuh |
| 5 | popup+slow | completed | 2/2 | 0 | 2 | click-subject-cell, new | click-subject-cell:✗, dismiss-promo-dialog-then-open-row:✓ | 49s | llm_j1jg4gulc4uz llm_0bpaco87mka0 llm_bf22xmvpe85h |
| 6 | collapsed+renamed | failed | 0/2 | 0 | 2 | new | reply-control-labeled-respond:✗, back-to-inbox-then-open-target-row:✗ | 43s | llm_c3ctraxu81sl llm_5vqberlr0haw llm_gwv3ga1qxx9f |
| 7 | empty | failed | 0/0 | 0 | 1 | stop | – | 21s | llm_9njqcf0w8vzo |
| 8 | popup | completed | 2/2 | 0 | 2 | click-subject-cell, new | click-subject-cell:✗, dismiss-promo-dialog-then-open-row:✓ | 44s | llm_d8fauuuf65db llm_ajhjl8uqeheb llm_ow4j24xolslw |
| 9 | popup | completed | 2/2 | 0 | 2 | click-subject-cell, new | click-subject-cell:✗, dismiss-promo-dialog-then-open-row:✓ | 44s | llm_87iug10hq3cf llm_santql2l4sqh llm_ivkhqvmd6adb |
| 10 | popup | failed | 0/2 | 0 | 2 | click-subject-cell, stop | click-subject-cell:✗ | 21s | llm_3yw7tcl92w1f llm_ookmq9h9ro68 |
| 11 | renamed | failed | 0/2 | 0 | 2 | new | open-message-already-open-respond-label:✗, reopen-target-message-by-legacy-id:✗ | 45s | llm_hn5jv7segob5 llm_puri0wenh2jm llm_vfkwwapau856 |
| 12 | collapsed+slow | completed | 2/2 | 0 | 2 | expand-collapsed-editor, expand-collapsed-editor | expand-collapsed-editor:✓, expand-collapsed-editor:✓ | 49s | llm_gzeh8z9629lg llm_txhqlg3q9agu |
| 13 | collapsed+popup+renamed+slow | failed | 0/2 | 0 | 2 | click-subject-cell, new | click-subject-cell:✗, dismiss-promo-dialog-then-open-row:✗ | 41s | llm_19yaaukip9wn llm_6swvpzfg9608 llm_iz3tyww6t4ca |
| 14 | renamed+slow | failed | 0/2 | 0 | 2 | new | reply-control-is-respond-link:✗, verify-target-and-reopen-by-legacy-id:✗ | 51s | llm_r01tmftswtae llm_hauthx9x6ysg llm_1chub7ccwstg |
| 15 | slow | completed | 2/2 | 0 | 0 | – | – | 25s | – |
| 16 | collapsed+renamed+slow | failed | 0/2 | 0 | 2 | new | open-message-reply-renamed-respond:✗, verify-target-message-or-reopen-by-legacy-id:✗ | 46s | llm_hzjm2m9zfd1v llm_rddx2glev59t llm_ydtxiojdvcl8 |
| 17 | collapsed+renamed+slow | failed | 0/2 | 0 | 2 | new | reply-control-labeled-respond:✗, reopen-target-message-by-legacy-id:✗ | 48s | llm_tmiw5s8vhh7b llm_l8gv1czkijks llm_bpxc0j83kfp2 |
| 18 | renamed | failed | 0/2 | 0 | 2 | new | open-reply-via-respond-link:✗, verify-open-message-or-reopen-row:✗ | 48s | llm_lxxw8waxqw9y llm_uyw6ce9e7qbb llm_stiwtxmg1jvm |
| 19 | empty | failed | 0/0 | 0 | 1 | stop | – | 20s | llm_q3x8lh2iwnkb |
| 20 | collapsed+renamed | failed | 0/2 | 0 | 2 | new | open-thread-reply-via-respond-link:✗, verify-target-or-reopen-by-legacy-id:✗ | 48s | llm_eyo2t8f3389l llm_clfxq1aimi21 llm_ow32v9x8kpg9 |

## Sample failure narratives
### seed 3 (collapsed+renamed) — trace `t_pqbx5qhr6bmq`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails and save them as drafts (never send)
+0.0s Step "find-unread" started (Record the stable message ids and subjects of the two most recent unread inbox rows (tr.zA.zE)).
+0.0s   ✓ "find-unread" postcondition met: unread message ids captured, or the inbox is loaded and has no unread rows.
+0.0s Step "open-message-1" started (Open the unread email with this data-legacy-message-id so its text and a Reply control are visible).
+6.1s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=false.
+7.8s   agent (decide, fast model) chose "new": The message view for "Q4 launch checklist" is open with a "Respond" link and a "Back to Inbox" control, but no Reply control is shown; neither listed branch fits, since the row is not hidden behind another composer and the subject click path is already done, so a different DOM action on the open mes…
+11.6s   agent (create, inference model) wrote new branch "open-reply-via-respond-link" (The target email is already open in the reading pane, but the Reply control is labelled 'Respond' (a role=link span) ins…): The message is already open showing the subject, and the reply control is exposed as 'Respond' (role=link), so the step just needs to recognize it rather than click the inbox row again.
+11.6s   running branch "open-reply-via-respond-link" (create) — agent-written branch executed in the widget world.
+17.7s   branch "open-reply-via-respond-link" did not fix it: no Reply control next to this subject yet; inbox rows visible=false.
+17.7s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=false.
+42.9s   agent (escalate, generation model) wrote branch "verify-target-then-reopen-from-inbox": The previous branch only checked that some message was open with a Respond link (the open view shows 'Q4 launch checklist'), never checking it against the target id or subject from state, so it most l…
+42.9s   running branch "verify-target-then-reopen-from-inbox" (escalate) — agent-written branch executed in the widget world.
+49.0s   branch "verify-target-then-reopen-from-inbox" did not fix it: no Reply control next to this subject yet; inbox rows visible=false.
+49.0s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=false.
+49.0s   stopped: cap: 2 recovery attempts for step "open-message-1" used
+49.0s FAILED at "open-message-1": cap: 2 recovery attempts for step "open-message-1" used
Why it broke: step "open-message-1" never reached its postcondition (a Reply control is visible and the page shows this email subject); last observed: no Reply control next to this subject yet; inbox rows visible=false. Agent's last diagnosis: The previous branch only checked that some message was open with a Respond link (the open view shows 'Q4 launch checklist'), never checking it against the target id or subject from state, so it most likely accepted the wrong email; this branch checks for a match and otherwise goes back to the inbox …. Stopped because: cap: 2 recovery attempts for step "open-message-1" used.
DOM evidence (last observed, untrusted page content):
<div.G-atb role="toolbar" aria-label="Main">
  <span.gb_d> HardMail
  <button.T-I aria-label="Compose"> Compose
  <button.T-I id="drafts-nav"> Drafts ()
    <span id="dcount"> 0
<div.nH role="main">
  <div id="app">
    <div.adn.ads role="main">
      <div.ajy role="button" aria-label="Back to Inbox" tabindex="0"> ←
      <div.T-I.nX role="button" aria-label="Delete" tabindex="0"> Delete
      <h2.hP> Q4 launch checklist
      <span.gD> Priya Nair
      <span.go> <priya@example.com>
      <div.a3s.aiL role="presentation"> Hi, Can you review the Q4 launch checklist by Friday? Items 3 and 7 still need o…
      <span.ams.bkH role="link" aria-label="Respond" tabindex="0"> Respond
<div.vh id="toast" hidden="" [hidden]> Draft saved
```

### seed 4 (collapsed+popup+renamed+slow) — trace `t_pqbx5qhr6bmq`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails and save them as drafts (never send)
+0.0s Step "find-unread" started (Record the stable message ids and subjects of the two most recent unread inbox rows (tr.zA.zE)).
+1.8s   ✓ "find-unread" postcondition met: unread message ids captured, or the inbox is loaded and has no unread rows.
+1.8s Step "open-message-1" started (Open the unread email with this data-legacy-message-id so its text and a Reply control are visible).
+12.0s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=true.
+13.0s   agent (decide, fast model) chose "click-subject-cell": The inbox grid is visible with the m1 row containing the 'Q4 launch checklist' subject, and no other message or composer is open, so the click handler on the subject cell is the applicable path.
+13.0s   running branch "click-subject-cell" (pre-generated) — the click handler is on the subject cell or a link inside the row.
+19.5s   branch "click-subject-cell" did not fix it: no Reply control next to this subject yet; inbox rows visible=true.
+19.5s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=true.
+20.9s   agent (decide, fast model) chose "stop": The inbox grid is visible with the target row m1 but no reply control, and a "Try the new HardMail" dialog covers the page with "Not now" and "Try it" buttons; the only listed branch was already tried and return-to-inbox-first does not match since the inbox is already showing, so a new path would ne…
+20.9s FAILED at "open-message-1": agent stopped: The inbox grid is visible with the target row m1 but no reply control, and a "Try the new HardMail" dialog covers the page with "Not now" and "Try it" buttons; the only listed branch was already tried and return-to-inbox-first does not match since the inbox is already showing, so a new path would need to dismiss the popup, which is not a safe automated action to choose here.
Why it broke: step "open-message-1" never reached its postcondition (a Reply control is visible and the page shows this email subject); last observed: no Reply control next to this subject yet; inbox rows visible=true. Agent's last diagnosis: The inbox grid is visible with the target row m1 but no reply control, and a "Try the new HardMail" dialog covers the page with "Not now" and "Try it" buttons; the only listed branch was already tried and return-to-inbox-first does not match since the inbox is already showing, so a new path would ne…. Stopped because: agent stopped: The inbox grid is visible with the target row m1 but no reply control, and a "Try the new HardMail" dialog covers the page with "Not now" and "Try it" buttons; the only listed branch was already tried and return-to-inbox-first does not match since the inbox is already showing, so a new path would need to dismiss the popup, which is not a safe automated action to choose here..
DOM evidence (last observed, untrusted page content):
<div.G-atb role="toolbar" aria-label="Main">
  <span.gb_d> HardMail
  <button.T-I aria-label="Compose"> Compose
  <button.T-I id="drafts-nav"> Drafts ()
    <span id="dcount"> 0
<div.nH role="main">
  <div id="app">
    <table.F role="grid" aria-label="Inbox">
      <tr.zA.zE role="row" data-legacy-message-id="m1">
        <td.yX.xY role="gridcell"> Nov 6
        <td.y2 role="gridcell">
          <span.bog> Q4 launch checklist
          <span.y2.s> — Hi, Can you review the Q4 launch checklist by Friday? Items
        <td.xY role="gridcell">
      <tr.zA.zE role="row" data-legacy-message-id="m2">
        <td.yX.xY role="gridcell"> Nov 6
        <td.y2 role="gridcell">
          <span.bog> Dinner Saturday?
          <span.y2.s> — Hey! A few of us are doing dinner Saturday at 7 at the usua
        <td.xY role="gridcell">
      <tr.zA role="row" data-legacy-message-id="m3">
        <td.yX.xY…
```

### seed 6 (collapsed+renamed) — trace `t_pqbx5qhr6bmq`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails and save them as drafts (never send)
+0.0s Step "find-unread" started (Record the stable message ids and subjects of the two most recent unread inbox rows (tr.zA.zE)).
+0.0s   ✓ "find-unread" postcondition met: unread message ids captured, or the inbox is loaded and has no unread rows.
+0.0s Step "open-message-1" started (Open the unread email with this data-legacy-message-id so its text and a Reply control are visible).
+6.1s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=false.
+7.4s   agent (decide, fast model) chose "new": The message view for "Q4 launch checklist" is open with a "Respond" link and no inbox rows visible, so the click-subject-cell branch doesn't apply and the return-to-inbox-first branch isn't needed; the step may still be achievable by revealing the Reply control via a different action.
+13.8s   agent (create, inference model) wrote new branch "reply-control-labeled-respond" (The message is already open in the reading pane, but its reply control is labeled 'Respond' instead of 'Reply' and the i…): The DOM shows the email is already open with subject 'Q4 launch checklist' and a visible reply control labeled 'Respond', so no further click is needed and the step just needs to recognize that contro…
+13.8s   running branch "reply-control-labeled-respond" (create) — agent-written branch executed in the widget world.
+19.9s   branch "reply-control-labeled-respond" did not fix it: no Reply control next to this subject yet; inbox rows visible=false.
+19.9s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=false.
+34.3s   agent (escalate, generation model) wrote branch "back-to-inbox-then-open-target-row": The previous branch only validated the already-open view (Q4 launch checklist) without confirming it was the email with the target data-legacy-message-id, since state.cur carried no subject; this bran…
+34.3s   running branch "back-to-inbox-then-open-target-row" (escalate) — agent-written branch executed in the widget world.
+41.9s   branch "back-to-inbox-then-open-target-row" did not fix it: no Reply control next to this subject yet; inbox rows visible=true.
+41.9s   ✗ "open-message-1" expected a Reply control is visible and the page shows this email subject but observed no Reply control next to this subject yet; inbox rows visible=true (error: No visible inbox row with data-legacy-message-id=0 after returning to the inbox.).
+41.9s   stopped: cap: 2 recovery attempts for step "open-message-1" used
+41.9s FAILED at "open-message-1": cap: 2 recovery attempts for step "open-message-1" used
Why it broke: step "open-message-1" never reached its postcondition (a Reply control is visible and the page shows this email subject); last observed: no Reply control next to this subject yet; inbox rows visible=true. Agent's last diagnosis: The previous branch only validated the already-open view (Q4 launch checklist) without confirming it was the email with the target data-legacy-message-id, since state.cur carried no subject; this branch returns to the inbox, opens the exact row by id, then waits for the subject and the Reply/Respond…. Stopped because: cap: 2 recovery attempts for step "open-message-1" used.
DOM evidence (last observed, untrusted page content):
<div.G-atb role="toolbar" aria-label="Main">
  <span.gb_d> HardMail
  <button.T-I aria-label="Compose"> Compose
  <button.T-I id="drafts-nav"> Drafts ()
    <span id="dcount"> 0
<div.nH role="main">
  <div id="app">
    <table.F role="grid" aria-label="Inbox">
      <tr.zA role="row" data-legacy-message-id="m1">
        <td.yX.xY role="gridcell"> Nov 6
        <td.y2 role="gridcell">
          <span.bog> Q4 launch checklist
          <span.y2.s> — Hi, Can you review the Q4 launch checklist by Friday? Items
        <td.xY role="gridcell">
      <tr.zA.zE role="row" data-legacy-message-id="m2">
        <td.yX.xY role="gridcell"> Nov 6
        <td.y2 role="gridcell">
          <span.bog> Dinner Saturday?
          <span.y2.s> — Hey! A few of us are doing dinner Saturday at 7 at the usua
        <td.xY role="gridcell">
      <tr.zA role="row" data-legacy-message-id="m3">
        <td.yX.xY ro…
```
