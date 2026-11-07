# Manual test — real Gmail end-to-end

Use a disposable test account if possible. The widget only creates drafts and
is prompt-constrained never to send — but review the generated code anyway.

## Setup (one time)

1. `git clone <repo> && cd neohacks && npm install`
2. `cp .env.example .env` → set `ANTHROPIC_API_KEY`, keep
   `EXTENSION_AUTH_TOKEN=dev-token-change-me`
3. `npm run build` (backend + extension → `apps/extension/dist`)
4. Backend: `npm run dev:backend` → `{"ok":true,"provider":"anthropic"}` at
   `http://127.0.0.1:8787/health`
5. Chrome → `chrome://extensions` → **Developer mode** ON →
   **Load unpacked** → select `apps/extension/dist`
6. On the extension's **details page**, enable **Allow User Scripts**
   (required on Chrome ≥138 — see docs/feasibility.md §2)
7. Click the extension action icon → side panel opens

## Gmail demo

> Shortcut: `cd tests/tools && npx tsx gmail-live.mjs` launches a persistent
> browser with the extension, waits for you to log in once, then drives
> generate → approve → run and watches the result. The steps below are the
> manual equivalent.

8. Sign into a Gmail test account; send yourself **two unread emails**
   (e.g. subjects "Q4 launch checklist" and "Dinner Saturday?"). Leave them
   unread in the inbox.
9. With the Gmail inbox open, in the side panel type:
   *"Add a button that reads my two most recent unread emails and writes a
   friendly AI-generated reply draft for each."*
10. Wait for the widget card (name, description, grants, matchPatterns).
    Click **Review code** — sanity-check: no `fetch` to foreign hosts, no
    send/delete clicks, `wwa-` root id, Shadow DOM.
11. Click **Approve & Run**. A button should appear — ideally inserted near
    Gmail's toolbar; otherwise in a fixed panel (report which happened).
12. Click the widget's button. Watch the panel log:
    finding unread → opening 1/2 → generating reply → draft saved →
    opening 2/2 → … → `completed`.

## Verify

13. Gmail → **Drafts**: two draft replies, each attached to the correct
    conversation, sensible content.
14. **Sent**: empty — nothing was sent.
15. Gmail still works: open/close threads, search, compose — no layout or
    console breakage. Extension-injected nodes have `id` starting `wwa-`.
16. Remove the widget from the panel → injected UI disappears.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "chrome.userScripts unavailable" / API errors | Allow User Scripts toggle off (step 6); reload the extension after enabling |
| Generation fails / 422 | Check backend log — validator errors are explicit; retry usually fixes transient contract slips |
| Button appears in wrong place / fixed dock | Insertion heuristic missed; acceptable fallback — note it for prompt tuning |
| "Could not find Reply" or composer | Gmail DOM drift — see `docs/gmail-selectors.md` field guide; regenerate, or improve PageContext |
| Only 1 draft | Check panel log — likely a stale row ref after SPA re-render; the prompt tells the model to re-query per iteration |
| Drafts not saving | Gmail needs InputEvent after edit — verify generated code dispatches it to the contenteditable |
| Backend 401 | `EXTENSION_AUTH_TOKEN` mismatch between `.env` and extension build env |

## What success looks like

Two AI-written drafts in Drafts, correct threads, nothing sent, Gmail
unbroken, widget removable — all from a natural-language request with zero
hand-written Gmail code.
