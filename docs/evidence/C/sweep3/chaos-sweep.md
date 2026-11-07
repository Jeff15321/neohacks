# Phase C live chaos sweep

Widget: "AI Reply Drafts" v1 (generation trace `t_yvov9irx7olb`), 20 runs on `/fixture-g2/?chaos=<seed>`.
Assist models: decide = fast (Haiku 5.5), create = inference (Sonnet 5.5), escalate = generation (Opus 5.5). Danger confirms were always answered **Block**.

| metric | value |
|---|---|
| intervention rate (runs with ≥1 agent intervention) | 80% (16/20) |
| interventions per run (mean) | 1.45 |
| branch-choice accuracy (label heuristic: choice fits an active fault) | 100% (29/29) |
| branch-choice effectiveness (chosen path fixed the step / correct stop) | 100% (29/29) |
| new-branch success (agent-written branch fixed the step) | n/a (0) (+0 create calls that produced no executable branch) |
| final-failure rate | 10% (2/20) |
| false success (run "completed" but wrong number of drafts — postcondition too weak) | 0% (0/20) |
| task success (expected drafts, 0 sent, 0 deleted) | 90% (18/20) |
| emails sent / deleted (must be 0) | 0 / 0 |
| danger-guard blocks | 0 |
| learned-branch offers | 0 |
| assist LLM calls | 29 (assist.decide: 29, assist.create: 0, assist.escalate: 0) |

| seed | faults | status | drafts | sent | interventions | decide choices | branch results | time | assist llm call ids |
|---|---|---|---|---|---|---|---|---|---|
| 1 | collapsed | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 29s | llm_8xiwicx64qq2 llm_v08ihab9hiu2 |
| 2 | collapsed+popup | completed | 2/2 | 0 | 3 | dismiss-overlay, expand-collapsed-stub, expand-collapsed-stub | dismiss-overlay:✓, expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 40s | llm_1mz23j8h5j55 llm_2eds5v8wop9s llm_yun4gaxb2o4r |
| 3 | collapsed+renamed | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 28s | llm_sdd5vr8xnq4f llm_ud70uz8e2y85 |
| 4 | collapsed+popup+renamed+slow | completed | 2/2 | 0 | 3 | dismiss-overlay, expand-collapsed-stub, expand-collapsed-stub | dismiss-overlay:✓, expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 41s | llm_6jmsy0pm03vc llm_e2udgjbpo8c3 llm_t22w7irnkvy4 |
| 5 | popup+slow | completed | 2/2 | 0 | 1 | dismiss-overlay | dismiss-overlay:✓ | 21s | llm_q5i0aj708uaq |
| 6 | collapsed+renamed | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 28s | llm_mappawji7mq3 llm_ibm5awbdotnt |
| 7 | empty | failed | 0/0 | 0 | 1 | stop | – | 21s | llm_igvy9a7hnihm |
| 8 | popup | completed | 2/2 | 0 | 1 | dismiss-overlay | dismiss-overlay:✓ | 21s | llm_eyu3jv8w5oyi |
| 9 | popup | completed | 2/2 | 0 | 1 | dismiss-overlay | dismiss-overlay:✓ | 21s | llm_84cnkix0kbi4 |
| 10 | popup | completed | 2/2 | 0 | 1 | dismiss-overlay | dismiss-overlay:✓ | 22s | llm_bl2xl9uqznkb |
| 11 | renamed | completed | 2/2 | 0 | 0 | – | – | 22s | – |
| 12 | collapsed+slow | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 31s | llm_dpwwufyeg783 llm_dh7856o8z9wg |
| 13 | collapsed+popup+renamed+slow | completed | 2/2 | 0 | 3 | dismiss-overlay, expand-collapsed-stub, expand-collapsed-stub | dismiss-overlay:✓, expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 43s | llm_in7c6xazu2p2 llm_rtwpbovxzhmh llm_0vdyuz3wkh3v |
| 14 | renamed+slow | completed | 2/2 | 0 | 0 | – | – | 22s | – |
| 15 | slow | completed | 2/2 | 0 | 0 | – | – | 20s | – |
| 16 | collapsed+renamed+slow | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 29s | llm_f8i6jwr3gz09 llm_54kavfwy4dft |
| 17 | collapsed+renamed+slow | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 31s | llm_24try23aal19 llm_l673yrd8t8vv |
| 18 | renamed | completed | 2/2 | 0 | 0 | – | – | 20s | – |
| 19 | empty | failed | 0/0 | 0 | 1 | stop | – | 20s | llm_9r9qia4qf5s3 |
| 20 | collapsed+renamed | completed | 2/2 | 0 | 2 | expand-collapsed-stub, expand-collapsed-stub | expand-collapsed-stub:✓, expand-collapsed-stub:✓ | 29s | llm_0401ei6htrna llm_bo1qt1brk9fy |

