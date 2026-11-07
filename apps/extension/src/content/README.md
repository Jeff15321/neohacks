# content/

ISOLATED-world content script (`content.js`, all frames, document_idle). `main.ts` wires: `netbridge/` (probe relay +
gestures, every frame), `context.ts` (PageContext, top frame), `steps/` (Phase B), `overlay/` (in-page UI).
The MAIN-world probe lives in `../page/netprobe.ts`.
