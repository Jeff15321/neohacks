# modules/net

**Purpose:** network observation + page-context replay (ported from MVP `sw.ts`/`netlog.ts`/`net/invoke.ts`), with the
doc §4 item 1 security fixes:
- (a) probe records never go to `window.top` — each frame's own content script relays them (`content.js` runs in all frames);
- (b) every probe record is `provenance:'page'`; `chrome.webRequest.onCompleted` cross-match (url+method, ±2 s) sets
  `confirmed:true`; **only confirmed ops are replayable**;
- (c) summaries that leave the SW (panel, widgets, backend) are redacted (`@app/core` redact); raw values stay in
  memory/storage.session for replay.

Phase E (doc §4 items 2–5):
- **Step attribution:** `content/netbridge` exports `netAttribution.setStepProvider(fn)` for the Step recorder; gestures and
  requests started while a step is open carry its `stepId` (stamped in the isolated world — page-posted stepIds/triggers
  are ignored). `correlate` prefers the record's step, falling back to the 6 s gesture window; summaries expose
  `stepId` + `attribution: 'step'|'window'`.
- **Op analysis** (`@app/core` `analyzeOps`, pure): route templates, token/param fields, dependency inference
  (`dependsOn`), idempotency hints — attached to every summary as `analysis` (field names/paths only, never values).
- **Verification tiers** per `${origin} ${METHOD} ${template}` (NetLog, persisted in `storage.session` `wwa_net_tiers`):
  `observed` → `replayed` (a platform-observed replay of the op without url/method override returned 2xx with a
  similar response shape) → `verified` (`WidgetAI.net.reportVerified(opId, evidence)`, accepted only once `replayed`).
  Mutating ops are never auto-probed (nothing auto-probes; replays happen only via the panel Replay button or an
  approved widget run).
- **webRequest coverage:** `GET_NET_OPS` also returns `browserOnly` — xhr/ping completions with no probe record
  (worker / pre-document_start requests): "browser-seen, no body", never replayable.

**Messages:** content `WWA_NET_RECORD`, `WWA_GESTURE`, `WWA_NET_HELLO` · panel `GET_NET_OPS`, `NET_REPLAY` · user script
`WIDGET_NET_OPS`, `WIDGET_NET_INVOKE`, `WIDGET_NET_REQUEST`, `WIDGET_NET_REPORT_VERIFIED` (grant network) · sends
`WWA_NET_INVOKE` to the top frame.

**Services provided:** `net.opsForTab`. **Settings flag:** `net` (off → no capture, empty ops).

**Data owned:** `storage.session` `wwa_net_<tabId>` (records), `wwa_net_tiers` (template tiers).

**Test:** `packages/core` unit tests (netlog/invoke/redact/op-analysis) + E2E `net.spec.ts` (rotating CSRF: stale replay
→ 403, widget re-fetches the dependency token → tier `verified`).
