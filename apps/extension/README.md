# apps/extension (MV3)

```
src/background/main.ts        wires modules to the bus — nothing else
src/background/bus.ts         typed router: zod-validate per boundary → owning module → ring-buffer log; in-SW services
src/background/platform/      thin chrome.* wrappers + backend client (the only chrome.* callers)
src/background/modules/<m>/   widgets · net · system (built) · observe · record · flow · jobs · data · assist (stubs)
src/content/                  content.js (all frames): netbridge, context, steps/, overlay/
src/page/netprobe.ts          netprobe.js (MAIN world, document_start, all frames)
src/panel/                    side panel (React + Tailwind v4 + shadcn-style)
```

Build: `npm run build -w apps/extension` (env `BACKEND_URL`, `EXTENSION_AUTH_TOKEN`) → `dist/`.
Load unpacked from `dist/`, then enable **Allow User Scripts** on the extension's details page (Chrome ≥138).

Tests: `npm run test:unit -w apps/extension` (bus), E2E in `tests/e2e`.
