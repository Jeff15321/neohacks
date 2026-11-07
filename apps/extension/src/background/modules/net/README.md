# modules/net

**Purpose:** network observation + page-context replay (ported from MVP `sw.ts`/`netlog.ts`/`net/invoke.ts`), with the
doc §4 item 1 security fixes:
- (a) probe records never go to `window.top` — each frame's own content script relays them (`content.js` runs in all frames);
- (b) every probe record is `provenance:'page'`; `chrome.webRequest.onCompleted` cross-match (url+method, ±2 s) sets
  `confirmed:true`; **only confirmed ops are replayable**;
- (c) summaries that leave the SW (panel, widgets, backend) are redacted (`@app/core` redact); raw values stay in
  memory/storage.session for replay.

**Messages:** content `WWA_NET_RECORD`, `WWA_GESTURE`, `WWA_NET_HELLO` · panel `GET_NET_OPS`, `NET_REPLAY` · user script
`WIDGET_NET_OPS`, `WIDGET_NET_INVOKE`, `WIDGET_NET_REQUEST` (grant network) · sends `WWA_NET_INVOKE` to the top frame.

**Services provided:** `net.opsForTab`. **Settings flag:** `net` (off → no capture, empty ops).

**Data owned:** `storage.session` `wwa_net_<tabId>`.

**Test:** `packages/core` unit tests (netlog/invoke/redact) + E2E `net.spec.ts`. Phase E owns further changes.
