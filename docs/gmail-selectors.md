# Gmail DOM field guide (for widget generation + debugging)

Collected from automation literature + our fixtures; verify against the live
DOM before relying on any single selector — Gmail obfuscates classes and
shuffles them periodically. Prefer `aria-label`/`role`/text matches.

| Purpose | Known selectors / affordances |
|---|---|
| Inbox row | `tr.zA` (unread adds `.zE`), inside `div[role="main"] table[role="grid"]` |
| Stable row id | `data-legacy-thread-id` / `data-legacy-message-id` attrs |
| Sender (row) | `td.yX .yW span[email]` or `.bA4`-ish name span |
| Subject (row) | `.bog` span in `td.y2` |
| Toolbar | `div[gh="tm"] .G-atb`-ish; safer: `[role="toolbar"]` or nav region — fall back to fixed dock |
| Back to inbox | `[aria-label*="Inbox" i]` / `[aria-label="Back to Inbox"]` |
| Message subject | `h2.hP` |
| Sender (message) | `span.gD[name][email]` + `span.go` |
| Message body | `div.a3s.aiL` (may repeat per message in a thread — take the last visible one) |
| Reply affordance | `span.ams.bkH[role="link"]` text "Reply", or `[aria-label*="Reply" i]` near message footer — NOT a `<button>` |
| Composer | `div[contenteditable="true"][role="textbox"][aria-label]` (`.Am.aiL.aO9`-ish) |
| Send | `[aria-label*="Send" i]` / `.T-I-KE` — NEVER click from widget code |
| Draft indicator | toast `.vh` / "Draft saved" text; Drafts folder `#num` or navigate `#drafts` |
| Thread vs message | A thread shows multiple `.adn.ads` blocks; target the LAST expanded one for replies |

Notes for the generator:
- Opening an unread row marks it read — snapshot targets by `data-legacy-message-id`, not by index.
- Clicking Reply on a thread opens the composer inside that thread's `.adn` — scope composer search to the thread container you opened.
- Gmail autosaves drafts on input — an InputEvent on the contenteditable is required; verify via the "Draft saved" toast or Drafts folder.
