# Network observation + reproduction

> Status: implemented and verified end-to-end on a controlled fixture and a
> real third-party site (reqres.in). Gmail assessment is analytical — see §6.

Goal: let generated widgets understand and reuse the site's own API calls —
observe what a user action does on the wire, then reproduce that operation
with different parameters instead of clicking through the UI.

## 1. Why this architecture

| Approach | Req+resp bodies | Page-auth replay | Cost |
|---|---|---|---|
| `chrome.webRequest` | headers + request body only — **no response bodies in MV3** | n/a | low |
| `chrome.debugger` (CDP) | everything | n/a | heavy: per-tab attach, "debugging" banner, fights DevTools |
| **MAIN-world fetch/XHR instrumentation (chosen)** | full request **and** response bodies for SPA traffic | replay through the page's own `fetch` — real cookies, real origin | low |

The probe (`apps/extension/src/net/probe.ts`) is a manifest content script
(`world:"MAIN"`, `run_at:document_start`, `all_frames`) injected before page
JS. It wraps `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon`, then posts
serialized records over `window.postMessage` to the isolated content script,
which relays to the service worker. Because it runs at document_start, it sees
calls the page makes from its very first script.

Replay goes the other way: SW → content script → probe → **the page's own
`fetch`** (a saved reference to the original, bypassing both our wrapper and
any site wrappers). Requests fire from the page context, so ambient cookies
and same-origin CORS behave exactly as if site code had made the call.

## 2. Pipeline

```
user click ──(content script, capture-phase)──► SW gesture buffer
page fetch/XHR ──(MAIN-world probe)──► postMessage ──► content script ──► SW netlog
                                                        (per-tab ring buffer, 80 records)
SW correlates record → most recent gesture within 6 s → triggerText
GENERATE_WIDGET ──► pageContext.networkOps ──► generation prompt
                                                     ("OBSERVED NETWORK OPERATIONS")
generated widget ──► WidgetAI.net.operations() / invoke(opId, overrides) / request(req)
                     ──► SW (grant + same-origin checks) ──► content script ──► probe
                     ──► original fetch in page ──► result back up the chain
side panel ──► "Network activity" inspector: op list, bodies, one-click Replay
```

Correlation is a heuristic: the most recent gesture within 6 s before the
request starts. It can misattribute (background polls after a click), which is
why ops also carry `triggerText` — presented to the model and the user as
context, not truth.

## 3. Widget-facing surface (`network` grant)

- `WidgetAI.net.operations()` → compact op summaries `{id, method, url, path,
  status, contentType, requestBodyTemplate, responseBodySample, triggerText}`.
- `WidgetAI.net.invoke(opId, overrides?)` → replay a captured op.
  `overrides`: `{url?, method?, headers? (null deletes), body?, mergeBody?}`.
  `mergeBody` shallow-merges into the captured JSON body — the parameterization
  path that preserves captured dynamic fields (csrf tokens, ids).
- `WidgetAI.net.request({url, method?, headers?, body?})` → same-origin call
  with no captured template; relative URLs resolve against the page.

Enforcement: `network` grant required; replay URL must share the tab's origin
(ambient cookies make cross-origin replay dangerous); browser-managed headers
(Cookie, Content-Length, Sec-*, Origin…) are stripped — the browser re-adds
correct values. Generated code may not call `fetch`/XHR/`sendBeacon`/`WebSocket`
directly — all network goes through this grant-gated surface.

## 4. Verified

- **E2E (`tests/e2e/net.spec.ts`, mock LLM):** user clicks "Save draft" on the
  NetMail fixture → `POST /fixture-api/drafts` captured with `click "Save
  draft"` correlation → generated widget replays it via `mergeBody` with a new
  recipient/subject/body → **verified against real server state** (2 drafts,
  0 sent), and the fixture's own API-driven Drafts view shows both.
- **Live LLM (`tests/tools/net-live.mjs`):** real Anthropic codegen declared
  the `network` grant, invoked the captured op with `mergeBody`, verified via
  `net.request` read-back — draft created server-side.
- **Real site (`tests/tools/site-netprobe.mjs` on reqres.in):** captured
  `GET /api/users/2 → 200 ← click "Send request"`, response body included;
  panel Replay re-issued it live (200 + body).
- **Unit:** invoke/override builders (merge, header strip, same-origin),
  netlog correlation + summarization, validator grants + network ban.

## 5. Limitations (honest)

- Only `fetch`/`XHR`/`sendBeacon` traffic is observed: no WebSocket frames, no
  worker-context requests (the page's own `fetch` inside a Web Worker is a
  different global), no navigation/form/media requests. On most SPAs that's
  the API surface that matters; on pages that submit real forms it's not.
- Records persist in memory + `chrome.storage.session` (survives SW restarts,
  not browser restarts); a tab closed = capture gone. Op ids are ephemeral.
- Response bodies captured only for textual content types; binary/FormData/
  streamed **request** bodies are tagged but can't be faithfully replayed.
- Captured tokens go stale. `mergeBody`/verbatim replay reuses whatever auth
  material was in the request — works while cookies + tokens live, fails after.
- Requests captured in cross-origin iframes are recorded (tagged `frameUrl`)
  but replay always executes in the top frame.
- Gesture correlation is a 6 s heuristic — misattribution is possible.
- A page loaded before the extension was installed/reloaded has no probe until
  reload; the panel says "probe not seen".

## 6. Gmail assessment (analytical — not verified here)

Expected capture: yes. Gmail's mutations (draft save, mark read, send) go
through `fetch`/XHR `POST`s to `mail.google.com` (`f.req` / `batchexecute`
payloads) — the probe records URL, headers, body, and response.

Expected replay: **plausible for draft-class operations, fragile in general.**
The same-origin requirement is satisfied (calls stay on `mail.google.com`) and
cookies are ambient. The risks are Gmail-specific:

- `at=` XSRF token embedded in `f.req` — session-scoped and long-lived; a
  captured replay works while the session lives. Refreshing it needs page-JS
  access (`window.GLOBALS`), which the MAIN-world probe *can* read — a
  documented extension point, not implemented.
- `SAPISIDHASH` headers on `*.googleapis.com` calls are time-boxed HMACs over
  the HttpOnly `SAPISID` cookie — cannot be recomputed in JS; verbatim replay
  only works inside the signature's validity window.
- `f.req` bodies are opaque nested arrays — parameterization means surgical
  string edits on `requestBodyTemplate`, not clean `mergeBody`.

Blocked locally: Google refuses sign-in on automation-flagged Chromium
("browser may not be secure"), so live capture on real Gmail couldn't be
verified in this environment. `tests/tools/gmail-netprobe.mjs` is the probe —
run it with a manually-signed-in `.gmail-profile` to confirm.

## 7. Security notes

Records can contain sensitive data (auth headers, message bodies). They stay
in the browser (memory + session storage); only compact summaries enter the
generation prompt. The grant/origin checks bound generated code to page-origin
calls only — the same power DOM automation already had, made explicit.
