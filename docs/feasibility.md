# Feasibility — investigated claims, evidence, and open risks

Everything below is either **VERIFIED** (ran in this repo / on official docs)
or **INFERENCE** (reasoned, not observed). The PoC that validated the core
mechanism is preserved at `poc/` (`node run.mjs` re-runs it).

## 1. Can an MV3 extension execute newly generated JavaScript in a page?

**VERIFIED — yes, via `chrome.userScripts`.** It is the only MV3 API that
accepts arbitrary code strings (`js: [{code}]`). Alternatives and why they
fail:

| Mechanism | Verdict |
|---|---|
| `chrome.scripting.executeScript({func})` | `func` must be a packaged-extension function; you cannot turn a string into it without `eval`/`new Function`, which MV3 CSP blocks in extension contexts |
| `chrome.scripting.executeScript({files})` | Files must ship inside the extension package; can't add files at runtime |
| `<script>` injection / `eval` in MAIN world | Subject to the **page's** CSP — Gmail-class sites block it |
| `chrome.debugger` + `Runtime.evaluate` | Works (CDP eval ignores page CSP) but shows a persistent "debugging" infobar — acceptable fallback only |
| **`chrome.userScripts.register/execute`** | ✅ Designed for exactly this (arbitrary user-provided code) |

Evidence: `poc/run.mjs` — `execute({js:[{code}], world:'USER_SCRIPT',
injectImmediately:true})` ran generated code, inserted a button into a live
page, and resolved the returned promise. Chrome 135+ required for `execute`;
this machine runs Chrome 156, Playwright's bundled Chromium is 158.

## 2. The "Allow User Scripts" gate (Chrome ≥138)

**VERIFIED.** On Chrome 138+, `chrome.userScripts` is `undefined` until the
per-extension toggle on `chrome://extensions/?id=<id>` is enabled (pre-138 it
was global Developer Mode). The toggle is backed by pref
`user_scripts_enabled` (extension-scoped; found in
`chromium/src/extensions/browser/user_script_manager.h`).

- Pref-seeding `Secure Preferences` did **not** take effect in our tests
  (integrity-MAC protection and/or install-time overwrite).
- **UI automation does work**: Playwright can open `chrome://extensions` and
  click through its shadow DOM. `tests/e2e/helpers.ts#enableToggles` finds
  `cr-toggle` rows by label text ("Developer mode", "Allow User Scripts"),
  clicks them, then relaunches so the service worker rebinds the API. Runs
  fully headless.
- The API binds at extension-context creation, so a restart/relaunch is
  required after toggling.
- **Manual demos**: a human flips the same toggle in ~10s. Documented in
  `docs/manual-test.md`.

## 3. USER_SCRIPT world semantics

**VERIFIED:**
- Shares the DOM with the page (read/write, listeners, Shadow DOM all work).
- **Does NOT share page JS globals** — `window.__native` set by page code read
  as `undefined` in the widget world. Consequence found the hard way: widget
  verification must use DOM signals, never `window.__x`. (Our mock Gmail
  widget initially checked `window.__drafts` — invisible — and misreported.)
- Exempt from page CSP — our test page ran a strict `script-src 'self'` CSP
  and injected code still ran. This is what makes Gmail feasible.
- `worldId` (Chrome 133+) gives per-widget worlds; `configureWorld({worldId,
  messaging:true})` must precede `execute` for messaging to work in it.

## 4. Script ↔ extension messaging

**VERIFIED.** `configureWorld({messaging:true})` exposes
`chrome.runtime.sendMessage`/`connect` inside the user-script world; the SW
receives them via dedicated `chrome.runtime.onUserScriptMessage` /
`onUserScriptConnect` (NOT `onMessage`) — deliberately separate because the
context is less-trusted. Round-trips verified both during initial execution
and from later click handlers, including inside a `worldId` world.

## 5. Persistence

