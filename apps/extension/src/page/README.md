# page/

`netprobe.ts` → `dist/netprobe.js`: manifest content script with `world:"MAIN"`, `run_at:"document_start"`,
`all_frames` (MUST inject before page JS). Wraps fetch/XHR/sendBeacon; posts records to its own frame's window
(relayed by `content/netbridge`); executes replays (top frame only) with the original fetch.
Keep imports tiny — it runs on every page (no zod/acorn: import `@app/contracts/limits`, `@app/core/net/invoke`).
Owner of further changes: Phase E (start events for settle: Phase B).