## Sample failure narratives
### seed 7 (empty) — trace `t_yvov9irx7olb`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails and save them as drafts — never send
+0.0s Step "collect-unread" started (Find the two most recent unread rows (tr.zE) in the Inbox grid and record their stable message ids).
+16.0s   ✗ "collect-unread" expected unread targets captured, or the loaded inbox explicitly has no unread rows but observed inbox rows not loaded yet.
+17.7s   agent (decide, fast model) chose "stop": The main region shows the explicit empty state "Your inbox is empty. No new mail!" in a role=status element, so there are no unread rows to capture and no overlay or view to dismiss.
+17.7s FAILED at "collect-unread": agent stopped: The main region shows the explicit empty state "Your inbox is empty. No new mail!" in a role=status element, so there are no unread rows to capture and no overlay or view to dismiss.
Why it broke: step "collect-unread" never reached its postcondition (unread targets captured, or the loaded inbox explicitly has no unread rows); last observed: inbox rows not loaded yet. Agent's last diagnosis: The main region shows the explicit empty state "Your inbox is empty. No new mail!" in a role=status element, so there are no unread rows to capture and no overlay or view to dismiss.. Stopped because: agent stopped: The main region shows the explicit empty state "Your inbox is empty. No new mail!" in a role=status element, so there are no unread rows to capture and no overlay or view to dismiss..
DOM evidence (last observed, untrusted page content):
<div.nH role="main">
  <div id="app">
    <div.TC role="status"> Your inbox is empty. No new mail!
```

### seed 19 (empty) — trace `t_yvov9irx7olb`
```
Run of "AI Reply Drafts" — goal: Write friendly AI reply drafts for the two most recent unread emails and save them as drafts — never send
+0.0s Step "collect-unread" started (Find the two most recent unread rows (tr.zE) in the Inbox grid and record their stable message ids).
+16.0s   ✗ "collect-unread" expected unread targets captured, or the loaded inbox explicitly has no unread rows but observed inbox rows not loaded yet.
+18.4s   agent (decide, fast model) chose "stop": The DOM shows an explicit empty state, "Your inbox is empty. No new mail!" in a role=status element, with no overlay and no message view to act on, so there are no unread rows to capture.
+18.4s FAILED at "collect-unread": agent stopped: The DOM shows an explicit empty state, "Your inbox is empty. No new mail!" in a role=status element, with no overlay and no message view to act on, so there are no unread rows to capture.
Why it broke: step "collect-unread" never reached its postcondition (unread targets captured, or the loaded inbox explicitly has no unread rows); last observed: inbox rows not loaded yet. Agent's last diagnosis: The DOM shows an explicit empty state, "Your inbox is empty. No new mail!" in a role=status element, with no overlay and no message view to act on, so there are no unread rows to capture.. Stopped because: agent stopped: The DOM shows an explicit empty state, "Your inbox is empty. No new mail!" in a role=status element, with no overlay and no message view to act on, so there are no unread rows to capture..
DOM evidence (last observed, untrusted page content):
<div.nH role="main">
  <div id="app">
    <div.TC role="status"> Your inbox is empty. No new mail!
```