**VERIFIED.** `chrome.userScripts.register({id, matches, js:[{code}],
runAt:'document_idle'})` persisted a script that ran on the next page load.
Scripts are cleared on extension update (re-register in `onInstalled`).
MVP uses execute-on-demand; auto-registration is a P2 toggle.

## 6. Tweeks reference — documented vs inferred

**DOCUMENTED** (tweeks.io/docs, llms.txt, changelog):
- Greasemonkey-style scripts with a `// ==UserScript==` metadata block and
  `@grant` permission directives gating privileged calls.
- `TW_inference(prompt, data?) → Promise<string>`: script → service worker →
  server endpoint; prompt ≤10k chars, payload ≤50k, output ≤4096 tokens,
  120s timeout, auth required. We adopted the same shape and limits.
- Other `TW_*` APIs: `TW_email`, `TW_contextMenu`, `TW_toast`, `TW_alert`.
- "Three-world security model: MAIN world (script execution), ISOLATED world
  (security bridge), Service Worker (orchestration)" — they run in MAIN world;
  we chose USER_SCRIPT worlds instead (stricter isolation, still DOM-capable).
- Their generator returns success / success-with-warnings / refusal — we
  copied the pattern (`warnings[]`, honest failures).
- Internal file names leaked in docs metadata (`extension/shared/
  script-compiler.js`, `server/app/api/tw/inference/route.ts`) suggest a
  Next.js backend — consistent with, not proof of, our reading.

**INFERENCE:** their MAIN-world execution likely exists so widgets can touch
page-level JS objects on some sites. If we ever need that,
`userScripts.execute({world:'MAIN'})` is a one-line change — but page CSP
exemption still applies to userScripts even in MAIN world.

## 7. Playwright + extensions + headless

**VERIFIED.** `chromium.launchPersistentContext(profile, {channel:'chromium',
args:['--load-extension=…','--disable-extensions-except=…']})` loads MV3
extensions headless and exposes the service worker
(`context.serviceWorkers()` / `waitForEvent('serviceworker')`). Gotchas hit:
- Branded Chrome removed `--load-extension` — tests must use the bundled
  `chromium` channel.
- `page.evaluate` callbacks authored in TS get wrapped by esbuild's keepNames
  (`__name`) — pass string bodies on chrome:// pages.
- `page.waitForFunction(fn, arg, options)` — options is the THIRD arg.

## 8. Backend security boundary

**VERIFIED (by implementation, not audit).** Generated code cannot see the LLM
key — inference flows only through `onUserScriptMessage` → SW → backend with a
shared dev token. Grants gate `WidgetAI.*` surfaces; `matchPatterns` scope the
widget to origins (checked in SW on every message against `sender.tab.url`).
Static denylist + acorn parse reject dangerous constructs pre-injection.

**Honest limitations:** a determined payload can still exfiltrate page data via
`WidgetAI.inference` context, read the DOM freely, and simulate most clicks —
that is inherent to the product. The MVP mitigates with: user approval before
execution, visible code review, prompt-level hard bans on send/delete/purchase
actions, origin scoping, rate limits, and treating all page text as untrusted
data in the inference prompt. A public Chrome Web Store release would also hit
remotely-hosted-code review — this is a local dev-mode hackathon build.

## 9. Known open risks

| Risk | Mitigation |
|---|---|
| Generated selectors are brittle on real Gmail (obfuscated classes) | Prefer aria-label/role/text selectors; repair loop P2 |
| Synthetic clicks vs trusted events on real sites | Fixture-proven pattern (dispatchEvent MouseEvent/InputEvent); real Gmail needs the manual checklist |
| Gmail's SPA re-renders detach captured nodes mid-workflow | Prompt instructs re-query per iteration; capture stable ids |
| Accidental sends | Prompt hard-ban + fixture `__sent` assertion (0 sends) |
| Service worker sleep during long widget runs | Messages wake the SW; inference calls keep it alive |
| `execute()` missing on Chrome <135 | Fallback: `register()` + `tabs.reload`, or chrome.debugger |
